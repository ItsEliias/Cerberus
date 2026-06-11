/**
 * static/js/cyberapps/signalboard/view-feed.js
 * SignalBoard — Feed view: filter bar, item list, reading pane.
 */

import * as State from './state.js';
import * as Api from './api.js';
import * as Feeds from './feeds.js';

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

function applyFilter(items, filter) {
  switch (filter) {
    case 'high':    return items.filter(i => i.relevanceTier === 'critical' || i.relevanceTier === 'high');
    case 'medium':  return items.filter(i => i.relevanceTier === 'medium');
    case 'low':     return items.filter(i => i.relevanceTier === 'low');
    case 'starred': return items.filter(i => State.get('bookmarks').includes(i.id));
    case 'unread':  return items.filter(i => !i.read);
    default:        return items;
  }
}

function sortItems(items) {
  return [...items].sort((a, b) =>
    (b.relevanceScore - a.relevanceScore) ||
    (new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  );
}

// ---------------------------------------------------------------------------
// Reading pane
// ---------------------------------------------------------------------------

function renderReadingPane(container) {
  const id = State.get('selectedId');
  const items = State.get('items');
  const item = id ? items.find(i => i.id === id) : null;

  if (!item) {
    container.innerHTML = `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#4a5568;font-size:12px;text-align:center;padding:24px;">
        <div>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.3;display:block;margin:0 auto 12px;">
            <path d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110-2 1 1 0 010 2z"/>
          </svg>
          <p>Select an item to read</p>
        </div>
      </div>`;
    return;
  }

  const tier = TIER_COLOR[item.relevanceTier] || '#4a5568';
  const isBookmarked = (State.get('bookmarks') || []).includes(item.id);

  container.innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:12px 16px 10px;border-bottom:1px solid rgba(42,51,71,0.5);flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <button class="sb-back-btn" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:11px;padding:0;">← Back</button>
          <span style="font-size:10px;color:#8b949e;">${escHtml(item.sourceName)}</span>
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:${tier}20;color:${tier};border:1px solid ${tier}40;">${item.relevanceTier.toUpperCase()}</span>
          <span style="font-size:10px;font-family:monospace;color:${tier};">[${item.relevanceScore}]</span>
          ${(item.alertMatches||[]).map(m=>`<span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:${m.color}20;color:${m.color};border:1px solid ${m.color}40;">ALERT: ${escHtml(m.label)}</span>`).join('')}
        </div>
        <h2 style="font-size:13px;font-weight:600;color:#e2e8f0;line-height:1.4;margin:0 0 10px;">${escHtml(item.title)}</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a href="${escHtml(item.url)}" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(255,107,107,0.15);border:1px solid rgba(255,107,107,0.3);color:#ff6b6b;text-decoration:none;">Open ↗</a>
          <button class="sb-copy-link-btn" data-url="${escHtml(item.url)}" style="font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(42,51,71,0.3);border:1px solid rgba(42,51,71,0.5);color:#8b949e;cursor:pointer;">Copy Link</button>
          <button class="sb-bookmark-btn" data-id="${escHtml(item.id)}" style="font-size:11px;padding:4px 10px;border-radius:6px;background:${isBookmarked?'rgba(210,153,34,0.15)':'rgba(42,51,71,0.3)'};border:1px solid ${isBookmarked?'rgba(210,153,34,0.3)':'rgba(42,51,71,0.5)'};color:${isBookmarked?'#d29922':'#8b949e'};cursor:pointer;">${isBookmarked?'★ Bookmarked':'☆ Bookmark'}</button>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:16px;">
        <div style="font-size:13px;line-height:1.7;color:#c5c9d0;max-width:680px;">${escHtml(item.summary || 'No summary available.')}</div>
        ${(item.cveIds||[]).length > 0 ? `
          <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;">
            ${(item.cveIds||[]).map(cid=>`<a href="https://nvd.nist.gov/vuln/detail/${escHtml(cid)}" target="_blank" rel="noopener" style="font-size:9px;font-family:monospace;padding:2px 6px;border-radius:4px;background:rgba(210,153,34,0.15);color:#d29922;border:1px solid rgba(210,153,34,0.35);text-decoration:none;">${escHtml(cid)}</a>`).join('')}
          </div>` : ''}
        ${item.aiSummary?.length ? `
          <div style="margin-top:16px;padding:12px;border-radius:6px;background:rgba(74,158,255,0.07);border:1px solid rgba(74,158,255,0.2);">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#4a9eff;margin-bottom:8px;">AI Summary</div>
            <ul style="margin:0;padding-left:16px;color:#c5c9d0;font-size:12px;line-height:1.6;">
              ${item.aiSummary.map(b=>`<li>${escHtml(b)}</li>`).join('')}
            </ul>
          </div>` : ''}
      </div>
    </div>`;

  container.querySelector('.sb-back-btn')?.addEventListener('click', () => {
    State.setSelectedId(null);
  });

  container.querySelector('.sb-copy-link-btn')?.addEventListener('click', e => {
    navigator.clipboard.writeText(e.target.dataset.url).catch(() => {});
    e.target.textContent = 'Copied!';
    setTimeout(() => { e.target.textContent = 'Copy Link'; }, 1500);
  });

  container.querySelector('.sb-bookmark-btn')?.addEventListener('click', async e => {
    const itemId = e.target.dataset.id;
    const bookmarks = State.get('bookmarks') || [];
    const tags = State.get('bookmarkTags') || {};
    const isNowBookmarked = bookmarks.includes(itemId);
    const nextIds = isNowBookmarked ? bookmarks.filter(b => b !== itemId) : [...bookmarks, itemId];
    State.setBookmarks(nextIds);
    await Api.saveBookmarks(nextIds, tags).catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function renderFilterBar(container, onFilter) {
  const filters = [
    { id:'all',     label:'All'     },
    { id:'unread',  label:'Unread'  },
    { id:'high',    label:'High'    },
    { id:'medium',  label:'Medium'  },
    { id:'low',     label:'Low'     },
    { id:'starred', label:'Starred' },
  ];
  const active = State.get('activeFilter') || 'all';
  container.innerHTML = filters.map(f => `
    <button class="sb-filter-btn" data-filter="${f.id}" style="
      padding:3px 10px;border-radius:12px;font-size:10px;font-weight:600;cursor:pointer;
      background:${active===f.id?'rgba(255,107,107,0.2)':'rgba(42,51,71,0.3)'};
      border:1px solid ${active===f.id?'rgba(255,107,107,0.4)':'rgba(42,51,71,0.5)'};
      color:${active===f.id?'#ff6b6b':'#8b949e'};white-space:nowrap;">
      ${f.label}
    </button>
  `).join('');
  container.querySelectorAll('.sb-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      State.setActiveFilter(btn.dataset.filter);
      onFilter();
    });
  });
}

// ---------------------------------------------------------------------------
// Item card
// ---------------------------------------------------------------------------

function renderItemCard(item) {
  const tier = TIER_COLOR[item.relevanceTier] || '#4a5568';
  const selected = State.get('selectedId') === item.id;
  const isBookmarked = (State.get('bookmarks') || []).includes(item.id);
  const topAlert = item.alertMatches?.[0];
  const borderLeft = topAlert?.color || (selected ? '#ff6b6b' : 'transparent');
  const bg = topAlert ? `${topAlert.color}10` : selected ? 'rgba(255,107,107,0.06)' : 'rgba(22,27,39,0.6)';

  return `
    <div class="sb-feed-item" data-id="${escHtml(item.id)}" style="
      margin:6px 12px;border-radius:8px;cursor:pointer;
      background:${bg};
      border:1px solid ${topAlert?`${topAlert.color}40`:selected?'rgba(255,107,107,0.3)':'rgba(42,51,71,0.5)'};
      border-left:3px solid ${borderLeft};
      opacity:${item.read?0.65:1};
      transition:background 0.15s,opacity 0.15s;">
      <div style="padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
          ${!item.read?`<span style="width:6px;height:6px;border-radius:50%;background:#ff6b6b;flex-shrink:0;"></span>`:''}
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:3px;background:rgba(74,158,255,0.12);color:#4a9eff;border:1px solid rgba(74,158,255,0.25);">${escHtml(item.sourceName)}</span>
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:3px;background:${tier}22;color:${tier};border:1px solid ${tier}44;">${item.relevanceTier.toUpperCase()}</span>
          ${topAlert?`<span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:3px;background:${topAlert.color}20;color:${topAlert.color};border:1px solid ${topAlert.color}50;">${escHtml(topAlert.label)}</span>`:''}
          ${(item.cveIds||[]).slice(0,1).map(cid=>`<span style="font-size:9px;font-family:monospace;padding:2px 6px;border-radius:3px;background:rgba(210,153,34,0.15);color:#d29922;border:1px solid rgba(210,153,34,0.35);">${escHtml(cid)}</span>`).join('')}
          <span style="margin-left:auto;font-size:10px;color:#6b7a90;flex-shrink:0;">${timeAgo(item.publishedAt)}</span>
        </div>
        <p style="font-size:13px;font-weight:600;line-height:1.4;margin:0 0 4px;color:${item.read?'#8b949e':'#e2e8f0'};">${escHtml(item.title)}</p>
        ${item.summary?`<p style="font-size:11px;color:#8b949e;margin:0;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escHtml(item.summary)}</p>`:''}
        <div class="sb-item-actions" style="display:flex;gap:6px;margin-top:8px;opacity:0;transition:opacity 0.15s;">
          <button class="sb-bm-btn" data-id="${escHtml(item.id)}" style="font-size:10px;padding:2px 8px;border-radius:6px;background:${isBookmarked?'rgba(210,153,34,0.12)':'rgba(42,51,71,0.2)'};border:1px solid ${isBookmarked?'rgba(210,153,34,0.35)':'rgba(42,51,71,0.5)'};color:${isBookmarked?'#d29922':'#8b949e'};cursor:pointer;">${isBookmarked?'★':'☆'}</button>
          <a href="${escHtml(item.url)}" target="_blank" rel="noopener" style="font-size:10px;padding:2px 8px;border-radius:6px;background:rgba(42,51,71,0.2);border:1px solid rgba(42,51,71,0.5);color:#8b949e;text-decoration:none;">Open ↗</a>
          <span style="margin-left:auto;font-size:10px;font-family:monospace;font-weight:700;padding:2px 6px;border-radius:4px;color:${tier};background:${tier}12;border:1px solid ${tier}25;">${item.relevanceScore}</span>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Escape HTML
// ---------------------------------------------------------------------------

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderFeedView(container) {
  container.style.cssText = 'display:flex;height:100%;overflow:hidden;';

  const feedCol  = document.createElement('div');
  feedCol.style.cssText = 'width:340px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid rgba(42,51,71,0.4);overflow:hidden;';

  const readPane = document.createElement('div');
  readPane.style.cssText = 'flex:1;display:flex;overflow:hidden;min-width:0;';

  container.append(feedCol, readPane);

  // --- Feed column header ---
  const header = document.createElement('div');
  header.style.cssText = 'padding:8px 12px 4px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
  header.innerHTML = `
    <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#4a5568;">Feed</span>
    <div style="display:flex;align-items:center;gap:8px;">
      <button class="sb-refresh-btn" title="Refresh feeds" style="background:none;border:none;cursor:pointer;color:#8b949e;padding:2px;display:flex;align-items:center;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
      </button>
      <button class="sb-mark-all-btn" style="font-size:9px;padding:2px 8px;border-radius:10px;background:transparent;border:1px solid rgba(42,51,71,0.5);color:#6b7a90;cursor:pointer;">Mark all read</button>
    </div>`;
  feedCol.appendChild(header);

  // --- Filter bar ---
  const filterBar = document.createElement('div');
  filterBar.style.cssText = 'display:flex;gap:4px;padding:4px 12px 6px;flex-wrap:wrap;flex-shrink:0;';
  feedCol.appendChild(filterBar);

  // --- Item list ---
  const itemList = document.createElement('div');
  itemList.style.cssText = 'flex:1;overflow-y:auto;padding:4px 0;';
  feedCol.appendChild(itemList);

  // --- Wire up ---

  function renderList() {
    const items   = State.get('items') || [];
    const filter  = State.get('activeFilter') || 'all';
    const filtered = sortItems(applyFilter(items, filter));

    if (filtered.length === 0) {
      itemList.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;text-align:center;padding:24px;color:#4a5568;font-size:12px;">
          <svg width="40" height="40" viewBox="0 0 64 64" fill="none" style="opacity:0.15;margin-bottom:12px;">
            <circle cx="32" cy="32" r="30" stroke="#ff6b6b" stroke-width="1.5" stroke-dasharray="4 3"/>
            <circle cx="32" cy="32" r="20" stroke="#ff6b6b" stroke-width="1"/>
            <circle cx="32" cy="32" r="10" stroke="#ff6b6b" stroke-width="1"/>
            <circle cx="32" cy="32" r="2" fill="#ff6b6b"/>
          </svg>
          <p>No signals found</p>
          <p style="font-size:10px;color:#3a424f;margin-top:4px;">Add sources in the Sources tab</p>
        </div>`;
      return;
    }

    itemList.innerHTML = filtered.map(renderItemCard).join('');

    itemList.querySelectorAll('.sb-feed-item').forEach(card => {
      card.addEventListener('mouseenter', () => {
        card.querySelector('.sb-item-actions').style.opacity = '1';
      });
      card.addEventListener('mouseleave', () => {
        card.querySelector('.sb-item-actions').style.opacity = '0';
      });
      card.addEventListener('click', async e => {
        if (e.target.closest('.sb-bm-btn') || e.target.closest('a')) return;
        const id = card.dataset.id;
        State.setSelectedId(id);
        const item = (State.get('items')||[]).find(i => i.id === id);
        if (item && !item.read) {
          State.patchItem(id, { read: true });
          await Api.patchItem(id, { read: true }).catch(() => {});
        }
      });

      card.querySelectorAll('.sb-bm-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const bmId = btn.dataset.id;
          const bookmarks = State.get('bookmarks') || [];
          const tags = State.get('bookmarkTags') || {};
          const isBm = bookmarks.includes(bmId);
          const nextIds = isBm ? bookmarks.filter(b=>b!==bmId) : [...bookmarks, bmId];
          State.setBookmarks(nextIds);
          await Api.saveBookmarks(nextIds, tags).catch(() => {});
        });
      });
    });
  }

  renderFilterBar(filterBar, renderList);

  header.querySelector('.sb-refresh-btn').addEventListener('click', async () => {
    await Feeds.refreshFeeds();
  });

  header.querySelector('.sb-mark-all-btn').addEventListener('click', async () => {
    const items = State.get('items') || [];
    const unread = items.filter(i => !i.read);
    unread.forEach(i => State.patchItem(i.id, { read: true }));
    await Promise.all(unread.map(i => Api.patchItem(i.id, { read: true }).catch(() => {})));
  });

  // Subscribe to state changes
  const unsubs = [
    State.subscribe('items',        () => { renderList(); renderReadingPane(readPane); }),
    State.subscribe('activeFilter', () => renderList()),
    State.subscribe('selectedId',   () => { renderList(); renderReadingPane(readPane); }),
    State.subscribe('bookmarks',    () => { renderList(); renderReadingPane(readPane); }),
    State.subscribe('refreshing',   refreshing => {
      const btn = header.querySelector('.sb-refresh-btn svg');
      if (btn) btn.style.animation = refreshing ? 'sb-spin 1s linear infinite' : '';
    }),
  ];

  renderList();
  renderReadingPane(readPane);

  return {
    destroy() { unsubs.forEach(u => u()); },
  };
}
