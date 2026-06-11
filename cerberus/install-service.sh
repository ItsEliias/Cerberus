#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="$SCRIPT_DIR/cerberus-ui.service"

if [ ! -f "$SERVICE_FILE" ]; then
  echo "Error: cerberus-ui.service not found in $SCRIPT_DIR"
  exit 1
fi

echo "Installing Cerberus UI service..."
echo "Make sure you've edited cerberus-ui.service with your username and paths first!"
echo ""

sudo cp "$SERVICE_FILE" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cerberus-ui
sudo systemctl start cerberus-ui
sudo systemctl status cerberus-ui
