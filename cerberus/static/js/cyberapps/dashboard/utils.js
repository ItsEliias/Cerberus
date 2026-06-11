/**
 * static/js/cyberapps/dashboard/utils.js
 * Dashboard — shared utility functions (no DOM deps).
 */

/**
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** @param {string} s @param {number} n @returns {string} */
export function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n) + '…' : (s || '—');
}

/** @param {string} s @returns {string} */
export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** @param {string} s @returns {string} */
export function humanizeEvent(s) {
  const MAP = {
    'session:started': 'Started session', 'session:ended': 'Ended session',
    'session:saved': 'Saved session', 'target:added': 'Added target',
    'target:removed': 'Removed target', 'note:saved': 'Saved note',
    'note:created': 'Created note', 'vault:unlocked': 'Unlocked vault',
    'vault:locked': 'Locked vault', 'credential:added': 'Added credential',
    'credential:search': 'Searched credentials',
    'playbook:started': 'Started playbook', 'playbook:completed': 'Completed playbook',
    'report:generated': 'Generated report', 'report:exported': 'Exported report',
    'scrape:started': 'Started scrape', 'scrape:completed': 'Completed scrape',
    'signal:received': 'Received signal', 'graph:imported': 'Imported graph',
    'command:executed': 'Executed command', 'lab:started': 'Started lab',
    'lab:completed': 'Completed lab', 'lab:end': 'Ended lab',
    'flag:captured': 'Captured flag', 'config:updated': 'Config updated',
  };
  return MAP[s] || s.replace(/[_:]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** @param {string} appName @returns {string} */
export function appAccentColor(appName) {
  const MAP = {
    'CyberLab': '#b44fff', 'Cyberlab': '#b44fff',
    'ReconDesk': '#d29922', 'GhostVault': '#7bb8ff',
    'VaultCore': '#3fb950', 'VaultScraper': '#3fb950',
    'SignalBoard': '#ff6b6b', 'CredVault': '#f78166',
    'PlaybookStudio': '#4a9eff', 'ReportForge': '#3fb950',
    'TerminalLink': '#00ff41', 'NetworkMap': '#d29922',
    'CyberOS': '#b44fff', 'Launcher': '#b44fff',
    'Dashboard': '#4a9eff', 'AgenticOS': '#ff9500',
  };
  return MAP[appName] || '#4a9eff';
}

/**
 * Build app card definitions from a status snapshot object.
 * @param {Record<string, any>} statuses
 * @returns {Array}
 */
export function buildAppCards(statuses) {
  const s = statuses || {};
  const cl = s.cyberlab || {};
  const rd = s.recondesk || {};
  const gv = s.ghostvault || {};
  const vc = s.vaultcore || {};
  const sb = s.signalboard || {};
  const cv = s.credvault || {};
  const ps = s.playbookstudio || {};
  const rf = s.reportforge || {};
  const tl = s.terminallink || {};
  const nm = s.networkmap || {};

  return [
    {
      id: 'cyberlab', name: 'CyberLab', accentColor: '#b44fff',
      active: !!cl.active, lastActive: cl.lastActive,
      metrics: [
        { label: 'Session', value: cl.currentLab || 'No active session' },
        { label: 'Findings', value: cl.findingsCount ?? 0 },
      ],
    },
    {
      id: 'recondesk', name: 'ReconDesk', accentColor: '#d29922',
      active: !!rd.active, lastActive: rd.lastActive,
      metrics: [
        { label: 'Targets', value: rd.targetCount ?? 0 },
        { label: 'Cards', value: rd.cardCount ?? 0 },
      ],
    },
    {
      id: 'credvault', name: 'CredVault', accentColor: '#f78166',
      active: !!cv.active, lastActive: cv.lastActive,
      metrics: [
        { label: 'Credentials', value: cv.credentialCount ?? 0 },
        { label: 'Lock', value: cv.locked ? 'Locked' : 'Unlocked' },
      ],
    },
    {
      id: 'vaultcore', name: 'VaultCore', accentColor: '#3fb950',
      active: !!vc.active, lastActive: vc.lastActive,
      metrics: [
        { label: 'Vault notes', value: vc.vaultNoteCount ?? 0 },
        { label: 'Sources', value: vc.totalSources ?? 0 },
      ],
    },
    {
      id: 'networkmap', name: 'NetworkMap', accentColor: '#d29922',
      active: !!nm.active, lastActive: nm.lastActive,
      metrics: [
        { label: 'Graph', value: nm.currentGraph || 'No active graph' },
        { label: 'Nodes', value: nm.nodeCount ?? 0 },
      ],
    },
    {
      id: 'netlab', name: 'NetLab', accentColor: '#4a9eff',
      active: !!s.netlab?.active, lastActive: s.netlab?.lastActive,
      metrics: [
        { label: 'Status', value: s.netlab?.active ? 'Active' : 'Idle' },
      ],
    },
    {
      id: 'terminallink', name: 'TerminalLink', accentColor: '#00ff41',
      active: !!tl.active, lastActive: tl.lastActive,
      metrics: [
        { label: 'Commands', value: tl.commandCount ?? 0 },
      ],
    },
    {
      id: 'signalboard', name: 'SignalBoard', accentColor: '#ff6b6b',
      active: !!sb.active, lastActive: sb.lastActive,
      metrics: [
        { label: 'Unread', value: sb.unreadCount ?? 0 },
      ],
    },
    {
      id: 'ghostvault', name: 'GhostVault', accentColor: '#7bb8ff',
      active: !!gv.active, lastActive: gv.lastActive,
      metrics: [
        { label: 'Notes', value: gv.noteCount ?? 0 },
      ],
    },
    {
      id: 'playbookstudio', name: 'PlaybookStudio', accentColor: '#4a9eff',
      active: !!ps.active, lastActive: ps.lastActive,
      metrics: [
        { label: 'Active', value: ps.activePlaybook || 'Idle' },
      ],
    },
    {
      id: 'reportforge', name: 'ReportForge', accentColor: '#3fb950',
      active: !!rf.active, lastActive: rf.lastActive,
      metrics: [
        { label: 'Reports', value: rf.reportCount ?? 0 },
      ],
    },
  ];
}

/**
 * Normalize a raw event from any schema variant to a common shape.
 * @param {Record<string, any>} raw
 * @returns {{id:string, timestamp:string, app:string, event:string, data:Record<string, any>}}
 */
export function normalizeEvent(raw) {
  return {
    id: raw.id || String(Math.random()),
    timestamp: raw.timestamp || new Date().toISOString(),
    app: raw.app || raw.appName || 'Unknown',
    event: raw.event || raw.eventType || 'unknown',
    data: raw.data || {},
  };
}

/**
 * Format seconds as HH:MM:SS or MM:SS.
 * @param {number} seconds
 * @returns {string}
 */
export function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
