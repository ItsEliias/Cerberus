/** CERBERUS — density.js — Phase D stat strips for Email/Notes/Calendar/Brain/Search + Tasks ops-view. */

const API = window.location.origin;

// ── Utility ──────────────────────────────────────────────────────────

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function _chip(value, label, status) {
  const chip = _el('span', 'jx2-stat-chip');
  if (status) chip.dataset.status = status;
  chip.innerHTML = `<span style="font-weight:700;">${value}</span>&nbsp;${label}`;
  return chip;
}

async function _fetch(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Insert el before the first child of parent, or append if empty. */
function _prepend(parent, el) {
  if (parent.firstChild) parent.insertBefore(el, parent.firstChild);
  else parent.appendChild(el);
}

// ── Email stat strip ─────────────────────────────────────────────────

export async function injectEmailStrip(container) {
  if (!container) return;
  if (container.querySelector('#jx2-email-stat-strip')) return;

  const strip = _el('div', '');
  strip.id = 'jx2-email-stat-strip';

  const lbl = _el('span', 'jx2-email-stat-strip__label jx2-hud-label', 'INBOX');
  strip.appendChild(lbl);

  // Placeholder chips
  const unread  = _chip('—', 'UNREAD',  'processing');
  const flagged = _chip('—', 'FLAGGED', 'idle');
  const today   = _chip('—', 'TODAY',   'active');
  strip.append(unread, flagged, today);
  _prepend(container, strip);

  // Fetch data
  try {
    const [allData, unreadData] = await Promise.allSettled([
      _fetch(`${API}/api/email/list?limit=50&filter=all`),
      _fetch(`${API}/api/email/list?limit=50&filter=unread`),
    ]);

    const allEmails    = (allData.status === 'fulfilled'   ? allData.value.emails   : null) || [];
    const unreadEmails = (unreadData.status === 'fulfilled' ? unreadData.value.emails : null) || [];
    const todayStr     = new Date().toDateString();

    let flaggedCount = 0;
    let todayCount   = 0;

    allEmails.forEach(em => {
      if (em.flagged || (em.flags || []).includes('\\Flagged')) flaggedCount++;
      const d = em.date ? new Date(em.date).toDateString() : '';
      if (d === todayStr) todayCount++;
    });

    unread.innerHTML  = `<span style="font-weight:700;">${unreadEmails.length}</span>&nbsp;UNREAD`;
    flagged.innerHTML = `<span style="font-weight:700;">${flaggedCount}</span>&nbsp;FLAGGED`;
    today.innerHTML   = `<span style="font-weight:700;">${todayCount}</span>&nbsp;TODAY`;
  } catch (_) {
    // Silently keep "—"
  }
}

// ── Notes stat strip ─────────────────────────────────────────────────

export async function injectNotesStrip(container) {
  if (!container) return;
  if (container.querySelector('#jx2-notes-stat-strip')) return;

  const strip = _el('div', '');
  strip.id = 'jx2-notes-stat-strip';

  // placeholder chips
  const total    = _chip('—', 'NOTES',    '');
  const pinned   = _chip('—', 'PINNED',   'active');
  const tagged   = _chip('—', 'TAGGED',   'idle');
  strip.append(total, pinned, tagged);

  // sparkline wrapper (14-day notes/day)
  const sparkWrap = _el('div', '');
  sparkWrap.id = 'jx2-notes-sparkline-wrap';
  const sparkLbl = _el('span', 'jx2-hud-label', '14D');
  const sparkSvg = _buildSparkline([], 80, 22);
  sparkSvg.id = 'jx2-notes-sparkline';
  sparkWrap.append(sparkLbl, sparkSvg);
  strip.appendChild(sparkWrap);

  _prepend(container, strip);

  try {
    const data = await _fetch(`${API}/api/notes`);
    const notes = data.notes || data || [];
    const pinCount    = notes.filter(n => n.pinned).length;
    const labelCounts = {};
    notes.forEach(n => {
      const lbl = n.label || n.color || null;
      if (lbl) labelCounts[lbl] = (labelCounts[lbl] || 0) + 1;
    });
    const labelCount = Object.keys(labelCounts).length;

    total.innerHTML  = `<span style="font-weight:700;">${notes.length}</span>&nbsp;NOTES`;
    pinned.innerHTML = `<span style="font-weight:700;">${pinCount}</span>&nbsp;PINNED`;
    tagged.innerHTML = `<span style="font-weight:700;">${labelCount}</span>&nbsp;LABELS`;

    // Build 14-day sparkline of note creation
    const days   = 14;
    const counts = Array(days).fill(0);
    const now    = Date.now();
    notes.forEach(n => {
      const created = n.created_at ? new Date(n.created_at).getTime() : 0;
      if (!created) return;
      const daysAgo = Math.floor((now - created) / 86400000);
      if (daysAgo >= 0 && daysAgo < days) counts[days - 1 - daysAgo]++;
    });
    const sparkElOld = document.getElementById('jx2-notes-sparkline');
    if (sparkElOld) sparkElOld.replaceWith(_buildSparkline(counts, 80, 22, 'jx2-notes-sparkline'));
  } catch (_) {}
}

// ── Calendar stat strip ──────────────────────────────────────────────

export async function injectCalendarStrip(container) {
  if (!container) return;
  if (container.querySelector('#jx2-cal-stat-strip')) return;

  const strip = _el('div', '');
  strip.id = 'jx2-cal-stat-strip';

  const todayC    = _chip('—', 'TODAY',    'active');
  const weekC     = _chip('—', 'THIS WEEK','processing');
  const upcomingC = _chip('—', 'UPCOMING', 'idle');
  strip.append(todayC, weekC, upcomingC);
  _prepend(container, strip);

  try {
    const now    = new Date();
    const start  = now.toISOString().slice(0, 10);
    const end    = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);
    const data   = await _fetch(`${API}/api/calendar/events?start=${start}&end=${end}`);
    const events = data.events || data || [];
    const todayStr = now.toDateString();
    const weekEnd  = new Date(now.getTime() + 7 * 86400000);

    let todayN    = 0;
    let weekN     = 0;
    let upcomingN = 0;

    events.forEach(ev => {
      const start = new Date(ev.start || ev.start_time || ev.date || 0);
      if (start < now) return;  // past
      upcomingN++;
      if (start.toDateString() === todayStr) todayN++;
      if (start <= weekEnd) weekN++;
    });

    todayC.innerHTML    = `<span style="font-weight:700;">${todayN}</span>&nbsp;TODAY`;
    weekC.innerHTML     = `<span style="font-weight:700;">${weekN}</span>&nbsp;THIS WEEK`;
    upcomingC.innerHTML = `<span style="font-weight:700;">${upcomingN}</span>&nbsp;UPCOMING`;
  } catch (_) {}
}

// ── Brain stat strip ─────────────────────────────────────────────────

export async function injectBrainStrip(container) {
  if (!container) return;
  if (container.querySelector('#jx2-brain-stat-strip')) return;

  const strip = _el('div', '');
  strip.id = 'jx2-brain-stat-strip';

  const entriesC  = _chip('—', 'ENTRIES',    'processing');
  const lastWriteC = _chip('—', 'LAST WRITE', 'active');
  strip.append(entriesC, lastWriteC);
  _prepend(container, strip);

  try {
    const data = await _fetch(`${API}/api/memory`);
    const memories = data.memory || data.memories || [];

    // Last-write time
    let lastWrite = '—';
    if (memories.length) {
      const times = memories
        .map(m => {
          const raw = m.timestamp || m.created_at || m.updated_at;
          if (!raw) return null;
          // timestamp can be Unix epoch (number) or ISO string
          const n = typeof raw === 'number' ? raw * 1000 : new Date(raw).getTime();
          return isNaN(n) ? null : n;
        })
        .filter(Boolean);
      if (times.length) {
        const latest = new Date(Math.max(...times));
        const hh = String(latest.getHours()).padStart(2, '0');
        const mm = String(latest.getMinutes()).padStart(2, '0');
        lastWrite = `${hh}:${mm}`;
      }
    }

    entriesC.innerHTML  = `<span style="font-weight:700;">${memories.length}</span>&nbsp;ENTRIES`;
    lastWriteC.innerHTML = `<span style="font-weight:700;">${lastWrite}</span>&nbsp;LAST WRITE`;
  } catch (_) {}
}

// ── Search histogram ─────────────────────────────────────────────────

/**
 * Inject a type-distribution histogram when search results are present.
 * @param {Element} container — search results container
 * @param {Object}  typeCounts — { Chat: 5, Note: 2, ... }
 */
export function injectSearchHistogram(container, typeCounts) {
  if (!container) return;
  const existing = container.querySelector('#jx2-search-histogram');
  if (existing) existing.remove();
  if (!typeCounts || !Object.keys(typeCounts).length) return;

  const strip = _el('div', '');
  strip.id = 'jx2-search-histogram';

  const maxVal = Math.max(...Object.values(typeCounts), 1);
  const maxBarH = 32;

  Object.entries(typeCounts).forEach(([type, count]) => {
    const barH = Math.max(2, Math.round((count / maxVal) * maxBarH));
    const wrap = _el('div', 'jx2-histo-bar-wrap');
    const bar  = _el('div', 'jx2-histo-bar');
    bar.style.height = `${barH}px`;
    bar.title = `${type}: ${count}`;
    const lbl = _el('div', 'jx2-histo-label', type.slice(0, 4));
    wrap.append(bar, lbl);
    strip.appendChild(wrap);
  });

  _prepend(container, strip);
}

// ── Tasks ops-view strip ─────────────────────────────────────────────

/**
 * Inject the Tasks ops-view strip + filter strip into the tasks modal body.
 * @param {Element} listContainer — the element that wraps the task cards
 * @param {Array}   tasks         — raw task objects from _tasks
 */
export function injectTasksOpsStrip(listContainer, tasks) {
  if (!listContainer) return;
  const parent = listContainer.parentElement;
  if (!parent) return;

  // Remove existing ops strip to rebuild fresh
  parent.querySelector('#jx2-tasks-ops-strip')?.remove();
  parent.querySelector('#jx2-tasks-filter-strip')?.remove();

  // ── Stats strip ───────────────────────────────────────────────────
  const strip = _el('div', '');
  strip.id = 'jx2-tasks-ops-strip';

  const today = new Date().toDateString();

  const openN     = tasks.filter(t => t.status === 'active').length;
  const inProcN   = tasks.filter(t => t.status === 'active' && t.last_run_status === 'running').length;
  const blockedN  = tasks.filter(t => t.status === 'paused').length;
  const doneTodN  = tasks.filter(t => {
    if (!t.last_run) return false;
    return new Date(t.last_run).toDateString() === today && t.last_run_status === 'success';
  }).length;

  const countersRow = _el('div', 'jx2-tasks-stats__counters');

  [
    { val: openN,    label: 'OPEN',        status: 'active'     },
    { val: inProcN,  label: 'IN PROGRESS', status: 'processing' },
    { val: blockedN, label: 'BLOCKED',     status: 'alert'      },
    { val: doneTodN, label: 'DONE TODAY',  status: 'idle'       },
  ].forEach(s => {
    const stat = _el('div', 'jx2-tasks-stat');
    stat.dataset.status = s.status;
    const val = _el('div', 'jx2-tasks-stat__val', '0');
    const lbl = _el('div', 'jx2-tasks-stat__label', s.label);
    stat.append(val, lbl);
    countersRow.appendChild(stat);
    if (typeof JX2 !== 'undefined') JX2.countUp(val, s.val, '', 600);
    else val.textContent = String(s.val);
  });

  // Donut + sparkline row
  const vizRow = _el('div', '');
  vizRow.style.cssText = 'display:flex;align-items:center;gap:16px;';

  // Donut (88px)
  const donutWrap = _buildTaskDonut(tasks);
  vizRow.appendChild(donutWrap);

  // Burn-down sparkline — last 7 days completions
  const sparkWrap = _el('div', '');
  sparkWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
  const sparkLbl = _el('span', 'jx2-hud-label', '7-DAY COMPLETIONS');
  const sparkData = _build7DayData(tasks);
  const sparkSvg  = _buildSparkline(sparkData, 120, 28);
  sparkSvg.classList.add('jx2-burndown');
  sparkWrap.append(sparkLbl, sparkSvg);
  vizRow.appendChild(sparkWrap);

  strip.append(countersRow, vizRow);
  parent.insertBefore(strip, listContainer);

  // ── Filter strip ─────────────────────────────────────────────────
  const filterStrip = _el('div', '');
  filterStrip.id = 'jx2-tasks-filter-strip';

  [
    { label: 'ALL',         filter: null          },
    { label: 'ACTIVE',      filter: 'active'      },
    { label: 'PAUSED',      filter: 'paused'      },
    { label: 'DONE TODAY',  filter: 'done-today'  },
  ].forEach(f => {
    const pill = _el('button', 'jx2-filter-pill');
    pill.textContent = f.label;
    pill.setAttribute('aria-pressed', 'false');
    pill.dataset.filter = f.filter || 'all';
    pill.addEventListener('click', () => {
      filterStrip.querySelectorAll('.jx2-filter-pill').forEach(p => {
        p.setAttribute('aria-pressed', 'false');
        p.classList.remove('active');
      });
      pill.setAttribute('aria-pressed', 'true');
      pill.classList.add('active');
      _applyTaskFilter(listContainer, tasks, f.filter);
    });
    filterStrip.appendChild(pill);
  });

  // Set ALL as default active
  const allPill = filterStrip.querySelector('[data-filter="all"]');
  if (allPill) { allPill.setAttribute('aria-pressed', 'true'); allPill.classList.add('active'); }

  parent.insertBefore(filterStrip, listContainer);
}

/** Filter task rows by status */
function _applyTaskFilter(listContainer, tasks, filter) {
  const today = new Date().toDateString();
  Array.from(listContainer.querySelectorAll('.task-card')).forEach(card => {
    const taskId = card.dataset.id;
    const task   = tasks.find(t => String(t.id) === String(taskId));
    if (!task) return;

    let show = true;
    if (filter === 'active')     show = task.status === 'active';
    else if (filter === 'paused') show = task.status === 'paused';
    else if (filter === 'done-today') {
      show = task.last_run
        && new Date(task.last_run).toDateString() === today
        && task.last_run_status === 'success';
    }
    card.style.display = show ? '' : 'none';
  });
}

// ── SVG helpers ──────────────────────────────────────────────────────

function _buildTaskDonut(tasks) {
  const active   = tasks.filter(t => t.status === 'active').length;
  const paused   = tasks.filter(t => t.status === 'paused').length;
  const other    = Math.max(0, tasks.length - active - paused);
  const total    = tasks.length || 1;
  const SIZE     = 88;
  const R        = 36;
  const CX       = SIZE / 2;
  const CY       = SIZE / 2;
  const CIRC     = 2 * Math.PI * R;

  const wrap = _el('div', 'jx2-donut');
  wrap.style.width  = `${SIZE}px`;
  wrap.style.height = `${SIZE}px`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width',   SIZE);
  svg.setAttribute('height',  SIZE);
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Tasks: ${total} total`);

  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('cx', CX); track.setAttribute('cy', CY); track.setAttribute('r', R);
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'rgba(192,57,43,0.10)');
  track.setAttribute('stroke-width', '6');
  svg.appendChild(track);

  const segments = [
    { value: active, color: 'var(--jx2-status-active)', label: `Active: ${active}` },
    { value: paused, color: 'var(--jx2-status-idle)',   label: `Paused: ${paused}` },
    { value: other,  color: 'var(--jx2-fg-muted)',       label: `Other: ${other}` },
  ];

  let offset = 0;
  segments.forEach(seg => {
    if (!seg.value) return;
    const pct  = seg.value / total;
    const dash = pct * CIRC;
    const arc  = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    arc.setAttribute('cx', CX); arc.setAttribute('cy', CY); arc.setAttribute('r', R);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', seg.color);
    arc.setAttribute('stroke-width', '6');
    arc.setAttribute('stroke-linecap', 'round');
    arc.setAttribute('stroke-dasharray', `${dash} ${CIRC - dash}`);
    arc.setAttribute('stroke-dashoffset', -offset);
    arc.style.transformOrigin = `${CX}px ${CY}px`;
    arc.style.transform = 'rotate(-90deg)';
    arc.title = seg.label;
    svg.appendChild(arc);
    offset += dash;
  });

  wrap.appendChild(svg);

  const center = _el('div', 'jx2-donut__center');
  const tot    = _el('span', 'jx2-donut__total', String(tasks.length));
  const sub    = _el('span', 'jx2-donut__sub', 'tasks');
  center.append(tot, sub);
  wrap.appendChild(center);

  return wrap;
}

function _build7DayData(tasks) {
  const days    = 7;
  const counts  = Array(days).fill(0);
  const now     = Date.now();
  const today   = new Date().toDateString();
  tasks.forEach(t => {
    if (!t.last_run || t.last_run_status !== 'success') return;
    const daysAgo = Math.floor((now - new Date(t.last_run).getTime()) / 86400000);
    if (daysAgo >= 0 && daysAgo < days) counts[days - 1 - daysAgo]++;
  });
  return counts;
}

function _buildSparkline(data, w, h, id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (id) svg.id = id;
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('jx2-sparkline');

  if (!data.length) return svg;

  const max  = Math.max(...data, 1);
  const pad  = 2;
  const step = (w - pad * 2) / Math.max(data.length - 1, 1);

  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v / max) * (h - pad * 2));
    return `${x},${y}`;
  });

  // Area fill
  const fillPts = [
    `${pad},${h}`,
    ...points,
    `${pad + (data.length - 1) * step},${h}`,
  ].join(' ');
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  area.setAttribute('points', fillPts);
  area.classList.add('jx2-burndown__fill');
  svg.appendChild(area);

  // Line
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points.join(' '));
  svg.appendChild(line);

  return svg;
}
