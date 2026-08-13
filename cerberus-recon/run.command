#!/bin/bash
# Cerberus · Recon — double-click launcher (macOS).
# First run: installs deps, rebuilds node-pty, launches. Later runs: just launches.
# Right-click > Open the first time if Gatekeeper complains about an unsigned script.

cd "$(dirname "$0")" || exit 1

echo "┌─ CERBERUS · RECON ────────────────────────────────"

if ! command -v node >/dev/null 2>&1; then
  echo "│ Node.js isn't installed. Get it from https://nodejs.org (LTS), then re-run."
  echo "└───────────────────────────────────────────────────"
  read -r -p "Press Return to close…" _; exit 1
fi

# Install + native rebuild only when node_modules is missing (first run).
if [ ! -d node_modules ]; then
  echo "│ First run — installing dependencies (1–2 min)…"
  npm install || { echo "│ npm install failed."; read -r -p "Press Return…" _; exit 1; }
  echo "│ Rebuilding the terminal engine for Electron…"
  npm run rebuild || echo "│ (rebuild warning — the app still opens; terminal may need 'npm run rebuild')"
fi

echo "│ Launching…"
echo "└───────────────────────────────────────────────────"
npm start
