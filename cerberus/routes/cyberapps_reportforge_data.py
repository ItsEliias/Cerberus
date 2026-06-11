"""
routes/cyberapps_reportforge_data.py
ReportForge — built-in templates and Markdown assembler.
Kept separate from routes to stay under 500-line limit.
"""

import re
from typing import Any, Dict, List


# ---------------------------------------------------------------------------
# Built-in templates (mirrored from ReportForge src/renderer/lib/defaults.ts)
# ---------------------------------------------------------------------------

BUILTIN_TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "blank",
        "name": "Blank",
        "description": "Start from scratch with a minimal structure",
        "sectionTitles": [
            "Cover", "Executive Summary", "Scope", "Methodology",
            "Findings", "Credentials Discovered", "Recommendations", "Appendix",
        ],
    },
    {
        "id": "ptes",
        "name": "PTES",
        "description": "Penetration Testing Execution Standard — professional pentest report",
        "sectionTitles": [
            "Executive Summary", "Scope and Rules of Engagement", "Methodology",
            "Findings", "Risk Rating Matrix", "Remediation Roadmap", "Appendices",
        ],
    },
    {
        "id": "owasp-web",
        "name": "OWASP Web",
        "description": "Web application security assessment following OWASP Testing Guide",
        "sectionTitles": [
            "Executive Summary", "Application Overview", "Scope", "Methodology",
            "OWASP Top 10 Coverage", "Findings", "Remediation Summary", "Appendices",
        ],
    },
    {
        "id": "htb-machine",
        "name": "HTB Machine",
        "description": "HackTheBox machine writeup format",
        "sectionTitles": [
            "Machine Overview", "Reconnaissance", "Foothold", "Lateral Movement",
            "Privilege Escalation", "Flags", "Key Takeaways", "Tools Used",
        ],
    },
    {
        "id": "network-pentest",
        "name": "Network Pentest",
        "description": "Internal/external network penetration test report",
        "sectionTitles": [
            "Executive Summary", "Scope and Objectives", "Network Architecture",
            "Methodology", "Findings", "Vulnerability Summary", "Remediation Plan", "Appendix",
        ],
    },
    {
        "id": "active-directory",
        "name": "Active Directory",
        "description": "Active Directory / domain compromise assessment",
        "sectionTitles": [
            "Executive Summary", "Domain Overview", "Scope", "Attack Path",
            "Findings", "Credentials Discovered", "Domain Hardening Recommendations", "Appendix",
        ],
    },
    {
        "id": "api-security",
        "name": "API Security",
        "description": "REST/GraphQL API security assessment report",
        "sectionTitles": [
            "Executive Summary", "API Inventory", "Scope", "Methodology",
            "OWASP API Top 10 Coverage", "Findings", "Remediation Summary", "Appendix",
        ],
    },
    {
        "id": "mobile-app",
        "name": "Mobile App",
        "description": "iOS/Android mobile application security assessment",
        "sectionTitles": [
            "Executive Summary", "Application Overview", "Scope",
            "Static Analysis", "Dynamic Analysis", "Findings", "Remediation Summary", "Appendix",
        ],
    },
    {
        "id": "executive-summary",
        "name": "Executive Summary Only",
        "description": "Concise management-level summary report",
        "sectionTitles": [
            "Executive Summary", "Risk Overview", "Key Findings", "Recommendations",
        ],
    },
]


# ---------------------------------------------------------------------------
# Markdown assembler (ported from ReportForge utils/markdownAssembler.ts)
# ---------------------------------------------------------------------------

_SEV_ORDER = ["critical", "high", "medium", "low", "info"]


def redact_credential_content(content: str) -> str:
    """Replace hash-like/password values in pipe-delimited Markdown table cells."""
    return re.sub(
        r"(\| *[^\n|]+ *\| *)([A-Za-z0-9$./+!@#%^&*]{8,}|[a-f0-9]{32,64})( *\|)",
        r"\1[redacted]\3",
        content,
    )


def assemble_markdown(
    report: Dict[str, Any],
    include_toc: bool = True,
    include_findings_table: bool = True,
    include_credentials: bool = True,
    redact_credentials: bool = True,
    include_raw_nmap: bool = False,
) -> str:
    lines: List[str] = []
    lines.append(f"# {report.get('title', 'Report')}")
    lines.append("")
    target = report.get("targetName", "")
    ip = report.get("targetIP", "")
    target_str = f"{target} ({ip})" if ip else target
    lines.append(
        f"**Target:** {target_str}"
        f" | **Platform:** {report.get('platform', '')}"
        f" | **Date:** {report.get('assessmentDate', '')}"
        f" | **Operator:** {report.get('operator', '')}"
    )
    if report.get("difficulty"):
        lines.append(f"**Difficulty:** {report['difficulty']}")
    lines.append("")

    sections = sorted(
        [s for s in report.get("sections", []) if s.get("visible", True)],
        key=lambda s: s.get("order", 0),
    )
    if not include_credentials:
        sections = [s for s in sections if s.get("title") != "Credentials Discovered"]

    if include_toc and len(sections) > 1:
        lines.append("## Table of Contents")
        lines.append("")
        for i, s in enumerate(sections):
            title = s.get("title", "")
            anchor = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
            lines.append(f"{i + 1}. [{title}](#{anchor})")
        lines.append("")

    findings = report.get("findings", [])
    if include_findings_table and findings:
        sorted_f = sorted(
            findings,
            key=lambda f: _SEV_ORDER.index(f.get("severity", "info"))
            if f.get("severity", "info") in _SEV_ORDER else 99,
        )
        lines.append("## Finding Summary")
        lines.append("")
        lines.append("| # | Title | Severity | CVSS |")
        lines.append("|---|-------|----------|------|")
        for i, f in enumerate(sorted_f):
            lines.append(f"| {i + 1} | {f.get('title', '')} | {f.get('severity', '').upper()} | {f.get('cvss') or '—'} |")
        lines.append("")

    for section in sections:
        title = section.get("title", "")
        content = section.get("content", "")

        if title == "Findings":
            lines.append("## Findings")
            lines.append("")
            grouped: Dict[str, list] = {s: [] for s in _SEV_ORDER}
            for f in findings:
                sev = f.get("severity", "info")
                if sev in grouped:
                    grouped[sev].append(f)
            has_any = False
            for sev in _SEV_ORDER:
                for f in grouped[sev]:
                    has_any = True
                    lines.append(f"### [{sev.upper()}] {f.get('title', '')}")
                    if f.get("cvss"):
                        lines.append(f"**CVSS:** {f['cvss']}")
                    lines.append("")
                    if f.get("description"):
                        lines.append(f"**Description:** {f['description']}")
                        lines.append("")
                    if f.get("evidence"):
                        lines.append("**Evidence:**")
                        lines.append("")
                        lines.append(f["evidence"])
                        lines.append("")
                    if f.get("impact"):
                        lines.append(f"**Impact:** {f['impact']}")
                        lines.append("")
                    if f.get("recommendation"):
                        lines.append(f"**Recommendation:** {f['recommendation']}")
                    if f.get("references"):
                        lines.append("")
                        lines.append("**References:**")
                        for ref in f["references"]:
                            lines.append(f"- {ref}")
                    lines.append("")
            if not has_any:
                lines.append("*No findings recorded.*")
                lines.append("")
        elif title == "Credentials Discovered":
            if not include_credentials:
                continue
            lines.append(f"## {title}")
            lines.append("")
            if redact_credentials:
                content = redact_credential_content(content)
            if content.strip():
                lines.append(content)
            lines.append("")
        else:
            lines.append(f"## {title}")
            lines.append("")
            if content.strip():
                lines.append(content)
            lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# HTML wrapper for standalone export
# ---------------------------------------------------------------------------

def wrap_html(body: str, title: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  body {{ font-family: 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; color: #222; }}
  h1 {{ border-bottom: 2px solid #c0392b; padding-bottom: .4rem; }}
  h2 {{ border-bottom: 1px solid #ddd; padding-bottom: .2rem; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; }}
  th, td {{ border: 1px solid #ddd; padding: 6px 12px; text-align: left; }}
  th {{ background: #f4f4f4; }}
  code {{ background: #f6f6f6; padding: 2px 5px; border-radius: 3px; }}
  pre {{ background: #f6f6f6; padding: 1rem; border-radius: 4px; overflow-x: auto; }}
  @media print {{
    body {{ max-width: none; padding: .5rem; }}
    h1, h2 {{ page-break-after: avoid; }}
    table, pre {{ page-break-inside: avoid; }}
  }}
</style>
</head>
<body>
{body}
</body>
</html>"""
