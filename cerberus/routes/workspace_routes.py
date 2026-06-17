"""Workspace API — browse server directories to pick a tool workspace folder."""
import os
from fastapi import APIRouter, Request, HTTPException, Query

from src.cerberus_config import data_dir
from src.cerberus_mount_workspace import NOT_MOUNTED_WARNING, container_root, is_mounted
from src.cerberus_workspace import load_workspace
from src.auth_helpers import get_current_user
from src.tool_security import owner_is_admin_or_single_user


def setup_workspace_routes():
    router = APIRouter(prefix="/api/workspace", tags=["workspace"])

    @router.get("/browse")
    def browse(request: Request, path: str = Query(default="")):
        """List subdirectories of `path` (default: home) so the UI can navigate
        the server filesystem and pick a workspace folder. Directories only.

        ADMIN-ONLY: this enumerates the server filesystem, so it is gated the
        same way the file/shell tools are (read_file/write_file/bash are in
        NON_ADMIN_BLOCKED_TOOLS). A non-admin who can't use those tools must not
        be able to map the host's directory tree either.
        """
        owner = get_current_user(request)
        if not owner_is_admin_or_single_user(owner):
            raise HTTPException(status_code=403, detail="Workspace browsing is admin-only")

        ws = load_workspace(data_dir())
        docker_mode = (ws.get("workspace_mode") or "docker_mount") == "docker_mount"
        raw = path.strip()

        if docker_mode:
            if not is_mounted():
                return {
                    "path": "",
                    "parent": None,
                    "dirs": [],
                    "warning": NOT_MOUNTED_WARNING,
                }
            default_start = ws.get("workspace_container_root") or container_root()
            if not raw:
                raw = default_start
            elif raw in ("~", "/app", "/app/"):
                raw = default_start

        # Resolve symlinks so the reported path is canonical and the UI navigates
        # real directories (defends against symlink games in displayed paths).
        target = os.path.realpath(os.path.expanduser(raw or "~"))
        if docker_mode and not target.startswith(os.path.realpath(container_root())):
            target = os.path.realpath(container_root())
        if not os.path.isdir(target):
            if docker_mode and is_mounted():
                target = os.path.realpath(container_root())
            else:
                target = os.path.realpath(os.path.expanduser("~"))

        dirs = []
        try:
            with os.scandir(target) as it:
                for entry in it:
                    try:
                        # Don't follow symlinks when classifying — a symlinked
                        # dir is skipped rather than letting the browser wander
                        # off via a link. Hidden entries are omitted.
                        if entry.is_dir(follow_symlinks=False) and not entry.name.startswith("."):
                            # Build the child path server-side with os.path.join
                            # so it's correct on Windows (backslashes) and Linux.
                            dirs.append({"name": entry.name, "path": os.path.join(target, entry.name)})
                    except OSError:
                        continue
        except (PermissionError, OSError):
            dirs = []

        parent = os.path.dirname(target)
        return {
            "path": target,
            "parent": parent if parent and parent != target else None,
            "dirs": sorted(dirs, key=lambda d: d["name"].lower()),
        }

    return router
