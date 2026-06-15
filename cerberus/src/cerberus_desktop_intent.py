"""Parse voice/text into whitelisted Atlas desktop commands."""



from __future__ import annotations



import json

import re

import unicodedata

from pathlib import Path

from typing import Any, Dict, List, Optional, Tuple

from urllib.parse import quote_plus



from src.cerberus_config import load_projects

from src.cerberus_desktop import load_desktop_permissions



_CONFIRM_WORDS = frozenset({

    "yes", "yeah", "yep", "yup", "confirm", "confirmed", "do it", "go ahead",

    "ok", "okay", "proceed", "sure", "affirmative", "please do",

})

_CANCEL_WORDS = frozenset({

    "no", "nope", "cancel", "cancelled", "canceled", "stop", "never mind",

    "nevermind", "don't", "dont", "abort",

})



_ACTION_PREFIX = re.compile(

    r"^(?:(?:hey\s+)?atlas\s+)?(?:(?:can\s+you|could\s+you|please)\s+)?"

    r"(?:open|launch|start|activate|run|play)\s+",

    re.IGNORECASE,

)



_KNOWN_URL_SITES = {

    "supabase": "https://supabase.com/dashboard",

    "base44": "https://base44.com",

    "chatgpt": "https://chatgpt.com",

    "github website": "https://github.com",

    "github.com": "https://github.com",

    "reddit": "https://www.reddit.com",

    "youtube": "https://www.youtube.com",

    "google": "https://www.google.com",

}

_CLOSE_PREFIX = re.compile(

    r"^(?:(?:hey\s+)?atlas\s+)?(?:close|exit|terminate|quit|stop)\s+",

    re.IGNORECASE,

)

_CLOSE_ALIASES: Dict[str, str] = {}





def _normalize(text: str) -> str:

    t = unicodedata.normalize("NFKC", (text or "").strip().lower())

    t = re.sub(r"[^\w\s'-]", " ", t)

    t = re.sub(r"\s+", " ", t).strip()

    return t





def _load_alias_index() -> Dict[str, List[str]]:
    from src.cerberus_launcher_apps import build_alias_index
    return build_alias_index()





def _strip_action_prefix(norm: str) -> str:

    m = _ACTION_PREFIX.match(norm)

    if m:

        return norm[m.end():].strip()

    return norm





def _match_app_aliases(text: str) -> List[str]:
    from src.cerberus_launcher_apps import match_apps

    norm = re.sub(r"\s+", " ", (text or "").strip().lower())
    if not norm:
        return []
    apps = match_apps(norm)
    return [(a.get("id") or "").lower() for a in apps if a.get("id")]





def _resolve_project(query: str, projects: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:

    q = _normalize(query)

    if not q:

        return None

    q_compact = q.replace(" ", "").replace("-", "")



    for p in projects:

        pid = (p.get("id") or "").lower()

        pname = (p.get("name") or "").lower()

        if q == pid or q == pname:

            return p

    for p in projects:

        pid = (p.get("id") or "").lower()

        pname = (p.get("name") or "").lower()

        if q in pname or pname in q:

            return p

        if q_compact and (q_compact in pid.replace("-", "") or pid.replace("-", "") in q_compact):

            return p

    return None





def _youtube_search_url(topic: str) -> str:

    q = (topic or "").strip()

    if not q:

        return "https://www.youtube.com/"

    return f"https://www.youtube.com/results?search_query={quote_plus(q)}"





def _extract_youtube_topic(norm: str) -> Optional[str]:

    patterns = [

        r"^(?:find|search)\s+(?:video|videos)\s+about\s+(.+)$",

        r"^(?:watch|find)\s+video\s+about\s+(.+)$",

        r"^(?:open|play|watch|find|show|search)\s+(?:me\s+)?(?:a\s+)?(?:the\s+)?(?:best\s+)?(?:video|videos)\s+(?:about|on|for)\s+(.+)$",

        r"^(?:find|search)\s+(?:the\s+)?(?:best\s+)?(?:video|videos)\s+(?:about|on|for)\s+(.+)$",

        r"^(?:open|play|watch)\s+(.+?)\s+on\s+youtube$",

        r"^(?:open|play|watch)\s+youtube\s+(?:and\s+)?(?:search\s+for\s+|for\s+)?(.+)$",

        r"^youtube\s+(?:search\s+)?(?:for\s+)?(.+)$",

        r"^(?:i\s+)?(?:want\s+to\s+)?watch\s+(?:a\s+)?(?:video\s+)?(?:about|on)\s+(.+)$",

        r"^(?:play|open)\s+(?:something\s+about|a\s+video\s+about)\s+(.+)$",

        r"^(?:i\s+)?want\s+to\s+watch\s+(?:something\s+)?(?:about|on)\s+(.+)$",

        r"^(?:show\s+me\s+)?(?:a\s+)?video\s+(?:about|on)\s+(.+)$",

    ]

    for pat in patterns:

        m = re.match(pat, norm)

        if m:

            topic = m.group(1).strip()

            topic = re.sub(r"\s+on\s+youtube$", "", topic).strip()

            topic = re.sub(r"\s+video$", "", topic).strip()

            if topic and topic not in ("youtube", "a video"):

                return topic

    if norm in ("open youtube", "launch youtube", "youtube", "watch youtube", "you tube"):

        return ""

    return None





def _project_action_prefixes() -> Tuple[str, ...]:

    return (

        r"^(?:(?:hey\s+)?atlas\s+)?(?:(?:can\s+you|could\s+you|please)\s+)?"

        r"(?:open|launch|start|activate|run)\s+",

    )





def parse_desktop_intent(

    text: str,

    *,

    active_project_id: Optional[str] = None,

) -> Dict[str, Any]:

    """Return matched desktop command metadata or matched=False."""

    raw = (text or "").strip()

    norm = _normalize(raw)

    if not norm:

        return {"matched": False}



    perms = load_desktop_permissions()

    from src.cerberus_launcher_apps import get_enabled_app_ids

    allowed_apps = {**get_enabled_app_ids(), **{k.lower(): v for k, v in (perms.get("allowed_apps") or {}).items()}}

    allowed_actions = set(perms.get("allowed_actions") or [])

    require_confirmation = bool(perms.get("require_confirmation", False))



    projects = load_projects()

    active = next((p for p in projects if p.get("id") == active_project_id), None)



    def _hit(command: str, args: Dict[str, Any], label: str, *, browser: Optional[str] = None) -> Dict[str, Any]:

        if command not in allowed_actions:

            return {"matched": False, "reason": "action_not_allowed"}

        if command in ("open_app", "close_app"):

            app = (args.get("app") or "").lower()

            if app not in allowed_apps:

                return {"matched": False, "reason": "app_not_whitelisted"}

        if command == "open_url" and browser:

            if browser.lower() not in allowed_apps:

                return {"matched": False, "reason": "browser_not_whitelisted"}

        return {

            "matched": True,

            "command": command,

            "args": args,

            "label": label,

            "require_confirmation": False,

            "speak_prompt": "",

        }



    proj_prefix = (

        r"^(?:(?:hey\s+)?atlas\s+)?(?:(?:can\s+you|could\s+you|please)\s+)?"

        r"(?:open|launch|start|activate|run)\s+"

    )



    # open [project] in cursor

    m = re.match(proj_prefix + r"(.+?)\s+in\s+cursor$", norm)

    if m:

        proj = _resolve_project(m.group(1), projects)

        if proj:

            name = proj.get("name") or proj.get("id")

            return _hit("open_project_in_cursor", {"project_id": proj.get("id")}, f"Open {name} in Cursor")



    # open [project] folder

    m = re.match(proj_prefix + r"(.+?)\s+folder$", norm)

    if m and m.group(1) not in ("project", "the project", "my project"):

        proj = _resolve_project(m.group(1), projects)

        if proj:

            name = proj.get("name") or proj.get("id")

            return _hit("open_folder", {"project_id": proj.get("id")}, f"Open {name} project folder")



    # open project folder / open folder (active)

    if norm in (

        "open project folder",

        "open the project folder",

        "open my project folder",

        "open folder",

        "open active project folder",

    ):

        if active:

            name = active.get("name") or active.get("id")

            return _hit("open_folder", {"project_id": active.get("id")}, f"Open {name} project folder")

        return {

            "matched": True,

            "error": True,

            "message": "No active project set. Say open [project name] folder or set an active project first.",

            "require_confirmation": False,

        }



    # browser on [site]

    m = re.match(r"^(?:open\s+)?browser\s+on\s+(.+)$", norm)

    if m:

        site = m.group(1).strip()

        if site in ("google", "google.com"):

            return _hit("open_url", {"url": "https://www.google.com", "browser": "brave"}, "Open Google in browser", browser="brave")

        if site in _KNOWN_URL_SITES:

            return _hit("open_url", {"url": _KNOWN_URL_SITES[site]}, f"Open {site}")

        if not site.startswith("http"):

            return _hit("open_url", {"url": f"https://{site}"}, f"Open {site} in browser")



    # known web shortcuts

    for site_key, url in _KNOWN_URL_SITES.items():

        if norm in (f"open {site_key}", f"launch {site_key}", site_key):

            return _hit("open_url", {"url": url}, f"Open {site_key}")



    # open github → website unless desktop/app specified

    if norm in ("open github", "launch github"):

        return _hit("open_url", {"url": "https://github.com"}, "Open GitHub website")



    # YouTube / video topics (before generic app match)

    topic = _extract_youtube_topic(norm)

    if topic is not None:

        if topic:

            url = _youtube_search_url(topic)

            label = f"Search YouTube for {topic}"

        else:

            url = "https://www.youtube.com/"

            label = "Open YouTube"

        return _hit("open_url", {"url": url}, label)



    close_m = _CLOSE_PREFIX.match(norm)

    if close_m:

        close_target = norm[close_m.end():].strip()

        close_ids = _match_app_aliases(_CLOSE_ALIASES.get(close_target) or close_target)
        app_id = close_ids[0] if len(close_ids) == 1 else None

        if app_id and app_id in allowed_apps:

            display = app_id.replace("githubdesktop", "GitHub Desktop").replace("leagueoflegends", "League of Legends")

            return _hit("close_app", {"app": app_id}, f"Close {display}")



    tail = _strip_action_prefix(norm)

    if not tail:

        return {"matched": False}



    app_ids = _match_app_aliases(tail)

    if len(app_ids) > 1:
        from src.cerberus_launcher_apps import get_app_by_id
        names = [get_app_by_id(aid).get("name") or aid for aid in app_ids if get_app_by_id(aid)]
        return {
            "matched": True,
            "error": True,
            "message": f"Multiple apps match '{tail}': {', '.join(names)}. Please say the full app name.",
            "require_confirmation": False,
        }

    if len(app_ids) == 1:
        app_id = app_ids[0]
        from src.cerberus_launcher_apps import get_app_by_id
        app = get_app_by_id(app_id) or {}
        display = app.get("name") or app_id
        label = f"Open {display}"
        if app_id not in allowed_apps:
            return {
                "matched": True,
                "error": True,
                "message": f"No app configured for {display}. Add it in Settings → Desktop Bridge.",
                "require_confirmation": False,
            }
        return _hit("open_app", {"app": app_id}, label)

    if _ACTION_PREFIX.match(norm):
        return {
            "matched": True,
            "error": True,
            "message": f"No app configured for {tail}. Add it in Settings → Desktop Bridge.",
            "require_confirmation": False,
        }

    return {"matched": False}





def classify_confirmation_reply(text: str) -> str:

    """Return confirm, cancel, or other."""

    norm = _normalize(text)

    if not norm:

        return "other"

    words = set(norm.split())

    if words & _CONFIRM_WORDS or norm in _CONFIRM_WORDS:

        return "confirm"

    if words & _CANCEL_WORDS or norm in _CANCEL_WORDS:

        return "cancel"

    if norm.startswith("yes ") or norm.startswith("yeah "):

        return "confirm"

    if norm.startswith("no ") or norm.startswith("cancel"):

        return "cancel"

    return "other"

