/**
 * static/js/cyberapps/signalboard/view-timeline.js
 * SignalBoard — Timeline: all items grouped by day, chronological.
 */

import * as State from './state.js';
import * as Api from './api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIER_COLOR = { critical:'#ff6b6b', high:'#f85149', medium:'#d29922', low:'#4a5568' };

function formatDay(iso) {
  const d = new Date(iso);
  const today = new Date(); const yest = new Date(today); yest.setDate(today.getDate()-1);
  if (d.toDateString()===today.toDateString()) return 'Today';
  if (d.toDateString()===yest.toDateString())  return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------------------------------------------------------------------------
// Group by day
// ---------------------------------------------------------------------------

function groupByDay(items) {
  const sorted = [...items].sort((a, b) => new Date(b.publishedAt)-new Date(a.publishedAt));
  const map = new Map();
  sorted.forEach(item => {
    const key = new Date(item.publishedAt).toDateString();
    const arr = map.get(key) || [];
    arr.push(item);
    map.set(key, arr);
  });
  return [...map.entries()].map(([key, its]) => ({
    key, label: formatDay(its[0].publishedAt), items: its,
  }));
}

// ---------------------------------------------------------------------------
// Timeline item
// ---------------------------------------------------------------------------

function renderTimelineItem(item, sourceColor) {
  const tier = item.alertMatches?.length ? '#ff6b6b' : (TIER_COLOR[item.relevanceTier]||'#4a5568');
  return `
    <div class="sb-tl-item" data-id="${escHtml(item.id)}" style="
      display:flex;align-items:flex-start;gap:10px;cursor:pointer;
      padding:6px 8px;border-radius:4px;transition:background 0.1s;">
      <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;margin-top:4px;">
        <div style="width:8px;height:8px;border-radius:50%;border:2px solid ${sourceColor};background:${item.read?'transparent':sourceColor};flex-shrink:0;"></div>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;flex-wrap:wrap;">
          <span style="font-size:10px;font-family:monospace;color:#4a5568;">${formatTime(item.publishedAt)}</span>
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:1px 5px;border-radius:3px;color:${tier};background:${tier}15;border:1px solid ${tier}30;">${item.relevanceTier.toUpperCase()}</span>
          ${(item.alertMatches||[]).map(m=>`<span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:1px 5px;border-radius:3px;color:${m.color};background:${m.color}15;border:1px solid ${m.color}30;">${escHtml(m.label)}</span>`).join('')}
          <span style="margin-left:auto;font-size:9px;color:#3a424f;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100px;">${escHtml(item.sourceName)}</span>
        </div>
        <p style="font-size:12px;line-height:1.4;margin:0;color:${item.read?'rgba(139,148,158,0.6)':'rgba(226,232,240,0.9)'};font-weight:${item.read?'400':'500'};">${escHtml(item.title)}</p>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderTimelineView(container) {
  function redraw() {
    const items   = State.get('items')   || [];
    const sources = State.get('sources') || [];

    const srcColorMap = new Map(sources.map(s=>[s.id, s.color||'#4a5568']));
    const groups = groupByDay(items);

    const daysHtml = groups.map(group => `
      <div style="margin-bottom:24px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#4a5568;">${escHtml(group.label)}</span>
          <div style="flex:1;height:1px;background:rgba(42,51,71,0.3);"></div>
          <span style="font-size:10px;color:#3a424f;font-family:monospace;">${group.items.length}</span>
        </div>
        <div style="border-left:1px solid rgba(42,51,71,0.3);padding-left:12px;margin-left:4px;">
          ${group.items.map(item => renderTimelineItem(item, srcColorMap.get(item.sourceId)||'#4a5568')).join('')}
        </div>
      </div>`).join('');

    container.innerHTML = `
      <div style="flex:1;overflow-y:auto;padding:24px;">
        <div style="max-width:640px;">
          <h2 style="font-size:13px;font-weight:600;color:#c5c9d0;margin:0 0 4px;">Timeline</h2>
          <p style="font-size:11px;color:#4a5568;margin:0 0 20px;">All items chronological. Grouped by day.</p>
          ${groups.length===0
            ? `<p style="font-size:12px;color:#4a5568;">No items yet — refresh to load feeds.</p>`
            : daysHtml}
        </div>
      </div>`;

    container.querySelectorAll('.sb-tl-item').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.background='rgba(42,51,71,0.2)'; });
      el.addEventListener('mouseleave', () => { el.style.background=''; });
      el.addEventListener('click', async () => {
        const id = el.dataset.id;
        State.setSelectedId(id);
        State.setActiveView('feed');
        const item = items.find(i=>i.id===id);
        if (item && !item.read) {
          State.patchItem(id, { read: true });
          await Api.patchItem(id, { read: true }).catch(() => {});
        }
      });
    });
  }

  const unsubs = [
    State.subscribe('items',   redraw),
    State.subscribe('sources', redraw),
  ];
  redraw();

  return { destroy() { unsubs.forEach(u=>u()); } };
}
