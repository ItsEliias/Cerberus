#!/usr/bin/env bash
# Cerberus — Linux native desktop launcher.
#
# Runs Cerberus as a native GTK/WebKit window (FastAPI/uvicorn in-process on a
# private 127.0.0.1 port — nothing is exposed on the network). This is the light
# way to run the UI without Docker; Docker-backed features (OpenSandbox code
# execution, ChromaDB vectors, SearXNG search) stay off unless you enable them in
# Settings and run the full stack — see ./run-linux-docker.sh for that.
#
#   ./run-linux.sh              # launch (setting up on first run)
#   ./run-linux.sh --smoke      # boot the server, check health, exit (no window)
#   ./run-linux.sh --reinstall  # rebuild the venv from scratch
#
# Prereqs (Arch/Omarchy):  sudo pacman -S --needed python webkit2gtk-4.1 python-gobject gtk3
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
VENV=".venv"

if [[ "${1:-}" == "--reinstall" ]]; then rm -rf "$VENV"; shift || true; fi

# The GTK/WebKit backend comes from the system (python-gobject + webkit2gtk-4.1),
# so the venv must expose system site-packages.
setup=0
if [[ ! -x "$VENV/bin/python" ]]; then
  setup=1
else
  # Ensure an existing venv can see the system PyGObject.
  if ! grep -qi '^include-system-site-packages = true' "$VENV/pyvenv.cfg" 2>/dev/null; then
    sed -i 's/^include-system-site-packages *=.*/include-system-site-packages = true/I' "$VENV/pyvenv.cfg" || setup=1
  fi
  "$VENV/bin/python" -c 'import gi' >/dev/null 2>&1 || setup=1
fi

if [[ "$setup" == 1 ]]; then
  echo "Setting up Python environment (first run)…"
  rm -rf "$VENV"
  python3 -m venv --system-site-packages "$VENV"
  "$VENV/bin/pip" -q install --upgrade pip
  "$VENV/bin/pip" -q install -r requirements.txt
fi

# pywebview is the desktop-only dependency (not in requirements.txt); ensure it.
if ! "$VENV/bin/python" -c 'import webview' >/dev/null 2>&1; then
  echo "Installing desktop window runtime (pywebview)…"
  "$VENV/bin/pip" -q install pywebview
fi

# --smoke: headless boot check, no display needed.
if [[ "${1:-}" == "--smoke" ]]; then
  exec "$VENV/bin/python" desktop.py --smoke
fi

# Verify the GTK/WebKit runtime before opening a window.
if ! "$VENV/bin/python" - <<'PY' 2>/dev/null
import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
PY
then
  echo "Missing GTK/WebKit runtime. Install it with:"
  echo "  sudo pacman -S --needed webkit2gtk-4.1 python-gobject gtk3"
  exit 1
fi

exec "$VENV/bin/python" desktop.py
