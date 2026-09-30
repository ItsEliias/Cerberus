#!/usr/bin/env bash
# Cerberus · Recon — Linux launcher (Wayland/X11).
#
# First run: installs deps, vendors xterm, rebuilds node-pty for Electron, and
# makes sure the Electron binary is actually unpacked. Later runs: just launches.
#
#   ./run-linux.sh            # install if needed, then start
#   ./run-linux.sh --reinstall  # force a clean dependency reinstall
#
# Prereqs: Node.js (LTS or newer) + npm. Everything else is handled here.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

say() { printf '│ %s\n' "$*"; }
echo   "┌─ CERBERUS · RECON ────────────────────────────────"

if ! command -v node >/dev/null 2>&1; then
  say "Node.js isn't installed. On Omarchy/Arch:  sudo pacman -S nodejs npm"
  echo "└───────────────────────────────────────────────────"; exit 1
fi

if [[ "${1:-}" == "--reinstall" ]]; then
  say "Reinstall requested — removing node_modules…"; rm -rf node_modules
fi

# node-gyp (for the native node-pty build) imports distutils, which Python 3.12+
# dropped. If the system Python lacks it, point npm at a throwaway venv that has
# setuptools (which still provides distutils). Harmless if distutils is present.
NODE_GYP_PY=""
if ! python3 -c 'import distutils' >/dev/null 2>&1; then
  VENV="$HOME/.cache/node-gyp-python"
  if [[ ! -x "$VENV/bin/python" ]]; then
    say "Preparing a Python helper for the native build…"
    python3 -m venv "$VENV" && "$VENV/bin/pip" -q install setuptools >/dev/null
  fi
  NODE_GYP_PY="$VENV/bin/python"
fi

if [[ ! -d node_modules ]]; then
  say "First run — installing dependencies (1–2 min)…"
  if [[ -n "$NODE_GYP_PY" ]]; then
    npm_config_python="$NODE_GYP_PY" PYTHON="$NODE_GYP_PY" npm install
  else
    npm install
  fi
  say "Rebuilding the terminal engine (node-pty) for Electron…"
  if [[ -n "$NODE_GYP_PY" ]]; then
    npm_config_python="$NODE_GYP_PY" PYTHON="$NODE_GYP_PY" npm run rebuild \
      || say "(rebuild warning — app still opens; retry later with: npm run rebuild)"
  else
    npm run rebuild || say "(rebuild warning — retry later with: npm run rebuild)"
  fi
fi

# Electron's installer sometimes leaves the archive un-extracted on newer Node
# (only a locales/ dir appears). If the binary is missing but the cached zip is
# present, unpack it by hand.
ELECTRON_BIN="node_modules/electron/dist/electron"
if [[ -d node_modules/electron && ! -x "$ELECTRON_BIN" ]]; then
  say "Electron binary missing — unpacking…"
  ZIP="$(find "$HOME/.cache/electron" -name 'electron-*-linux-*.zip' 2>/dev/null | head -1 || true)"
  if [[ -z "$ZIP" ]]; then
    node node_modules/electron/install.js >/dev/null 2>&1 || true
    ZIP="$(find "$HOME/.cache/electron" -name 'electron-*-linux-*.zip' 2>/dev/null | head -1 || true)"
  fi
  if [[ -n "$ZIP" ]] && command -v unzip >/dev/null 2>&1; then
    rm -rf node_modules/electron/dist
    unzip -q "$ZIP" -d node_modules/electron/dist
    printf 'electron' > node_modules/electron/path.txt
  fi
fi

# Prefer Wayland, fall back to X11 automatically.
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"

say "Launching…"
echo "└───────────────────────────────────────────────────"
exec npm start
