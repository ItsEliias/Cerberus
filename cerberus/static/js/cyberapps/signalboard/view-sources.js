/**
 * static/js/cyberapps/signalboard/view-sources.js
 * SignalBoard — Sources view: list sources, add, toggle, delete, health.
 */

import * as State from './state.js';
import * as Api from './api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso) {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  if (d < 10000)    return 'just now';
  if (d < 60000)    return `${Math.floor(d/1000)}s ago`;
  if (d < 3600000)  return `${Math.floor(d/60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d/3600000)}h ago`;
  return `${Math.floor(d/86400000)}d ago`;
}

function healthColor(src) {
  if (!src.enabled) return '#4a5568';
  const attempts = src.attemptCount || ((src.successCount||0)+(src.errorCount||0));
  if (!attempts) return '#4a9eff';
  const rate = (src.successCount||0) / attempts;
  if ((src.consecutiveFailures||0) >= 3) return '#f85149';
  if (rate >= 0.8) return '#3fb950';
  if (rate >= 0.5) return '#d29922';
  return '#f85149';
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------------------------------------------------------------------------
// Source row
// ---------------------------------------------------------------------------

function renderSourceRow(src) {
  const hColor = healthColor(src);
  const attempts = src.attemptCount || ((src.successCount||0)+(src.errorCount||0));
  const rate = attempts > 0 ? Math.round(((src.successCount||0)/attempts)*100) : null;
  let hostname = '';
  try { hostname = new URL(src.url).hostname; } catch { hostname = src.url.slice(0,30); }

  return `
    <div class="sb-source-row" data-id="${escHtml(src.id)}" style="
      display:flex;align-items:center;gap:10px;padding:10px 16px;
      border-bottom:1px solid rgba(42,51,71,0.3);
      transition:background 0.1s;">
      <span style="width:8px;height:8px;border-radius:50%;background:${hColor};flex-shrink:0;" title="${rate!==null?rate+'% success':'unknown'}"></span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
          <span style="font-size:11px;font-weight:500;color:#c5c9d0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(src.name)}</span>
          <span style="font-size:9px;padding:1px 4px;background:rgba(42,51,71,0.5);color:rgba(139,148,158,0.6);border-radius:3px;font-family:monospace;text-transform:uppercase;">${escHtml(src.type||'rss')}</span>
          ${src.category?`<span style="font-size:9px;padding:1px 4px;background:rgba(42,51,71,0.4);color:rgba(139,148,158,0.5);border-radius:3px;">${escHtml(src.category)}</span>`:''}
        </div>
        <p style="font-size:10px;color:#4a5568;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(hostname)}</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
        ${rate!==null?`<span style="font-size:10px;font-family:monospace;color:${hColor};">${rate}%</span>`:''}
        <span style="font-size:10px;font-family:monospace;color:#4a5568;" title="Last fetch">${timeAgo(src.lastFetchAt)}</span>
        <button class="sb-src-toggle" data-id="${escHtml(src.id)}" data-enabled="${src.enabled}" style="
          font-size:10px;padding:3px 10px;border-radius:10px;cursor:pointer;
          background:${src.enabled?'rgba(63,185,80,0.12)':'rgba(42,51,71,0.3)'};
          border:1px solid ${src.enabled?'rgba(63,185,80,0.3)':'rgba(42,51,71,0.5)'};
          color:${src.enabled?'#3fb950':'#6b7a90'};
          white-space:nowrap;">${src.enabled?'Enabled':'Disabled'}</button>
        <button class="sb-src-del" data-id="${escHtml(src.id)}" data-name="${escHtml(src.name)}" style="
          font-size:10px;padding:3px 6px;border-radius:6px;cursor:pointer;
          background:rgba(248,81,73,0.08);border:1px solid rgba(248,81,73,0.2);color:#f85149;">✕</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Add source form
// ---------------------------------------------------------------------------

function renderAddForm() {
  return `
    <div style="padding:16px;border-bottom:1px solid rgba(42,51,71,0.4);">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#4a5568;margin-bottom:10px;">Add Source</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="sb-src-name" placeholder="Name" style="
          flex:1;min-width:120px;padding:6px 10px;border-radius:6px;
          background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);
          color:#c5c9d0;font-size:11px;outline:none;" />
        <input id="sb-src-url" placeholder="URL (RSS/Atom)" style="
          flex:2;min-width:200px;padding:6px 10px;border-radius:6px;
          background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);
          color:#c5c9d0;font-size:11px;outline:none;" />
        <select id="sb-src-cat" style="
          padding:6px 10px;border-radius:6px;
          background:rgba(22,27,39,0.6);border:1px solid rgba(42,51,71,0.6);
          color:#c5c9d0;font-size:11px;outline:none;">
          <option>Custom</option>
          <option>CVE</option>
          <option>Threat Intel</option>
          <option>Security News</option>
          <option>Malware</option>
          <option>Research</option>
          <option>GitHub</option>
        </select>
        <button id="sb-src-add-btn" style="
          padding:6px 16px;border-radius:6px;
          background:rgba(255,107,107,0.15);border:1px solid rgba(255,107,107,0.3);
          color:#ff6b6b;font-size:11px;cursor:pointer;">Add</button>
      </div>
      <div id="sb-src-err" style="font-size:10px;color:#f85149;margin-top:6px;display:none;"></div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderSourcesView(container) {
  function redraw() {
    const sources = State.get('sources') || [];

    container.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:16px;border-bottom:1px solid rgba(42,51,71,0.5);flex-shrink:0;">
          <h2 style="font-size:13px;font-weight:600;color:#c5c9d0;margin:0 0 2px;">Sources</h2>
          <p style="font-size:11px;color:#4a5568;margin:0;">${sources.length} source${sources.length!==1?'s':''} configured</p>
        </div>
        ${renderAddForm()}
        <div style="flex:1;overflow-y:auto;">
          ${sources.length===0
            ? `<div style="padding:32px;text-align:center;color:#4a5568;font-size:12px;">No sources yet — add one above.</div>`
            : sources.map(renderSourceRow).join('')}
        </div>
      </div>`;

    // Wire add form
    const addBtn = container.querySelector('#sb-src-add-btn');
    const errDiv = container.querySelector('#sb-src-err');
    addBtn?.addEventListener('click', async () => {
      const name = container.querySelector('#sb-src-name')?.value?.trim();
      const url  = container.querySelector('#sb-src-url')?.value?.trim();
      const cat  = container.querySelector('#sb-src-cat')?.value || 'Custom';
      errDiv.style.display = 'none';
      if (!name || !url) { errDiv.textContent = 'Name and URL are required.'; errDiv.style.display = ''; return; }
      try { new URL(url); } catch { errDiv.textContent = 'Invalid URL.'; errDiv.style.display = ''; return; }
      try {
        const { source } = await Api.createSource({ name, url, category: cat });
        State.setSources([...(State.get('sources')||[]), source]);
      } catch(e) { errDiv.textContent = 'Failed to add source.'; errDiv.style.display = ''; }
    });

    // Wire toggle + delete
    container.querySelectorAll('.sb-src-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const enabled = btn.dataset.enabled === 'true';
        try {
          const { source } = await Api.updateSource(id, { enabled: !enabled });
          State.setSources((State.get('sources')||[]).map(s => s.id===id ? source : s));
        } catch { /* ignore */ }
      });
    });

    container.querySelectorAll('.sb-src-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm(`Delete source "${btn.dataset.name}"?`)) return;
        try {
          await Api.deleteSource(id);
          State.setSources((State.get('sources')||[]).filter(s => s.id!==id));
        } catch { /* ignore */ }
      });
    });
  }

  const unsub = State.subscribe('sources', redraw);
  redraw();

  return { destroy() { unsub(); } };
}
