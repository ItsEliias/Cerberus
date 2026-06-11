/**
 * library.js — Graph Library view (port of GraphLibrary.tsx).
 * Lists saved graphs, supports search and sort.
 */

import { listGraphs, loadGraph, deleteGraph } from './api.js';

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function fmtRelative(iso) {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000), hrs = Math.floor(ms / 3600000), days = Math.floor(ms / 86400000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hrs < 24)  return `${hrs}h ago`;
    if (days < 7)  return `${days}d ago`;
    return fmtDate(iso);
  } catch { return iso; }
}

function importSourceLabel(src) {
  if (src === 'nmap-xml')  return 'nmap XML';
  if (src === 'paste')     return 'Paste';
  if (src === 'recondesk') return 'ReconDesk';
  if (src === 'gns3')      return 'GNS3';
  return '—';
}

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.cls)  e.className = opts.cls;
  if (opts.text) e.textContent = opts.text;
  if (opts.html) e.innerHTML = opts.html;
  if (opts.style) Object.assign(e.style, opts.style);
  return e;
}

export class GraphLibraryView {
  /**
   * @param {HTMLElement} container
   * @param {{ onOpen: (g) => void, onNew: () => void, onImport: () => void }} callbacks
   */
  constructor(container, callbacks) {
    this._container = container;
    this._onOpen    = callbacks.onOpen;
    this._onNew     = callbacks.onNew;
    this._onImport  = callbacks.onImport;
    this._graphs    = [];
    this._search    = '';
    this._sort      = 'date-desc';
    this._deleteConfirm = null;
    this._deleteTimer   = null;

    this._buildDOM();
    this.refresh();
  }

  _buildDOM() {
    this._container.innerHTML = '';
    Object.assign(this._container.style, { display: 'flex', flexDirection: 'column', height: '100%', background: '#07080f' });

    // Title bar
    const titleBar = el('div', { style: { padding: '0 20px', height: '48px', display: 'flex', alignItems: 'center', background: 'rgba(7,8,15,0.98)', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: '0' } });
    titleBar.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;filter:drop-shadow(0 0 4px rgba(255,140,66,0.4))">
        <path d="M8 1L14.5 4.75V11.25L8 15L1.5 11.25V4.75L8 1Z" stroke="#ff8c42" stroke-width="1.5" fill="none"/>
        <circle cx="8" cy="8" r="2" fill="#ff8c42"/>
      </svg>
      <span style="font-size:13px;font-weight:600;letter-spacing:0.02em;color:#e2e8f0;margin-left:8px">NetworkMap</span>
      <span style="font-size:9px;font-family:monospace;padding:2px 6px;border-radius:4px;background:rgba(255,140,66,0.08);border:1px solid rgba(255,140,66,0.18);color:#ff8c42;margin-left:6px">CYBERTOOLS</span>
    `;
    this._container.appendChild(titleBar);

    // Search + toolbar
    const toolbar = el('div', { style: { padding: '14px 24px', borderBottom: '1px solid rgba(42,51,71,0.5)', display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: '0' } });
    const searchRow = el('div', { style: { position: 'relative' } });
    this._searchInput = el('input');
    Object.assign(this._searchInput.style, { width: '100%', background: '#0d0e18', border: '1px solid rgba(42,51,71,0.75)', borderRadius: '8px', padding: '6px 28px 6px 28px', color: '#e2e8f0', fontSize: '12px', outline: 'none', boxSizing: 'border-box' });
    this._searchInput.placeholder = 'Search graphs by name…';
    this._searchInput.addEventListener('input', () => { this._search = this._searchInput.value; this._renderTable(); });
    searchRow.appendChild(this._searchInput);
    toolbar.appendChild(searchRow);

    const btnRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } });
    const importBtn = el('button', { text: 'Import ▾' });
    Object.assign(importBtn.style, { padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', background: 'rgba(255,140,66,0.12)', border: '1px solid rgba(255,140,66,0.30)', color: '#ff8c42', cursor: 'pointer' });
    importBtn.addEventListener('click', () => this._onImport());

    const newBtn = el('button', { text: '+ New Empty Graph' });
    Object.assign(newBtn.style, { padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '500', background: '#0d0e18', border: '1px solid rgba(42,51,71,0.75)', color: '#8b949e', cursor: 'pointer' });
    newBtn.addEventListener('click', () => this._onNew());

    const sortLabel = el('span', { text: 'Sort:', style: { fontSize: '10px', color: '#8b949e', marginLeft: 'auto' } });
    this._sortSelect = el('select');
    Object.assign(this._sortSelect.style, { background: '#0d0e18', border: '1px solid rgba(42,51,71,0.75)', borderRadius: '8px', padding: '4px 8px', color: '#8b949e', fontSize: '11px', cursor: 'pointer', outline: 'none' });
    const sortOpts = [['date-desc','Newest first'],['date-asc','Oldest first'],['name-asc','Name A–Z'],['name-desc','Name Z–A'],['nodes-desc','Most nodes'],['nodes-asc','Fewest nodes']];
    for (const [v, l] of sortOpts) {
      const o = el('option', { text: l }); o.value = v;
      this._sortSelect.appendChild(o);
    }
    this._sortSelect.addEventListener('change', () => { this._sort = this._sortSelect.value; this._renderTable(); });

    btnRow.appendChild(importBtn); btnRow.appendChild(newBtn); btnRow.appendChild(sortLabel); btnRow.appendChild(this._sortSelect);
    toolbar.appendChild(btnRow);
    this._container.appendChild(toolbar);

    // Error banner
    this._errorBanner = el('div', { style: { display: 'none', margin: '8px 24px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149', fontSize: '12px' } });
    this._container.appendChild(this._errorBanner);

    // Table container
    this._tableWrapper = el('div', { style: { flex: '1', overflowY: 'auto', padding: '0 24px 16px' } });
    this._container.appendChild(this._tableWrapper);
  }

  async refresh() {
    try {
      this._graphs = await listGraphs();
      this._renderTable();
    } catch (e) {
      this._errorBanner.textContent = 'Failed to load graphs: ' + e.message;
      this._errorBanner.style.display = 'block';
    }
  }

  _sorted() {
    let list = [...this._graphs];
    const q = this._search.toLowerCase();
    if (q) list = list.filter(g => g.name.toLowerCase().includes(q));
    switch (this._sort) {
      case 'date-desc':  list.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)); break;
      case 'date-asc':   list.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
      case 'name-asc':   list.sort((a,b) => a.name.localeCompare(b.name)); break;
      case 'name-desc':  list.sort((a,b) => b.name.localeCompare(a.name)); break;
      case 'nodes-desc': list.sort((a,b) => b.nodeCount - a.nodeCount); break;
      case 'nodes-asc':  list.sort((a,b) => a.nodeCount - b.nodeCount); break;
    }
    return list;
  }

  _renderTable() {
    this._tableWrapper.innerHTML = '';
    const sorted = this._sorted();

    if (sorted.length === 0) { this._renderEmpty(); return; }

    const tbl = el('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: '4px' } });
    const thead = el('tr');
    for (const h of ['Name','Source','Created','Modified','Nodes','Edges','Actions']) {
      const th = el('th', { text: h, style: { textAlign: 'left', padding: '10px 12px', fontSize: '9px', fontWeight: '700', color: '#8b949e', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid rgba(42,51,71,0.5)', whiteSpace: 'nowrap' } });
      thead.appendChild(th);
    }
    tbl.appendChild(thead);

    for (const g of sorted) {
      const tr = el('tr');
      tr.style.cursor = 'pointer';
      tr.addEventListener('mouseenter', () => tr.style.background = 'rgba(255,255,255,0.02)');
      tr.addEventListener('mouseleave', () => tr.style.background = 'transparent');
      tr.addEventListener('click', () => this._openGraph(g.id));

      const tdStyle = { padding: '10px 12px', borderBottom: '1px solid rgba(42,51,71,0.4)', color: '#8b949e', fontSize: '12px', verticalAlign: 'middle' };
      const cells = [
        el('td', { text: g.name, style: { ...tdStyle, color: '#e2e8f0', fontWeight: '500', fontSize: '13px' } }),
        (() => { const td = el('td', { style: tdStyle }); td.innerHTML = `<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(255,140,66,0.08);border:1px solid rgba(255,140,66,0.18);color:#ff8c42">${importSourceLabel(g.importSource)}</span>`; return td; })(),
        el('td', { text: fmtDate(g.createdAt), style: { ...tdStyle, fontSize: '11px' } }),
        el('td', { text: fmtRelative(g.createdAt), style: { ...tdStyle, fontSize: '10px', fontFamily: 'monospace' } }),
        (() => { const td = el('td', { style: tdStyle }); td.innerHTML = `<span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:10px;background:rgba(255,140,66,0.07);border:1px solid rgba(255,140,66,0.18);color:#ff8c42">${g.nodeCount}</span>`; return td; })(),
        el('td', { text: g.edgeCount ?? 0, style: { ...tdStyle, fontVariantNumeric: 'tabular-nums' } }),
      ];

      for (const td of cells) tr.appendChild(td);

      // Actions
      const actTd = el('td', { style: tdStyle });
      actTd.addEventListener('click', e => e.stopPropagation());
      const openBtn = el('button', { text: 'Open' });
      Object.assign(openBtn.style, { padding: '4px 10px', borderRadius: '8px', background: '#0d0e18', border: '1px solid rgba(42,51,71,0.75)', color: '#8b949e', fontSize: '11px', cursor: 'pointer', marginRight: '4px' });
      openBtn.addEventListener('click', () => this._openGraph(g.id));

      const isDel = this._deleteConfirm === g.id;
      const delBtn = el('button', { text: isDel ? 'Confirm?' : 'Delete' });
      Object.assign(delBtn.style, { padding: '4px 10px', borderRadius: '8px', background: isDel ? 'rgba(248,81,73,0.10)' : '#0d0e18', border: `1px solid ${isDel ? 'rgba(248,81,73,0.35)' : 'rgba(42,51,71,0.75)'}`, color: isDel ? '#f85149' : '#8b949e', fontSize: '11px', cursor: 'pointer' });
      delBtn.addEventListener('click', () => this._handleDelete(g.id));

      actTd.appendChild(openBtn); actTd.appendChild(delBtn);
      tr.appendChild(actTd);
      tbl.appendChild(tr);
    }
    this._tableWrapper.appendChild(tbl);
  }

  _renderEmpty() {
    const empty = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', gap: '16px', padding: '40px 24px' } });
    empty.innerHTML = `
      <svg width="100" height="80" viewBox="0 0 120 100" fill="none">
        <ellipse cx="60" cy="50" rx="55" ry="45" fill="rgba(255,140,66,0.05)"/>
        <line x1="60" y1="20" x2="25" y2="55" stroke="rgba(255,140,66,0.15)" stroke-width="1.5" stroke-dasharray="3 3"/>
        <line x1="60" y1="20" x2="95" y2="55" stroke="rgba(255,140,66,0.15)" stroke-width="1.5" stroke-dasharray="3 3"/>
        <circle cx="60" cy="20" r="9" fill="rgba(255,140,66,0.10)" stroke="rgba(255,140,66,0.45)" stroke-width="1.5"/>
        <circle cx="25" cy="55" r="7" fill="rgba(255,140,66,0.07)" stroke="rgba(255,140,66,0.28)" stroke-width="1.5"/>
        <circle cx="95" cy="55" r="7" fill="rgba(255,140,66,0.07)" stroke="rgba(255,140,66,0.28)" stroke-width="1.5"/>
      </svg>
      <p style="color:#e2e8f0;font-size:14px;font-weight:600;margin:0">No graphs yet</p>
      <p style="color:#8b949e;font-size:12px;margin:0">Import an nmap XML scan to visualise your network</p>
    `;
    const ib = el('button', { text: 'Import Scan' });
    Object.assign(ib.style, { marginTop: '4px', padding: '9px 24px', borderRadius: '9px', background: 'rgba(255,140,66,0.12)', border: '1px solid rgba(255,140,66,0.32)', color: '#ff8c42', fontWeight: '600', fontSize: '13px', cursor: 'pointer' });
    ib.addEventListener('click', () => this._onImport());
    empty.appendChild(ib);
    this._tableWrapper.appendChild(empty);
  }

  async _openGraph(id) {
    try {
      const g = await loadGraph(id);
      if (g) this._onOpen(g);
    } catch (e) {
      this._errorBanner.textContent = 'Failed to load graph: ' + e.message;
      this._errorBanner.style.display = 'block';
    }
  }

  async _handleDelete(id) {
    if (this._deleteConfirm === id) {
      clearTimeout(this._deleteTimer);
      this._deleteConfirm = null;
      await deleteGraph(id);
      await this.refresh();
    } else {
      this._deleteConfirm = id;
      this._renderTable();
      this._deleteTimer = setTimeout(() => { this._deleteConfirm = null; this._renderTable(); }, 3000);
    }
  }
}
