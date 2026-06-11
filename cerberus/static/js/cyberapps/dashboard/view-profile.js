/**
 * static/js/cyberapps/dashboard/view-profile.js
 * Dashboard — Profile view: stats row, streak calendar, skill radar,
 * lab history (sourced from operator_profile in the summary response).
 */

import * as State from './state.js';
import { esc, timeAgo } from './utils.js';

// ---------------------------------------------------------------------------
// Rank helper
// ---------------------------------------------------------------------------

function getRank(flags) {
  if (flags >= 200) return { label: 'Elite', color: '#f85149' };
  if (flags >= 100) return { label: 'Expert', color: '#3fb950' };
  if (flags >= 50)  return { label: 'Advanced', color: '#4a9eff' };
  if (flags >= 20)  return { label: 'Intermediate', color: '#d29922' };
  return { label: 'Beginner', color: '#8b949e' };
}

// ---------------------------------------------------------------------------
// Skill Radar (large)
// ---------------------------------------------------------------------------

function renderRadarLarge(skills) {
  const KEYS = ['web', 'network', 'activeDirectory', 'linux', 'windows', 'crypto', 'forensics'];
  const LABELS = ['Web', 'Network', 'AD', 'Linux', 'Windows', 'Crypto', 'Forensics'];
  const MAX = 100, size = 320, center = size / 2, radius = size / 2 - 48;
  const step = (2 * Math.PI) / KEYS.length;

  function pt(i, val) {
    const a = step * i - Math.PI / 2;
    const r = (val / MAX) * radius;
    return [center + r * Math.cos(a), center + r * Math.sin(a)];
  }

  const rings = [0.25, 0.5, 0.75, 1].map(sc =>
    `<polygon points="${KEYS.map((_,i)=>{const [x,y]=pt(i,MAX*sc);return `${x},${y}`;}).join(' ')}" fill="none" stroke="rgba(42,51,71,0.45)" stroke-width="0.75"/>`
  ).join('');

  const axes = KEYS.map((_,i)=>{ const [x,y]=pt(i,MAX); return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="rgba(42,51,71,0.35)" stroke-width="0.5"/>`;}).join('');

  const polyPts = KEYS.map((k,i)=>{ const [x,y]=pt(i,skills[k]??0); return `${x},${y}`;}).join(' ');
  const dots = KEYS.map((k,i)=>{ const [x,y]=pt(i,skills[k]??0); return `<circle cx="${x}" cy="${y}" r="4" fill="#4a9eff" stroke="#0a0a0f" stroke-width="1.5"/>`;}).join('');

  const labelR = MAX + 28;
  const labels = KEYS.map((k,i)=>{
    const [x,y]=pt(i,labelR); const val=skills[k]??0;
    const a=((step*i-Math.PI/2)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
    let anchor='middle';
    if (a>Math.PI*0.15&&a<Math.PI*0.85) anchor='start';
    else if (a>Math.PI*1.15&&a<Math.PI*1.85) anchor='end';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" style="font-size:10px;font-family:JetBrains Mono,monospace;fill:#8b949e">${LABELS[i]} <tspan style="font-size:9px;fill:#6e7681">${val}</tspan></text>`;
  }).join('');

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="db-radar-large">
    <defs><filter id="dbrl-glow"><feGaussianBlur stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${rings}${axes}
    <polygon points="${polyPts}" fill="rgba(74,158,255,0.14)" stroke="#4a9eff" stroke-width="2" filter="url(#dbrl-glow)"/>
    ${dots}${labels}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Streak Calendar
// ---------------------------------------------------------------------------

function renderStreakCalendar(activityDates, currentStreak) {
  const today = new Date();
  const days = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    days.push(d.toISOString().slice(0, 10));
  }
  const dateSet = new Set(activityDates || []);
  const todayStr = today.toISOString().slice(0, 10);

  const cells = days.map(d => {
    const active = dateSet.has(d);
    const isToday = d === todayStr;
    return `<div class="db-cal-cell ${active ? 'db-cal-cell--active' : ''} ${isToday ? 'db-cal-cell--today' : ''}" title="${d}"></div>`;
  }).join('');

  return `
    <div class="db-streak-card">
      <div class="db-streak-header">
        <span class="db-section-label">Activity Streak</span>
        <span class="db-mono" style="color:#d29922;font-size:11px">${currentStreak ?? 0}d streak</span>
      </div>
      <div class="db-cal-grid">${cells}</div>
      <div class="db-cal-legend">
        <span class="db-mono" style="font-size:9px;color:rgba(197,201,208,0.4)">Last 90 days</span>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

let _unsub = null;

function _render(container) {
  const summary = State.get('summary') || {};
  const profile = summary.operator_profile;
  const loading = State.get('loading');

  if (loading) {
    container.innerHTML = '<div class="db-loading"><span class="db-spinner"></span><span>Loading profile…</span></div>';
    return;
  }

  if (!profile) {
    container.innerHTML = `
      <div class="db-profile-empty">
        <p class="db-section-label" style="text-align:center;padding:48px">No operator profile found.</p>
        <p style="text-align:center;font-size:11px;color:rgba(197,201,208,0.5)">CyberLab writes the profile to<br>data/cyberapps/cyberlab/&lt;user&gt;/operator_profile.json</p>
      </div>`;
    return;
  }

  const rank = getRank(profile.totalFlags ?? 0);
  const skills = profile.skillProgress ?? {};
  const initial = (profile.operatorName ?? 'OP').slice(0, 2).toUpperCase();

  const statsRow = [
    { label: 'Labs Completed', value: profile.totalLabsCompleted ?? 0, color: 'var(--accent, #4a9eff)' },
    { label: 'Flags Captured', value: profile.totalFlags ?? 0, color: '#3fb950' },
    { label: 'Credentials', value: profile.totalCredentials ?? 0, color: '#f78166' },
    { label: 'Current Streak', value: `${profile.currentStreak ?? 0}d`, color: '#d29922' },
  ].map(({ label, value, color }) => `
    <div class="db-stat-cell">
      <div class="db-stat-val" style="color:${color}">${esc(String(value))}</div>
      <div class="db-stat-label">${esc(label)}</div>
    </div>`).join('');

  container.innerHTML = `
    <div class="db-profile-view">
      <div class="db-profile-header">
        <div class="db-avatar-ring" style="background:conic-gradient(${rank.color},rgba(74,158,255,0.5),${rank.color})">
          <div class="db-avatar-inner" style="color:${rank.color}">${esc(initial)}</div>
        </div>
        <div class="db-profile-identity">
          <div class="db-profile-name-row">
            <span class="db-profile-name">${esc(profile.operatorName ?? 'Operator')}</span>
            <span class="db-rank-badge" style="color:${rank.color};background:${rank.color}18;border-color:${rank.color}35">${rank.label}</span>
          </div>
          <div class="db-operator-status">
            <span class="db-dot db-dot--online db-dot--pulse"></span>
            <span>Active Operator</span>
            ${profile.currentStreak ? `<span class="db-mono" style="font-size:10px;color:rgba(197,201,208,0.5)">· <span style="color:#d29922">${profile.currentStreak}d streak</span></span>` : ''}
          </div>
        </div>
        <div class="db-profile-quick-stats">
          <div class="db-qstat" style="color:var(--accent,#4a9eff)">${profile.totalLabsCompleted ?? 0}<div class="db-qstat-label">Labs</div></div>
          <div class="db-qstat" style="color:#3fb950">${profile.totalFlags ?? 0}<div class="db-qstat-label">Flags</div></div>
          <div class="db-qstat" style="color:#f78166">${profile.totalCredentials ?? 0}<div class="db-qstat-label">Creds</div></div>
        </div>
      </div>

      <div class="db-stats-row">${statsRow}</div>

      ${renderStreakCalendar(profile.activityDates, profile.currentStreak)}

      <div class="db-profile-bottom-grid">
        <div class="db-radar-card">
          <p class="db-section-label" style="margin-bottom:8px">Skill Radar</p>
          ${renderRadarLarge(skills)}
        </div>
        <div class="db-lab-history-card">
          <p class="db-section-label" style="margin-bottom:8px">Operator Stats</p>
          <table class="db-lab-table">
            <thead><tr><th>Skill</th><th>Progress</th><th>Level</th></tr></thead>
            <tbody>
              ${Object.entries(skills).map(([k, v]) => {
                const pct = Math.min(100, v);
                const color = pct >= 75 ? '#3fb950' : pct >= 40 ? '#d29922' : '#f85149';
                return `<tr>
                  <td class="db-mono" style="font-size:11px;color:rgba(197,201,208,0.8)">${esc(k)}</td>
                  <td style="min-width:80px">
                    <div class="db-skill-bar">
                      <div class="db-skill-fill" style="width:${pct}%;background:${color}"></div>
                    </div>
                  </td>
                  <td class="db-mono" style="font-size:11px;color:${color}">${v}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

export function init(container) {
  container.style.overflow = 'auto';
  container.style.padding = '24px';
  _render(container);
  _unsub = State.subscribe('summary', () => _render(container));
}

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
}
