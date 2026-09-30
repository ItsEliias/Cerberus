# Running Cerberus Recon on Linux

Cerberus Recon runs natively on Linux (tested on Omarchy / Arch, Hyprland + Wayland).
It's the same Electron app as on macOS — this doc covers the Linux launcher and
desktop integration.

## Quick start

```bash
./run-linux.sh
```

First run installs dependencies, vendors the terminal engine, rebuilds the native
`node-pty` module for Electron, and makes sure the Electron binary is unpacked.
Later runs launch straight away. Force a clean reinstall with `./run-linux.sh --reinstall`.

Prerequisite: **Node.js** (LTS or newer) + npm — `sudo pacman -S nodejs npm`.

## Install it into your app launcher

```bash
./packaging/linux/install.sh
```

This adds a **Cerberus Recon** entry (with icon) to `~/.local/share/applications`,
so it shows up in walker/wofi/rofi and your dock. Uninstall with
`./packaging/linux/install.sh -u`. No root required.

## Notes for this platform

- **Wayland:** the launcher sets `ELECTRON_OZONE_PLATFORM_HINT=auto`, so Electron
  uses Wayland when available and falls back to X11 automatically.
- **Native build needs Python's `distutils`:** removed from Python 3.12+. If the
  system Python lacks it, `run-linux.sh` transparently builds `node-pty` against a
  throwaway venv with `setuptools` (which still provides `distutils`) — no action
  needed. To fix it system-wide instead: `sudo pacman -S python-setuptools`.
- **Electron binary extraction:** on very new Node the bundled installer can leave
  the Electron archive un-extracted; `run-linux.sh` detects this and unpacks the
  cached archive itself.
- The window's Wayland app-id is `Cerberus Recon`, matched by the desktop entry's
  `StartupWMClass` so the icon associates correctly.
