#!/usr/bin/env bash
# Cerberus — full stack on Linux via Docker Compose.
#
# Brings up the complete Cerberus stack (web app + gateway + ChromaDB + SearXNG +
# ntfy + OpenSandbox) and opens the UI. This is the full-featured way to run
# Cerberus; the sandbox code-execution and vector features need these containers.
#
#   ./run-linux-docker.sh          # build + start, then open the UI
#   ./run-linux-docker.sh down     # stop the stack
#   ./run-linux-docker.sh logs     # follow logs
#
# Prereqs: Docker Engine + Compose v2 (Omarchy/Arch:  sudo pacman -S docker docker-compose,
# then `sudo systemctl enable --now docker` and add yourself to the `docker` group).
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 not found. Install Docker + the compose plugin first."; exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Can't talk to the Docker daemon. Start it and ensure you're in the 'docker' group:"
  echo "  sudo systemctl enable --now docker && sudo usermod -aG docker \"$USER\"  (then re-login)"
  exit 1
fi

case "${1:-up}" in
  down) exec docker compose down ;;
  logs) exec docker compose logs -f ;;
esac

# First run needs a .env. Seed it from the example and let the user fill in secrets.
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — review it and set your API keys / admin password."
fi

APP_PORT="$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2)"; APP_PORT="${APP_PORT:-7000}"
URL="http://127.0.0.1:${APP_PORT}/"

echo "Building & starting the stack (first build can take several minutes)…"
docker compose up -d --build

echo "Waiting for the web UI at $URL …"
for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done

command -v xdg-open >/dev/null && xdg-open "$URL" >/dev/null 2>&1 || echo "Open $URL in your browser."
echo "Up. Stop with:  ./run-linux-docker.sh down"
