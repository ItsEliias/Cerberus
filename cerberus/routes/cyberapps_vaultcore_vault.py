"""
VaultCore — shared vault helpers, path constants, and file I/O utilities.

Mirrors the CyberLab vault pattern but uses vaultcore-prefixed data paths.
All encrypted storage uses the shared Cerberus-wide vault (same salt + sentinel
as CyberLab so users only manage ONE master password).
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import stat
import time
from pathlib import Path
from typing import Any, Optional, Dict

from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
VAULT_DIR = Path(DATA_DIR) / "cyberapps"
SALT_PATH = VAULT_DIR / "vault_salt.hex"
SENTINEL_PATH = VAULT_DIR / "vault_sentinel.bin"

VAULTCORE_DIR = VAULT_DIR / "vaultcore"
SOURCES_PATH = VAULTCORE_DIR / "vc_sources.json"
JOBS_PATH = VAULTCORE_DIR / "vc_jobs.json"
LOGS_PATH = VAULTCORE_DIR / "vc_logs.json"
SETTINGS_PATH = VAULTCORE_DIR / "vc_settings.json"

# Vault in-memory session store — shared with CyberLab module
# (imported separately; each module has its own dict keyed by token)
_vault_sessions: Dict[str, float] = {}
VAULT_SESSION_TTL = 15 * 60  # 15 minutes


# ---------------------------------------------------------------------------
# File I/O helpers
# ---------------------------------------------------------------------------

def ensure_dirs() -> None:
    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    VAULTCORE_DIR.mkdir(parents=True, exist_ok=True)


def safe_chmod(path: Path) -> None:
    try:
        if os.name != "nt":
            os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass


def read_json(path: Path, default: Any) -> Any:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def write_json(path: Path, data: Any) -> None:
    ensure_dirs()
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.rename(path)


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# Vault crypto helpers (mirrors cyberapps_cyberlab_vault.py)
# ---------------------------------------------------------------------------

def derive_key(password: str, salt: bytes) -> bytes:
    import base64
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=260_000)
    return base64.urlsafe_b64encode(kdf.derive(password.encode()))


def vault_salt() -> bytes:
    ensure_dirs()
    if SALT_PATH.exists():
        return bytes.fromhex(SALT_PATH.read_text().strip())
    salt = secrets.token_bytes(32)
    SALT_PATH.write_text(salt.hex())
    safe_chmod(SALT_PATH)
    return salt


def fernet(password: str):
    from cryptography.fernet import Fernet
    return Fernet(derive_key(password, vault_salt()))


def vault_initialized() -> bool:
    return SALT_PATH.exists() and SENTINEL_PATH.exists()


def vault_setup(password: str) -> str:
    """First-run: write sentinel file, return session token."""
    f = fernet(password)
    sentinel = f.encrypt(b"cerberus-cyberlab-vault-ok")
    SENTINEL_PATH.write_bytes(sentinel)
    safe_chmod(SENTINEL_PATH)
    token = secrets.token_urlsafe(32)
    _vault_sessions[token] = time.time() + VAULT_SESSION_TTL
    return token


def vault_unlock(password: str) -> Optional[str]:
    """Verify master password; return session token or None."""
    if not vault_initialized():
        return None
    try:
        f = fernet(password)
        f.decrypt(SENTINEL_PATH.read_bytes())
        token = secrets.token_urlsafe(32)
        _vault_sessions[token] = time.time() + VAULT_SESSION_TTL
        return token
    except Exception:
        return None


def vault_valid(token: Optional[str]) -> bool:
    if not token:
        return False
    expiry = _vault_sessions.get(token)
    if not expiry or time.time() > expiry:
        _vault_sessions.pop(token, None)
        return False
    _vault_sessions[token] = time.time() + VAULT_SESSION_TTL
    return True


def vault_locked() -> bool:
    return not any(time.time() < exp for exp in _vault_sessions.values())


def vault_clear_sessions() -> None:
    _vault_sessions.clear()
