# Atlas Desktop Bridge V1

Small Windows-side service that lets Atlas (running in Docker) launch **whitelisted** desktop apps from a configurable registry.

## Requirements

- Windows host with Atlas workspace at `C:\AtlasWorkspace`
- Python 3.10+
- Apps configured in `desktop_bridge/apps.json`

## Install

```powershell
cd desktop_bridge
pip install -r requirements.txt
```

## App registry (`apps.json`)

All launch targets live in `desktop_bridge/apps.json`. Each entry supports:

| Field | Purpose |
|-------|---------|
| `id` | Stable app ID sent by Atlas (`cursor`, `brave`, …) |
| `display_name` | Human label |
| `aliases` | Voice/text phrases mapped to this app |
| `type` | `folder_exe`, `windows_builtin`, `url`, `uri`, `store_app` |
| `path` / `exe` | For `folder_exe`: folder + executable name (joined safely) |
| `uri` / `url` | For protocol / web launches |
| `env_path_key` | Override via env (e.g. `ATLAS_CURSOR_PATH`) |
| `fallback_paths` / `fallback_exes` / `search_glob` | Discovery when default path missing |

Example Cursor entry:

```json
{
  "id": "cursor",
  "display_name": "Cursor",
  "aliases": ["cursor", "open cursor"],
  "type": "folder_exe",
  "path": "%LOCALAPPDATA%\\Programs\\cursor",
  "exe": "Cursor.exe",
  "env_path_key": "ATLAS_CURSOR_PATH",
  "enabled": false
}
```

`folder_exe` fixes `[WinError 2]` by resolving the **full executable path** (`folder\exe`) before `subprocess.Popen` — never relying on PATH alone.

## Configure

1. Edit `apps.json` paths for your machine, or set env overrides:

```powershell
$env:ATLAS_CURSOR_PATH = "%LOCALAPPDATA%\Programs\cursor\Cursor.exe"
$env:ATLAS_BRIDGE_TOKEN = "change-this-token"
```

2. In Atlas `data/atlas/desktop_permissions.json`:

```json
{
  "desktop_commands_enabled": true,
  "bridge_url": "http://host.docker.internal:8765",
  "bridge_token": "change-this-token"
}
```

3. Restart Atlas Docker container after editing permissions.

## Run

```powershell
$env:ATLAS_BRIDGE_TOKEN = "change-this-token"
python desktop_bridge.py
```

Bridge listens on `http://127.0.0.1:8765`. Resolved apps are logged at startup.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health + `app_count`, `available_apps`, `missing_apps` |
| GET | `/apps` | Full registry with resolution status per app |
| POST | `/command` | Run whitelisted command (`X-Atlas-Bridge-Token` required) |

### Command examples

```json
{ "command": "open_app", "args": { "app": "cursor" } }
{ "command": "open_url", "args": { "url": "https://www.youtube.com" } }
{ "command": "open_project_in_cursor", "args": { "path": "C:\\AtlasWorkspace\\Projects\\MyProject" } }
```

Failed launches return `attempted_paths` for diagnostics.

## Safety

- No arbitrary shell commands or user-provided executables
- Only apps from `apps.json` (enabled entries)
- URLs: `http`/`https` only
- URIs: approved schemes only (`com.epicgames.launcher`, `steam`, `spotify`, `whatsapp`, …)
- Project paths must stay under `C:\AtlasWorkspace\Projects`
- Token required on every command
- All launches logged to `C:\AtlasWorkspace\Logs\desktop_bridge.log`

## Atlas UI

Home briefing panel and Project HQ include **View Apps**, **Test Open Cursor**, and **Test Open Browser** when the bridge is online.
