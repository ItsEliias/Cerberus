/**
 * static/js/cyberapps/netlab/views-progress.js
 * ProgressView — stats, skill radar, history. Ported from CyberOS NetLab.
 */

import * as State from './state.js';

const CATEGORIES = ['CCNA','CCNP','Linux','FortiGate','EVE-NG','GNS3'];
const SKILL_TOPICS = ['OSPF','EIGRP','VLANs','ACL','NAT','BGP'];
const SKILL_TAGS = {
  OSPF:  ['ospf'],
  EIGRP: ['eigrp'],
  VLANs: ['vlan','switching','trunk','vtp'],
  ACL:   ['acl','access-list'],
  NAT:   ['nat','pat'],
  BGP:   ['bgp'],
};

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function fmtMs(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m === 0 ? `${s}s` : `${m}m ${s % 60}s`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function calcStreak(progress) {
  const days = new Set();
  for (const p of Object.values(progress)) {
    if (!p.completedAt) continue;
    const d = new Date(p.completedAt);
    if (!Number.isFinite(d.getTime())) continue;
    days.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }
  if (!days.size) return 0;
  let count = 0;
  const cursor = new Date();
  for (let i = 0; i < 365; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
    if (days.has(key)) { count++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  return count;
}

function buildRadarSvg(skills) {
  const size = 160;
  const center = size / 2;
  const maxR = 60;
  const n = SKILL_TOPICS.length;

  function toXY(i, r) {
    const angle = (i * 2 * Math.PI / n) - Math.PI / 2;
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)];
  }

  const rings = [0.25, 0.5, 0.75, 1].map(frac => {
    const pts = SKILL_TOPICS.map((_, i) => toXY(i, maxR * frac).join(',')).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="#2a3347" stroke-width="1"/>`;
  }).join('');

  const axes = SKILL_TOPICS.map((_, i) => {
    const [x, y] = toXY(i, maxR);
    return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="#2a3347" stroke-width="1"/>`;
  }).join('');

  const skillPts = SKILL_TOPICS.map((t, i) => toXY(i, maxR * (skills[t] ?? 0)).join(',')).join(' ');
  const fill = `<polygon points="${skillPts}" fill="rgba(94,196,255,0.15)" stroke="#5ec4ff" stroke-width="1.5"/>`;

  const labels = SKILL_TOPICS.map((t, i) => {
    const [x, y] = toXY(i, maxR + 14);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
      fill="#8b949e" font-size="9" font-family="JetBrains Mono,monospace">${t}</text>`;
  }).join('');

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${rings}${axes}${fill}${labels}
  </svg>`;
}

export function renderProgressView(container) {
  function render() {
    const labs = State.get('labs');
    const progress = State.get('progress');

    const catStats = CATEGORIES.map(cat => {
      const catLabs = labs.filter(l => l.category === cat);
      const done = catLabs.filter(l => progress[l.id]?.completedAt).length;
      return { category: cat, completed: done, total: catLabs.length };
    }).filter(c => c.total > 0);

    const skills = {};
    for (const topic of SKILL_TOPICS) {
      const tags = SKILL_TAGS[topic];
      const tagged = labs.filter(l => l.tags.some(t => tags.includes(t)));
      const done = tagged.filter(l => progress[l.id]?.completedAt).length;
      skills[topic] = tagged.length === 0 ? 0 : done / tagged.length;
    }

    const history = Object.values(progress)
      .filter(p => p.completedAt)
      .map(p => ({ lab: labs.find(l => l.id === p.labId), progress: p }))
      .filter(h => h.lab)
      .sort((a, b) => new Date(b.progress.completedAt).getTime() - new Date(a.progress.completedAt).getTime());

    const totalLabs = labs.length;
    const doneLabs = Object.values(progress).filter(p => p.completedAt).length;
    const streakDays = calcStreak(progress);

    container.innerHTML = `
      <div class="nl-prog-wrap">
        <!-- Summary cards -->
        <div class="nl-stat-grid">
          <div class="nl-stat-card">
            <p class="nl-label">Labs Completed</p>
            <p class="nl-stat-val" style="color:#5ec4ff;">${esc(doneLabs)}/${esc(totalLabs)}</p>
          </div>
          <div class="nl-stat-card">
            <p class="nl-label">Completion Rate</p>
            <p class="nl-stat-val" style="color:#3fb950;">${totalLabs ? Math.round((doneLabs/totalLabs)*100) : 0}%</p>
          </div>
          <div class="nl-stat-card">
            <p class="nl-label">Current Streak</p>
            <p class="nl-stat-val" style="color:#d29922;">${esc(streakDays)} days</p>
          </div>
        </div>

        <div class="nl-prog-cols">
          <!-- Category progress -->
          <div class="nl-prog-section">
            <p class="nl-label" style="margin-bottom:12px;">Category Progress</p>
            ${catStats.length === 0 ? '<p class="nl-muted">No labs loaded yet.</p>' :
              catStats.map(c => {
                const pct = c.total === 0 ? 0 : Math.round((c.completed / c.total) * 100);
                return `
                  <div style="margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                      <span style="color:var(--fg,#c5c9d0);">${esc(c.category)}</span>
                      <span class="nl-muted">${esc(c.completed)}/${esc(c.total)}</span>
                    </div>
                    <div class="nl-progress-track">
                      <div class="nl-progress-fill" style="width:${pct}%;background:${pct===100?'#3fb950':'#5ec4ff'};"></div>
                    </div>
                  </div>
                `;
              }).join('')}
          </div>

          <!-- Skill radar -->
          <div class="nl-prog-section">
            <p class="nl-label" style="margin-bottom:12px;">Skill Radar</p>
            <div style="display:flex;justify-content:center;">
              ${buildRadarSvg(skills)}
            </div>
          </div>
        </div>

        <!-- Lab history -->
        <div class="nl-prog-section" style="margin-top:24px;">
          <p class="nl-label" style="margin-bottom:12px;">Completed Labs</p>
          ${history.length === 0 ? '<p class="nl-muted">No labs completed yet. Start a lab to track progress!</p>' : `
            <div class="nl-table-wrap">
              <table class="nl-table">
                <thead>
                  <tr>
                    <th>Lab</th>
                    <th>Category</th>
                    <th>Completed</th>
                    <th>Best Time</th>
                  </tr>
                </thead>
                <tbody>
                  ${history.map(({ lab, progress: p }) => `
                    <tr>
                      <td style="color:var(--fg,#c5c9d0);font-weight:500;">${esc(lab.title)}</td>
                      <td><span class="nl-badge-cat">${esc(lab.category)}</span></td>
                      <td class="nl-muted-text">${esc(fmtDate(p.completedAt))}</td>
                      <td style="font-family:monospace;color:#8b949e;">${esc(fmtMs(p.bestTimeMs))}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`}
        </div>
      </div>
    `;
  }

  const unsubs = [
    State.subscribe('labs', () => render()),
    State.subscribe('progress', () => render()),
  ];

  render();

  return { destroy: () => unsubs.forEach(u => u()) };
}
