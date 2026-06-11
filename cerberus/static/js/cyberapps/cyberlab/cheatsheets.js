/**
 * cheatsheets.js — Cheatsheets panel for CyberLab.
 *
 * Features: 8+ embedded categories from cheatsheets_data.py (fetched from
 * /api/cyberlab/cheatsheets), per-cheatsheet search, copy buttons on code blocks,
 * markdown rendering.
 */

const API = '';

export async function renderCheatsheets(container, ctx) {
  container.innerHTML = '<div class="cl-empty">Loading cheatsheets…</div>';
  let index = [];
  try {
    const res = await fetch(`${API}/api/cyberlab/cheatsheets`);
    index = await res.json();
  } catch { container.innerHTML = '<div class="cl-error">Failed to load cheatsheets.</div>'; return; }

  let activeKey = index.length > 0 ? index[0].key : null;
  let searchQ = '';
  let sheetData = null;

  async function loadSheet(key) {
    try {
      const res = await fetch(`${API}/api/cyberlab/cheatsheets/${key}`);
      sheetData = await res.json();
      activeKey = key;
      renderSheet();
    } catch { /* ignore */ }
  }

  function renderSheet() {
    const sheetArea = document.getElementById('cl-sheet-area');
    if (!sheetArea) return;
    sheetArea.innerHTML = '';

    if (!sheetData) return;

    // Search bar for this sheet
    const searchRow = document.createElement('div');
    searchRow.style.marginBottom = '10px';
    searchRow.innerHTML = `<input class="cl-input" id="cl-sheet-search" placeholder="Search this cheatsheet…" value="${_esc(searchQ)}">`;
    sheetArea.appendChild(searchRow);
    searchRow.querySelector('#cl-sheet-search').addEventListener('input', e => { searchQ = e.target.value; renderSheet(); });

    // Handle "ports" which has flat items not sections
    if (sheetData.items && !sheetData.sections) {
      _renderPortsList(sheetArea, sheetData.items, searchQ);
      return;
    }

    const sections = sheetData.sections || [];
    sections.forEach(section => {
      const items = section.items || [];
      const filteredItems = searchQ ? items.filter(item => _itemMatchesSearch(item, searchQ)) : items;
      if (filteredItems.length === 0 && searchQ) return;

      const sectionEl = document.createElement('div');
      sectionEl.style.marginBottom = '16px';
      sectionEl.innerHTML = `<div style="font-size:12px;font-weight:600;opacity:.7;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;">${_esc(section.heading||'')}</div>`;

      filteredItems.forEach(item => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;padding:6px 8px;border-radius:4px;margin-bottom:3px;background:rgba(255,255,255,.03);align-items:flex-start;';
        const code = item.flag || item.step || item.hash || item.port || '';
        const desc = item.description || item.type || item.service || '';
        const extra = item.tool || item.example || '';

        row.innerHTML = `
          <div style="flex:0 0 auto;min-width:0;max-width:55%;">
            <code class="cl-code" style="display:inline-block;word-break:break-all;cursor:pointer;" title="Click to copy">${_esc(String(code))}</code>
          </div>
          <div style="flex:1;font-size:12px;opacity:.75;word-break:break-word;">
            ${_esc(desc)}${extra ? `<span style="opacity:.5;font-size:11px;display:block;">${_esc(extra)}</span>` : ''}
          </div>
          <button class="cl-btn cl-btn-ghost" style="flex-shrink:0;font-size:10px;padding:2px 5px" title="Copy">Copy</button>
        `;

        const codeEl = row.querySelector('code');
        const copyBtn = row.querySelector('button');
        const copyFn = () => {
          navigator.clipboard.writeText(String(code)).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
          });
        };
        codeEl.addEventListener('click', copyFn);
        copyBtn.addEventListener('click', copyFn);

        sectionEl.appendChild(row);
      });

      sheetArea.appendChild(sectionEl);
    });

    if (sheetArea.querySelectorAll('div[style*="margin-bottom: 16px"]').length === 0 && searchQ) {
      sheetArea.innerHTML += `<div class="cl-empty">No results for "${_esc(searchQ)}"</div>`;
    }
  }

  // Main layout: sidebar nav + content area
  container.innerHTML = `
    <div style="display:flex;gap:0;height:100%;min-height:300px;">
      <div id="cl-sheet-nav" style="flex:0 0 130px;border-right:1px solid var(--border,#3a2a2a);padding:8px 4px;overflow-y:auto;"></div>
      <div id="cl-sheet-area" style="flex:1;padding:10px;overflow-y:auto;"></div>
    </div>
  `;

  const nav = document.getElementById('cl-sheet-nav');
  index.forEach(({ key, title }) => {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:block;width:100%;text-align:left;background:none;border:none;color:var(--fg,#c5c9d0);padding:6px 8px;border-radius:4px;font-size:12px;cursor:pointer;margin-bottom:2px;';
    btn.textContent = title;
    btn.dataset.key = key;
    if (key === activeKey) btn.style.background = 'rgba(192,57,43,.15)';
    btn.addEventListener('click', () => {
      nav.querySelectorAll('button').forEach(b => b.style.background = 'none');
      btn.style.background = 'rgba(192,57,43,.15)';
      searchQ = '';
      loadSheet(key);
    });
    nav.appendChild(btn);
  });

  if (activeKey) await loadSheet(activeKey);
}

function _renderPortsList(container, items, searchQ) {
  const filtered = searchQ ? items.filter(item => _itemMatchesSearch(item, searchQ)) : items;
  if (filtered.length === 0) {
    container.innerHTML += `<div class="cl-empty">No results for "${_esc(searchQ)}"</div>`;
    return;
  }
  filtered.forEach(item => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;padding:6px 8px;border-radius:4px;margin-bottom:3px;background:rgba(255,255,255,.03);align-items:flex-start;';
    row.innerHTML = `
      <div style="flex:0 0 55px;font-family:monospace;font-size:12px;color:var(--red,#c0392b)">${_esc(String(item.port))}</div>
      <div style="flex:0 0 80px;font-size:12px;font-weight:500">${_esc(item.service||'')}</div>
      <div style="flex:1;font-size:12px;opacity:.7">${_esc(item.description||'')}</div>
    `;
    container.appendChild(row);
  });
}

function _itemMatchesSearch(item, q) {
  const ql = q.toLowerCase();
  return Object.values(item).some(v => String(v).toLowerCase().includes(ql));
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
