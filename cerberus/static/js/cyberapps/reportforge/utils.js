/**
 * static/js/cyberapps/reportforge/utils.js
 * Shared utilities for ReportForge.
 */

export function makeId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

export const SEV_COLORS = {
  critical: '#ff4444',
  high:     '#ff6b35',
  medium:   '#f0a500',
  low:      '#3fb950',
  info:     '#8b949e',
};

export function sevBadge(severity) {
  const color = SEV_COLORS[severity] ?? '#8b949e';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:${color}22;color:${color};border:1px solid ${color}55;">${severity}</span>`;
}

export async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${url} → ${res.status}: ${text}`);
  }
  return res.json();
}

export function fmtDate(iso) { return iso ? iso.slice(0, 10) : ''; }

export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function downloadText(content, filename, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function sectionsFromTitles(titles) {
  return titles.map((title, i) => ({
    id: makeId(), title, content: '', order: i, visible: true, type: 'body', comments: [],
  }));
}

export function makeBlankReport(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: makeId(), createdAt: now, updatedAt: now,
    title: 'Untitled Report', targetName: '', targetIP: '',
    platform: 'THM', assessmentDate: now.slice(0, 10), operator: '',
    status: 'draft',
    sections: sectionsFromTitles([
      'Cover', 'Executive Summary', 'Scope', 'Methodology',
      'Findings', 'Credentials Discovered', 'Recommendations', 'Appendix',
    ]),
    findings: [],
    variables: { client_name: '', test_date: now.slice(0, 10), tester_name: '', scope: '', engagement_type: '' },
    versions: [], watermark: 'none',
    ...overrides,
  };
}

export function makeBlankFinding(overrides = {}) {
  return {
    id: makeId(), title: '', severity: 'medium',
    description: '', evidence: '', impact: '', recommendation: '', references: [],
    ...overrides,
  };
}
