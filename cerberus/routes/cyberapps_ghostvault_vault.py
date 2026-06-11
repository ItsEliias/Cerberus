"""
GhostVault — shared vault helpers and path constants.

Uses the SAME shared Cerberus-wide vault salt and sentinel as CyberLab.
Note content is Fernet-encrypted at rest using a domain-specific key
derived from (vault_salt || "ghostvault-notes-v1") so the master password
never needs to be re-supplied after unlock.

All in-memory sessions share the same TTL contract as CyberLab (15 min).
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import stat
import time
from pathlib import Path
from typing import Any, Dict, Optional

from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
VAULT_DIR = Path(DATA_DIR) / "cyberapps"
SALT_PATH = VAULT_DIR / "vault_salt.hex"
SENTINEL_PATH = VAULT_DIR / "vault_sentinel.bin"

GHOSTVAULT_DIR = VAULT_DIR / "ghostvault"
NOTES_PATH = GHOSTVAULT_DIR / "notes.enc.json"
FOLDERS_PATH = GHOSTVAULT_DIR / "folders.json"
SETTINGS_PATH = GHOSTVAULT_DIR / "settings.json"

_vault_sessions: Dict[str, float] = {}
VAULT_SESSION_TTL = 15 * 60  # 15 minutes


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------

def ensure_dirs() -> None:
    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    GHOSTVAULT_DIR.mkdir(parents=True, exist_ok=True)


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
    safe_chmod(path)


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# Vault crypto (mirrors CyberLab vault — same salt + sentinel)
# ---------------------------------------------------------------------------

def _derive_key(password: str, salt: bytes) -> bytes:
    import base64
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=260_000)
    return base64.urlsafe_b64encode(kdf.derive(password.encode()))


def _vault_salt() -> bytes:
    ensure_dirs()
    if SALT_PATH.exists():
        return bytes.fromhex(SALT_PATH.read_text().strip())
    salt = secrets.token_bytes(32)
    SALT_PATH.write_text(salt.hex())
    safe_chmod(SALT_PATH)
    return salt


def vault_initialized() -> bool:
    return SALT_PATH.exists() and SENTINEL_PATH.exists()


def vault_unlock(password: str) -> Optional[str]:
    """Verify master password against shared sentinel; return session token or None."""
    if not vault_initialized():
        return None
    try:
        from cryptography.fernet import Fernet
        key = _derive_key(password, _vault_salt())
        f = Fernet(key)
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


# ---------------------------------------------------------------------------
# GhostVault note encryption — domain-derived key
# ---------------------------------------------------------------------------

def _notes_fernet():
    """
    Return a Fernet cipher for GhostVault note content.

    Key is derived from (vault_salt || domain-label) so it is stable across
    sessions once the vault salt exists, and unique to GhostVault data.
    The master password is NOT required here — the session token check in
    the route layer ensures the user is authenticated before any I/O.
    """
    from cryptography.fernet import Fernet
    salt = _vault_salt()
    key = _derive_key("ghostvault-notes-v1", salt)
    return Fernet(key)


def encrypt_content(plaintext: str) -> str:
    """Encrypt a note body string. Returns base64-Fernet token as str."""
    return _notes_fernet().encrypt(plaintext.encode()).decode()


def decrypt_content(token: str) -> str:
    """Decrypt a Fernet token string. Returns plaintext. Raises on failure."""
    return _notes_fernet().decrypt(token.encode()).decode()
