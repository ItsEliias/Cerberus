/**
 * static/js/cyberapps/signalboard/view-bookmarks.js
 * SignalBoard — Bookmarks: saved items with tags, filter, export.
 */

import * as State from './state.js';
import * as Api from './api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIER_COLOR = { critical:'#ff6b6b', high:'#f85149', medium:'#d29922', low:'#4a5568' };

function timeAgo(iso) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 3600000)  return `${Math.floor(d/60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d/3600000)}h ago`;
  return `${Math.floor(d/86400000)}d ago`;
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------------------------------------------------------------------------
// Bookmark card
// ---------------------------------------------------------------------------

function renderCard(item) {
  const tier = TIER_COLOR[item.relevanceTier] || '#4a5568';
  const tags = (State.get('bookmarkTags')||{})[item.id] || [];

  return `
    <div class="sb-bm-card" data-id="${escHtml(item.id)}" style="
      padding:12px;border:1px solid rgba(42,51,71,0.4);border-radius:6px;
      background:rgba(22,27,39,0.3);cursor:pointer;transition:background 0.15s;margin-bottom:8px;">
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:3px;color:${tier};background:${tier}18;border:1px solid ${tier}33;">${item.relevanceTier.toUpperCase()}</span>
            <span style="font-size:10px;color:#4a5568;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(item.sourceName)}</span>
            <span style="margin-left:auto;font-size:10px;color:#3a424f;flex-shrink:0;">${timeAgo(item.publishedAt)}</span>
          </div>
          <p style="font-size:12px;font-weight:600;color:rgba(226,232,240,0.9);margin:0 0 4px;line-height:1.4;">${escHtml(item.title)}</p>
          ${item.summary?`<p style="font-size:11px;color:#4a5568;margin:0 0 6px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escHtml(item.summary)}</p>`:''}
          <div class="sb-bm-tags" data-id="${escHtml(item.id)}" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px;">
            ${tags.map(t=>`
              <span style="display:flex;align-items:center;gap:3px;font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(255,107,107,0.1);color:#ff6b6b;border:1px solid rgba(255,107,107,0.25);">
                ${escHtml(t)}
                <button class="sb-rm-tag" data-item="${escHtml(item.id)}" data-tag="${escHtml(t)}" style="background:none;border:none;cursor:pointer;color:inherit;opacity:0.6;padding:0;line-height:1;">×</button>
              </span>`).join('')}
            <input class="sb-tag-input" data-id="${escHtml(item.id)}" placeholder="+ tag" style="font-size:10px;background:transparent;border:none;outline:none;color:rgba(139,148,158,0.6);width:48px;cursor:text;" />
          </div>
        </div>
        <button class="sb-rm-bm" data-id="${escHtml(item.id)}" style="background:none;border:none;cursor:pointer;color:#d29922;opacity:0.6;font-size:14px;flex-shrink:0;padding:0;" title="Remove bookmark">★</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderBookmarksView(container) {
  let tagFilter = null;

  function getBookmarkedItems() {
    const items      = State.get('items') || [];
    const bookmarks  = State.get('bookmarks') || [];
    const bmTags     = State.get('bookmarkTags') || {};
    const byId = new Map(items.map(i=>[i.id,i]));
    let result = bookmarks.map(id=>byId.get(id)).filter(Boolean);
    if (tagFilter) result = result.filter(i=>(bmTags[i.id]||[]).includes(tagFilter));
    return result;
  }

  function getAllTags() {
    const bookmarks = State.get('bookmarks') || [];
    const bmTags    = State.get('bookmarkTags') || {};
    const s = new Set();
    bookmarks.forEach(id=>(bmTags[id]||[]).forEach(t=>s.add(t)));
    return [...s].sort();
  }

  function redraw() {
    const bm = getBookmarkedItems();
    const allTags = getAllTags();
    const bookmarks = State.get('bookmarks') || [];

    const tagBar = allTags.length > 0 ? `
      <div style="display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid rgba(42,51,71,0.3);flex-wrap:wrap;">
        <button class="sb-tag-filter" data-tag="" style="font-size:10px;padding:2px 8px;border-radius:10px;cursor:pointer;
          background:${!tagFilter?'rgba(255,107,107,0.2)':'rgba(42,51,71,0.3)'};
          border:1px solid ${!tagFilter?'rgba(255,107,107,0.4)':'rgba(42,51,71,0.5)'};
          color:${!tagFilter?'#ff6b6b':'#8b949e'};">All</button>
        ${allTags.map(t=>`
          <button class="sb-tag-filter" data-tag="${escHtml(t)}" style="font-size:10px;padding:2px 8px;border-radius:10px;cursor:pointer;
            background:${tagFilter===t?'rgba(255,107,107,0.2)':'rgba(42,51,71,0.3)'};
            border:1px solid ${tagFilter===t?'rgba(255,107,107,0.4)':'rgba(42,51,71,0.5)'};
            color:${tagFilter===t?'#ff6b6b':'#8b949e'};">${escHtml(t)}</button>`).join('')}
      </div>` : '';

    container.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:16px;border-bottom:1px solid rgba(42,51,71,0.5);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <h2 style="font-size:13px;font-weight:600;color:#c5c9d0;margin:0 0 2px;">Bookmarks</h2>
            <p style="font-size:11px;color:#4a5568;margin:0;">${bookmarks.length} saved · ${bm.length} shown</p>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="sb-export-json" style="font-size:11px;padding:4px 12px;border-radius:6px;background:rgba(42,51,71,0.3);border:1px solid rgba(42,51,71,0.5);color:#8b949e;cursor:pointer;" ${bookmarks.length===0?'disabled':''}>Export JSON</button>
            <button id="sb-export-csv"  style="font-size:11px;padding:4px 12px;border-radius:6px;background:rgba(42,51,71,0.3);border:1px solid rgba(42,51,71,0.5);color:#8b949e;cursor:pointer;" ${bookmarks.length===0?'disabled':''}>Export CSV</button>
          </div>
        </div>
        ${tagBar}
        <div style="flex:1;overflow-y:auto;padding:16px;">
          ${bm.length === 0
            ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;text-align:center;color:#4a5568;font-size:12px;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.25;margin-bottom:12px;"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
                <p>${tagFilter?'No bookmarks with this tag':'No bookmarks yet'}</p>
                <p style="font-size:10px;color:#3a424f;margin-top:4px;">Star items in the feed</p>
              </div>`
            : `<div style="max-width:640px;">${bm.map(renderCard).join('')}</div>`}
        </div>
      </div>`;

    // Tag filter buttons
    container.querySelectorAll('.sb-tag-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        tagFilter = btn.dataset.tag || null;
        redraw();
      });
    });

    // Remove bookmark
    container.querySelectorAll('.sb-rm-bm').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const bms = State.get('bookmarks') || [];
        const tags = State.get('bookmarkTags') || {};
        const nextIds = bms.filter(b => b !== id);
        State.setBookmarks(nextIds);
        await Api.saveBookmarks(nextIds, tags).catch(() => {});
      });
    });

    // Remove tag
    container.querySelectorAll('.sb-rm-tag').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const itemId = btn.dataset.item;
        const tag    = btn.dataset.tag;
        const bmTags = State.get('bookmarkTags') || {};
        const next   = { ...bmTags, [itemId]: (bmTags[itemId]||[]).filter(t=>t!==tag) };
        State.setBookmarkTags(next);
        await Api.saveBookmarks(State.get('bookmarks')||[], next).catch(() => {});
      });
    });

    // Tag input
    container.querySelectorAll('.sb-tag-input').forEach(input => {
      input.addEventListener('keydown', async e => {
        if (e.key !== 'Enter' && e.key !== ',') return;
        e.preventDefault();
        const tag = input.value.trim().toLowerCase();
        if (!tag) return;
        const itemId = input.dataset.id;
        const bmTags = State.get('bookmarkTags') || {};
        const current = bmTags[itemId] || [];
        if (current.includes(tag)) { input.value = ''; return; }
        const next = { ...bmTags, [itemId]: [...current, tag] };
        State.setBookmarkTags(next);
        await Api.saveBookmarks(State.get('bookmarks')||[], next).catch(() => {});
        input.value = '';
      });
    });

    // Card click — navigate to item in feed
    container.querySelectorAll('.sb-bm-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.sb-rm-bm,.sb-rm-tag,.sb-tag-input')) return;
        State.setSelectedId(card.dataset.id);
        State.setActiveView('feed');
      });
    });

    // Exports
    container.querySelector('#sb-export-json')?.addEventListener('click', () => {
      const items = getBookmarkedItems();
      const blob = new Blob([JSON.stringify(items, null, 2)], { type:'application/json' });
      _download(blob, 'signalboard-bookmarks.json');
    });

    container.querySelector('#sb-export-csv')?.addEventListener('click', () => {
      const items = getBookmarkedItems();
      const rows = [['id','title','sourceName','url','publishedAt','relevanceTier','relevanceScore']];
      items.forEach(i => rows.push([i.id, i.title, i.sourceName, i.url, i.publishedAt, i.relevanceTier, i.relevanceScore]));
      const csv = rows.map(r => r.map(f => `"${String(f||'').replace(/"/g,'""')}"`).join(',')).join('\n');
      _download(new Blob([csv], { type:'text/csv' }), 'signalboard-bookmarks.csv');
    });
  }

  function _download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  const unsubs = [
    State.subscribe('bookmarks',   redraw),
    State.subscribe('bookmarkTags', redraw),
    State.subscribe('items',       redraw),
  ];

  redraw();

  return { destroy() { unsubs.forEach(u=>u()); } };
}
