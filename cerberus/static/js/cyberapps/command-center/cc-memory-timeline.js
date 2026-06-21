/**
 * cc-memory-timeline.js — MEMORY TIMELINE panel for the CC ASSISTANT tab.
 *
 * Surfaces all of the owner's memories grouped by week (most recent first),
 * filterable by category, with click-to-expand and per-entry delete.
 *
 * Endpoint shapes verified against routes/memory_routes.py:
 *   - GET    /api/memory          → { memory: [{id, text, category,
 *                                              categories?, timestamp,
 *                                              owner, source, ...}] }
 *   - DELETE /api/memory/{id}     → { ok: true }
 *
 * styles.css is stable for this branch, but the panel injects its own
 * stylesheet once via a single <style id="cc-mem-timeline-styles"> so the
 * markup stays self-contained.
 */

const STYLE_ID = 'cc-mem-timeline-styles';
const TRUNCATE_LEN = 80;

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.cc-mem-timeline {
  margin: 8px 12px 0; padding: 10px 12px 12px;
  background: color-mix(in srgb, var(--cc-void-mid, var(--bg, #1a1d23)) 92%, transparent);
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  border-radius: 3px;
  display: flex; flex-direction: column; gap: 8px;
}
.cc-mem-timeline .cc-section-label {
  font-family: 'Orbitron', 'JetBrains Mono', monospace;
  font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--cc-crimson, var(--red, #c0392b));
}
.cc-mem-cat-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.cc-mem-cat-chip {
  background: transparent;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 70%, transparent);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 9px; letter-spacing: 0.06em;
  padding: 3px 8px;
  border-radius: 2px; cursor: pointer;
  -webkit-appearance: none; appearance: none;
  transition: border-color 0.15s, color 0.15s;
}
.cc-mem-cat-chip:hover {
  border-color: color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 55%, transparent);
}
.cc-mem-cat-chip.active {
  border-color: var(--cc-crimson, var(--red, #c0392b));
  color: var(--cc-crimson, var(--red, #c0392b));
}
.cc-mem-week-group {
  display: flex; flex-direction: column; gap: 4px;
}
.cc-mem-week-label {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 55%, transparent);
  padding: 4px 0;
  border-bottom: 1px solid var(--cc-border, var(--border, #3a2a2a));
}
.cc-mem-entry {
  display: grid; grid-template-columns: auto 1fr auto auto; gap: 8px;
  align-items: baseline;
  padding: 6px 4px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--cc-border, var(--border, #3a2a2a)) 35%, transparent);
}
.cc-mem-entry:hover {
  background: color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 5%, transparent);
}
.cc-mem-entry.expanded {
  grid-template-columns: 1fr;
  background: color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 6%, transparent);
}
.cc-mem-entry.expanded .cc-mem-entry-text { white-space: pre-wrap; }
.cc-mem-entry-cat {
  font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase;
  color: color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 70%, transparent);
  padding: 1px 5px;
  border: 1px solid color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 35%, transparent);
  border-radius: 2px;
}
.cc-mem-entry-text {
  font-size: 11px; letter-spacing: 0.02em;
  color: var(--cc-fg, var(--fg, #c5c9d0));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cc-mem-entry-age {
  font-size: 9px;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 40%, transparent);
}
.cc-mem-entry-del {
  background: transparent; border: none;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 35%, transparent);
  font-size: 12px; line-height: 1;
  cursor: pointer; padding: 0 4px;
  -webkit-appearance: none; appearance: none;
}
.cc-mem-entry-del:hover { color: var(--cc-crit, #e74c3c); }
`.trim();
  document.head.appendChild(style);
}

// ── Pure helpers (exposed via __testables) ─────────────────────────────

function _normalizeTimestamp(raw) {
  // Memory entries may carry a numeric epoch (seconds or ms), an ISO
  // string, or nothing at all. Normalise to ms-since-epoch (or 0).
  if (raw == null) return 0;
  if (typeof raw === 'number') {
    return raw > 1e12 ? raw : raw * 1000; // seconds → ms
  }
  const n = Date.parse(String(raw));
  return Number.isFinite(n) ? n : 0;
}

function _startOfWeekUTC(ts) {
  // Monday-start ISO week, UTC.
  const d = new Date(ts);
  if (isNaN(d.getTime())) return 0;
  const dow = d.getUTCDay() || 7; // Sunday=0 → 7 so Monday=1 is start
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.getTime();
}

function _weekLabel(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '// UNDATED';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  return `WEEK OF ${day} ${mon}`;
}

function _relTime(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
}

function _truncate(s, n = TRUNCATE_LEN) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function _entryCategory(entry) {
  if (!entry) return 'general';
  if (entry.category) return String(entry.category);
  if (Array.isArray(entry.categories) && entry.categories.length) {
    return String(entry.categories[0]);
  }
  return 'general';
}

function _collectCategories(entries) {
  const set = new Set();
  for (const e of entries) set.add(_entryCategory(e));
  return [...set].sort();
}

/**
 * Group entries by ISO-week start (UTC), returns an ordered array of
 * { weekStart, label, entries[] }, most-recent week first.
 */
function _groupByWeek(entries) {
  const groups = new Map();
  for (const e of entries) {
    const ts    = _normalizeTimestamp(e?.timestamp);
    const week  = _startOfWeekUTC(ts);
    if (!groups.has(week)) groups.set(week, { weekStart: week, label: _weekLabel(week), entries: [] });
    groups.get(week).entries.push({ ...e, _ts: ts });
  }
  const ordered = [...groups.values()].sort((a, b) => b.weekStart - a.weekStart);
  for (const g of ordered) g.entries.sort((a, b) => b._ts - a._ts);
  return ordered;
}

function _filterByCategory(entries, cat) {
  if (!cat || cat === 'all') return entries;
  return entries.filter(e => _entryCategory(e) === cat);
}

// ── Build / load ───────────────────────────────────────────────────────

export function buildMemoryTimelinePanel() {
  _injectStyles();
  return `
<section class="cc-mem-timeline" aria-label="Memory timeline">
  <div class="cc-section-label">// MEMORY TIMELINE</div>
  <div class="cc-mem-cat-chips" id="cc-mem-cat-chips"></div>
  <div class="cc-mem-timeline-body" id="cc-mem-timeline-body">
    <div class="cc-empty">Loading memories…</div>
  </div>
</section>`.trim();
}

export async function loadMemoryTimeline(container) {
  _injectStyles();
  const root  = container.querySelector('.cc-mem-timeline') || container;
  const chips = root.querySelector('#cc-mem-cat-chips');
  const body  = root.querySelector('#cc-mem-timeline-body');

  let entries  = [];
  let category = 'all';

  function _renderChips() {
    const cats = ['all', ..._collectCategories(entries)];
    chips.innerHTML = cats.map(c =>
      `<button class="cc-mem-cat-chip${c === category ? ' active' : ''}"
              type="button" data-cat="${_esc(c)}">${_esc(c.toUpperCase())}</button>`
    ).join('');
    chips.querySelectorAll('.cc-mem-cat-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        category = btn.dataset.cat || 'all';
        _renderChips();
        _renderBody();
      });
    });
  }

  function _renderBody() {
    const filtered = _filterByCategory(entries, category);
    if (!filtered.length) {
      body.innerHTML = '<div class="cc-empty">// NO MEMORIES YET — chat with the assistant to start building your timeline.</div>';
      return;
    }
    const grouped = _groupByWeek(filtered);
    body.innerHTML = grouped.map(g => `
<div class="cc-mem-week-group">
  <div class="cc-mem-week-label">// ${_esc(g.label)}</div>
  ${g.entries.map(e => `
    <div class="cc-mem-entry" data-id="${_esc(e.id)}" data-full="${_esc(e.text || '')}">
      <span class="cc-mem-entry-cat">${_esc(_entryCategory(e))}</span>
      <span class="cc-mem-entry-text">${_esc(_truncate(e.text || ''))}</span>
      <span class="cc-mem-entry-age">${_esc(_relTime(e._ts))}</span>
      <button class="cc-mem-entry-del" type="button" aria-label="Delete memory">×</button>
    </div>`).join('')}
</div>`).join('');

    body.querySelectorAll('.cc-mem-entry').forEach(row => {
      const id = row.dataset.id;
      const full = row.dataset.full || '';
      row.addEventListener('click', (e) => {
        // Don't toggle when the delete button is clicked.
        if (e.target && e.target.closest && e.target.closest('.cc-mem-entry-del')) return;
        row.classList.toggle('expanded');
        const textEl = row.querySelector('.cc-mem-entry-text');
        if (textEl) {
          textEl.textContent = row.classList.contains('expanded') ? full : _truncate(full);
        }
      });
      const delBtn = row.querySelector('.cc-mem-entry-del');
      delBtn?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!id) return;
        delBtn.disabled = true;
        try {
          const r = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
            method: 'DELETE', credentials: 'same-origin',
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          entries = entries.filter(en => en.id !== id);
          _renderChips();
          _renderBody();
        } catch (_) {
          delBtn.disabled = false;
          delBtn.textContent = '!';
        }
      });
    });
  }

  try {
    const r = await fetch('/api/memory', { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data?.memory || data?.memories || []);
    entries = Array.isArray(arr) ? arr : [];
    _renderChips();
    _renderBody();
  } catch (e) {
    body.innerHTML = `<div class="cc-empty">Could not load memories — ${_esc(e.message)}</div>`;
  }
}

// ── Exposed for tests/test_wake_memory.test.mjs ──────────────────────

export const __testables = {
  STYLE_ID, TRUNCATE_LEN,
  _normalizeTimestamp, _startOfWeekUTC, _weekLabel, _relTime, _truncate,
  _entryCategory, _collectCategories, _groupByWeek, _filterByCategory,
};
