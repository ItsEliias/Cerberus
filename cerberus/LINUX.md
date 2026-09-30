# Running Cerberus on Linux

There are two ways to run Cerberus on Linux. Tested on Omarchy / Arch (Hyprland +
Wayland).

## 1. Native desktop app (light, no Docker)

Runs the Cerberus UI as a native GTK/WebKit window — FastAPI/uvicorn in-process on
a private `127.0.0.1` port, nothing exposed on the network.

```bash
./run-linux.sh
```

First run sets up the virtualenv and installs dependencies; later runs just launch.
`--smoke` boots the server, checks `/api/health`, and exits (no window); `--reinstall`
rebuilds the venv.

### Prerequisites (Arch / Omarchy)

```bash
sudo pacman -S --needed python webkit2gtk-4.1 python-gobject gtk3
```

The window's GTK/WebKit backend comes from the **system** (`python-gobject` +
`webkit2gtk-4.1`), so the venv uses `--system-site-packages`; `pywebview` (the
desktop-only dependency, not in `requirements.txt`) is installed into the venv
automatically.

In this mode the **Docker-backed features stay off** — OpenSandbox code execution,
ChromaDB vectors and SearXNG search. The app boots and degrades gracefully (those
features retry lazily / report unavailable). Chat against an external or local LLM,
documents, notes and the cockpit UI all work. For the full experience, use Docker:

## 2. Full stack (Docker Compose)

Brings up the complete stack (web app + gateway + ChromaDB + SearXNG + ntfy +
OpenSandbox) — this is what powers sandboxed agent execution and vector features.

```bash
./run-linux-docker.sh          # build + start, then open the UI
./run-linux-docker.sh down     # stop
./run-linux-docker.sh logs     # follow logs
```

First run seeds `.env` from `.env.example` — review it and set your API keys and
admin password. Requires Docker Engine + Compose v2:

```bash
sudo pacman -S docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # then log out / back in
```

## Install into your app launcher

```bash
./packaging/linux/install.sh
```

Adds a **Cerberus** entry (native-app mode, with icon) to
`~/.local/share/applications` for walker/wofi/rofi and the dock. Uninstall with
`./packaging/linux/install.sh -u`. No root required.

## Notes

- The native window's Wayland app-id is set to `cerberus` (via `GLib.set_prgname`
  in `desktop.py`) so it matches the desktop entry's `StartupWMClass`.
- Per-user data lives under `$XDG_DATA_HOME/Cerberus` (or `~/.local/share/Cerberus`).
