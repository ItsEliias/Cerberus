/**
 * static/js/cyberapps/networkmap/index.js
 *
 * NetworkMap — Cerberus native app.
 * Force-directed network topology visualiser.
 * Ported from the CyberOS Electron app (TypeScript/React → vanilla ES module).
 *
 * Features: nmap XML import, paste XML, GNS3 JSON, force/tree/circle/grid
 * layouts, subnet bubbles, vuln overlay, heatmap, scan diff, path tracing,
 * node annotation, filter panel, search, export (SVG/PNG/JSON).
 *
 * Registry: vault: false — NetworkMap does not store credentials.
 */

import { GraphLibraryView }                                    from './library.js';
import { NetworkCanvas }                                       from './canvas.js';
import { buildToolbar }                                        from './toolbar.js';
import { openImportModal, buildNodeDetailPanel }               from './panels.js';
import { buildFilterPanel, applyFilters, activeFilterCount, EMPTY_FILTERS } from './filter-panel.js';
import { saveGraph, deleteGraph }                              from './api.js';
import { inferEdges }                                          from './nmap-parser.js';
import { runSimulation, calcHealthScore, computeDiff }         from './graph-algorithms.js';

const ICON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
  <path d="M8 1L14.5 4.75V11.25L8 15L1.5 11.25V4.75L8 1Z" stroke="#ff8c42" stroke-width="1.5" fill="none"/>
  <circle cx="8" cy="8" r="2" fill="#ff8c42"/>
</svg>`;

// ─── App state ────────────────────────────────────────────────────────────────

let _container = null;
let _view = 'library';            // 'library' | 'canvas'
let _graph = null;
let _allScans = [];               // ScanRecord[] for diff/timeline
let _canvas = null;
let _toolbar = null;
let _library = null;
let _nodeDetailEl = null;
let _filterPanelEl = null;

// Canvas toolbar state
let _layoutMode    = 'force';
let _showSubnets   = false;
let _showVuln      = false;
let _showHeatmap   = false;
let _compareMode   = false;
let _filterOpen    = false;
let _filters       = { ...EMPTY_FILTERS };
let _searchQuery   = '';
let _saveMsg       = '';
let _saveMsgTimer  = null;
let _diffBase      = 0;
let _diffLatest    = 1;

// ─── Exported lifecycle ───────────────────────────────────────────────────────

export function init(container, ctx) {
  _container = container;
  _view = 'library';
  _graph = null;
  _allScans = [];
  _renderView();
}

export function destroy() {
  if (_canvas) { _canvas.destroy(); _canvas = null; }
  if (_container) { _container.innerHTML = ''; _container = null; }
  _library = null;
  _toolbar = null;
}

// ─── View routing ─────────────────────────────────────────────────────────────

function _renderView() {
  if (!_container) return;
  _container.innerHTML = '';
  Object.assign(_container.style, { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg,#1a1d23)' });

  if (_view === 'library') _mountLibrary();
  else if (_view === 'canvas') _mountCanvas();
}

// ─── Library view ─────────────────────────────────────────────────────────────

function _mountLibrary() {
  if (_canvas) { _canvas.destroy(); _canvas = null; }
  _library = new GraphLibraryView(_container, {
    onOpen:   graph => _openGraph(graph),
    onNew:    ()    => _openGraph(_makeEmptyGraph()),
    onImport: ()    => openImportModal(g => _handleImport(g)),
  });
}

function _makeEmptyGraph() {
  const id  = `graph-${Date.now()}`;
  const now = new Date().toISOString();
  return { id, name: 'Untitled Graph', nodes: [], edges: [], createdAt: now, updatedAt: now };
}

function _openGraph(graph) {
  _graph = _buildGraph(graph);
  _view  = 'canvas';
  _resetCanvasState();
  _renderView();
}

function _buildGraph(g) {
  const edges = g.edges.length > 0 ? g.edges : inferEdges(g.nodes);
  const needsLayout = g.nodes.length > 0 && g.nodes.every(n => n.x === 0 && n.y === 0);
  if (needsLayout) {
    return { ...g, nodes: runSimulation(g.nodes, edges, 900, 650), edges };
  }
  return { ...g, edges };
}

function _resetCanvasState() {
  _layoutMode = 'force'; _showSubnets = false; _showVuln = false;
  _showHeatmap = false; _compareMode = false; _filterOpen = false;
  _filters = { ...EMPTY_FILTERS }; _searchQuery = ''; _saveMsg = '';
}

async function _handleImport(graph) {
  _allScans.push({ scanName: graph.name, importedAt: graph.createdAt, nodes: graph.nodes });
  try { await saveGraph(graph); } catch (e) { console.error('[NetworkMap] save failed', e); }
  _openGraph(graph);
}

// ─── Canvas view ──────────────────────────────────────────────────────────────

function _mountCanvas() {
  if (!_graph) return;

  // Toolbar
  _toolbar = buildToolbar({
    onBack:             () => { _view = 'library'; _renderView(); if (_library) _library.refresh(); },
    onNameChange:       name => { _graph = { ..._graph, name }; },
    onSave:             () => _saveCurrentGraph(),
    onLayoutChange:     mode => {
      _layoutMode = mode;
      const g = _canvas.applyLayout(mode);
      _graph = g;
      _updateToolbar();
    },
    onToggleSubnets:    () => { _showSubnets = !_showSubnets;  _syncCanvasOptions(); _updateToolbar(); },
    onToggleVulnOverlay:() => { _showVuln    = !_showVuln;     _syncCanvasOptions(); _updateToolbar(); },
    onToggleHeatmap:    () => { _showHeatmap = !_showHeatmap;  _syncCanvasOptions(); _updateToolbar(); },
    onToggleCompare:    () => { _compareMode = !_compareMode;  _syncCanvasOptions(); _updateToolbar(); },
    onToggleFilter:     () => { _filterOpen  = !_filterOpen;   _updateFilterPanel(); _updateToolbar(); },
    onSearchChange:     q  => { _searchQuery = q; _applySearch(); },
    onSearchEnter:      () => _scrollToFirstMatch(),
    onExport:           fmt => _handleExport(fmt),
    onLayerChange:      mode => { _canvas.setOptions({ layerMode: mode }); },
  });
  _container.appendChild(_toolbar.el);

  // Canvas area (flex)
  const canvasWrapper = document.createElement('div');
  Object.assign(canvasWrapper.style, { display: 'flex', flex: '1', minHeight: '0', position: 'relative', overflow: 'hidden' });

  // Left sidebar (graph list + legend)
  const sidebar = _buildSidebar();
  canvasWrapper.appendChild(sidebar);

  // Main canvas
  const canvasArea = document.createElement('div');
  Object.assign(canvasArea.style, { flex: '1', overflow: 'hidden', position: 'relative' });
  canvasWrapper.appendChild(canvasArea);
  _container.appendChild(canvasWrapper);

  // Status bar
  _container.appendChild(_buildStatusBar());

  // Initialize canvas
  _canvas = new NetworkCanvas(canvasArea);
  _canvas.setGraph(_graph);
  _canvas.onSelect(node => { _showNodeDetail(node, canvasArea); _updateStatusBar(); });
  _canvas.onCtxMenu((node, x, y) => _showContextMenu(node, x, y));

  // Zoom buttons
  _buildZoomControls(canvasArea);

  _updateToolbar();
}

function _buildSidebar() {
  const sidebar = document.createElement('div');
  Object.assign(sidebar.style, { width: '180px', minWidth: '180px', borderRight: '1px solid rgba(42,51,71,0.5)', display: 'flex', flexDirection: 'column', background: 'rgba(10,11,18,0.95)' });

  // Legend
  const legend = document.createElement('div');
  Object.assign(legend.style, { padding: '10px 12px', borderBottom: '1px solid rgba(42,51,71,0.4)' });
  legend.innerHTML = `<div style="font-size:9px;font-weight:700;color:#8b949e;letter-spacing:0.07em;margin-bottom:6px;text-transform:uppercase">Legend</div>`;
  [['#3fb950','1–2 ports'],['#d29922','3–5 ports'],['#f85149','6+ ports'],['#484f58','Down']].forEach(([color,label]) => {
    legend.insertAdjacentHTML('beforeend', `<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px"><span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;box-shadow:0 0 5px ${color}60"></span><span style="font-size:10px;color:#e2e8f0">${label}</span></div>`);
  });
  sidebar.appendChild(legend);
  return sidebar;
}

function _buildZoomControls(parent) {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position: 'absolute', bottom: '12px', right: '12px', display: 'flex', flexDirection: 'column', gap: '4px', zIndex: '21' });
  [['＋','Zoom in',() => _canvas.zoomIn()],['−','Zoom out',() => _canvas.zoomOut()],['⊞','Fit all',() => _canvas.fitView()],['↺','Reset',() => _canvas.resetView()]].forEach(([icon,title,fn]) => {
    const b = document.createElement('button');
    b.title = title; b.textContent = icon;
    Object.assign(b.style, { width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,10,15,0.88)', border: '1px solid rgba(42,51,71,0.7)', borderRadius: '7px', color: '#e2e8f0', fontSize: '14px', cursor: 'pointer' });
    b.addEventListener('click', fn);
    b.addEventListener('mouseenter', () => { b.style.background = 'rgba(255,140,66,0.15)'; b.style.color = '#ff8c42'; b.style.borderColor = 'rgba(255,140,66,0.4)'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'rgba(10,10,15,0.88)'; b.style.color = '#e2e8f0'; b.style.borderColor = 'rgba(42,51,71,0.7)'; });
    wrap.appendChild(b);
  });
  parent.appendChild(wrap);
}

function _buildStatusBar() {
  const bar = document.createElement('div');
  bar.id = 'nm-status-bar';
  Object.assign(bar.style, { padding: '4px 16px', borderTop: '1px solid rgba(42,51,71,0.4)', fontSize: '10px', color: '#8b949e', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(7,8,15,0.6)', flexShrink: '0' });
  bar.innerHTML = `<span style="color:rgba(255,140,66,0.6);font-weight:600;letter-spacing:0.06em;text-transform:uppercase;font-size:9px">NetworkMap</span><span style="color:rgba(42,51,71,0.7)">·</span><span id="nm-sb-name" style="color:#e2e8f0;font-weight:500"></span><span style="color:rgba(42,51,71,0.7)">·</span><span id="nm-sb-counts" style="font-variant-numeric:tabular-nums"></span>`;
  return bar;
}

function _updateStatusBar() {
  if (!_container) return;
  const nameEl   = _container.querySelector('#nm-sb-name');
  const countEl  = _container.querySelector('#nm-sb-counts');
  if (nameEl  && _graph) nameEl.textContent  = _graph.name;
  if (countEl && _graph) countEl.innerHTML   = `<span style="color:#d29922">${_graph.nodes.length}</span><span style="color:#4a5568;margin:0 2px">n</span><span style="color:rgba(42,51,71,0.7);margin:0 2px">·</span><span style="color:#8b949e">${_graph.edges.length}</span><span style="color:#4a5568;margin:0 2px">e</span>`;
}

// ─── Toolbar / canvas sync ────────────────────────────────────────────────────

function _updateToolbar() {
  if (!_toolbar || !_graph) return;
  const health = _graph.nodes.length ? calcHealthScore(_graph.nodes, _graph.nodes.flatMap(n => n.vulns ?? [])) : null;
  _toolbar.update({
    graphName:       _graph.name,
    nodeCount:       _graph.nodes.length,
    edgeCount:       _graph.edges.length,
    layoutMode:      _layoutMode,
    showSubnets:     _showSubnets,
    showVulnOverlay: _showVuln,
    showHeatmap:     _showHeatmap,
    compareMode:     _compareMode,
    filterOpen:      _filterOpen,
    filterCount:     activeFilterCount(_filters),
    saveMsg:         _saveMsg,
    healthScore:     health,
  });
  _updateStatusBar();
}

function _syncCanvasOptions() {
  if (!_canvas) return;
  _canvas.setOptions({ showSubnets: _showSubnets, showVulnOverlay: _showVuln, showHeatmap: _showHeatmap, compareMode: _compareMode });
  if (_compareMode && _allScans.length >= 2) {
    const diff = computeDiff(_allScans[_diffBase]?.nodes ?? [], _allScans[_diffLatest]?.nodes ?? []);
    _canvas.setDiff(diff);
  }
}

function _applySearch() {
  if (!_canvas || !_graph) return;
  const q = _searchQuery.trim().toLowerCase();
  if (!q) { _canvas.setSearch(null); return; }
  const matches = new Set(_graph.nodes.filter(n =>
    n.ip.includes(q) || (n.hostname ?? '').toLowerCase().includes(q) ||
    n.ports.some(p => String(p.port).includes(q) || (p.service ?? '').toLowerCase().includes(q))
  ).map(n => n.id));
  _canvas.setSearch(matches);
}

function _scrollToFirstMatch() {
  if (!_canvas || !_graph || !_searchQuery.trim()) return;
  const q = _searchQuery.trim().toLowerCase();
  const first = _graph.nodes.find(n => n.ip.includes(q) || (n.hostname ?? '').toLowerCase().includes(q));
  if (first) _canvas.centerOn(first.id);
}

// ─── Node detail ──────────────────────────────────────────────────────────────

function _showNodeDetail(node, parent) {
  if (_nodeDetailEl) { _nodeDetailEl.remove(); _nodeDetailEl = null; }
  if (!node) return;
  _nodeDetailEl = buildNodeDetailPanel(node, () => {
    if (_nodeDetailEl) { _nodeDetailEl.remove(); _nodeDetailEl = null; }
    if (_canvas) { _canvas._selectedId = null; _canvas.render(); }
  }, (nodeId, text) => {
    if (!_graph) return;
    _graph = { ..._graph, nodes: _graph.nodes.map(n => n.id === nodeId ? { ...n, annotation: text || undefined } : n) };
    if (_canvas) _canvas.setGraph(_graph);
  });
  parent.appendChild(_nodeDetailEl);
}

// ─── Filter panel ─────────────────────────────────────────────────────────────

function _updateFilterPanel() {
  if (_filterPanelEl) { _filterPanelEl.remove(); _filterPanelEl = null; }
  if (!_filterOpen || !_graph) return;
  const canvasArea = _container?.querySelector('div[style*="flex: 1"]');
  if (!canvasArea) return;
  _filterPanelEl = buildFilterPanel({
    nodes:    _graph.nodes,
    filters:  _filters,
    onChange: f => { _filters = f; _applyFilter(); _updateToolbar(); },
    onClose:  () => { _filterOpen = false; _updateFilterPanel(); _updateToolbar(); },
  });
  canvasArea.appendChild(_filterPanelEl);
}

function _applyFilter() {
  if (!_canvas || !_graph) return;
  const visible = applyFilters(_graph.nodes, _filters);
  _canvas.setFilters(visible);
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function _showContextMenu(node, x, y) {
  document.querySelectorAll('.nm-ctx-menu').forEach(e => e.remove());
  const menu = document.createElement('div');
  menu.className = 'nm-ctx-menu';
  Object.assign(menu.style, { position: 'fixed', top: y + 'px', left: x + 'px', background: 'rgba(13,14,24,0.97)', border: '1px solid rgba(42,51,71,0.7)', borderRadius: '8px', zIndex: '200', padding: '4px', minWidth: '160px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' });

  function menuItem(text, fn) {
    const b = document.createElement('button'); b.textContent = text;
    Object.assign(b.style, { padding: '7px 12px', fontSize: '12px', background: 'transparent', border: 'none', color: '#e2e8f0', cursor: 'pointer', textAlign: 'left', borderRadius: '5px', width: '100%' });
    b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.05)');
    b.addEventListener('mouseleave', () => b.style.background = 'transparent');
    b.addEventListener('click', () => { menu.remove(); fn(); });
    menu.appendChild(b);
  }

  menuItem('Trace path from here', () => { if (_canvas) _canvas.tracePathFrom(node.id); });
  menuItem('Copy IP', () => navigator.clipboard.writeText(node.ip).catch(() => {}));
  if (node.hostname) menuItem('Copy hostname', () => navigator.clipboard.writeText(node.hostname).catch(() => {}));
  menuItem('Clear path', () => { if (_canvas) _canvas.clearPath(); });

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

// ─── Save / export ────────────────────────────────────────────────────────────

async function _saveCurrentGraph() {
  if (!_graph) return;
  try {
    await saveGraph({ ..._graph, updatedAt: new Date().toISOString() });
    _saveMsg = 'Saved';
    _updateToolbar();
    clearTimeout(_saveMsgTimer);
    _saveMsgTimer = setTimeout(() => { _saveMsg = ''; _updateToolbar(); }, 2000);
  } catch (e) {
    _saveMsg = 'Error';
    _updateToolbar();
    setTimeout(() => { _saveMsg = ''; _updateToolbar(); }, 3000);
  }
}

function _handleExport(fmt) {
  if (!_canvas || !_graph) return;
  if (fmt === 'json') {
    _downloadText(JSON.stringify(_graph, null, 2), _graph.name + '.json', 'application/json');
  } else if (fmt === 'svg') {
    _downloadText(_canvas.exportSvgString(), _graph.name + '.svg', 'image/svg+xml');
  } else if (fmt === 'png') {
    const svgStr = _canvas.exportSvgString();
    const blob   = new Blob([svgStr], { type: 'image/svg+xml' });
    const url    = URL.createObjectURL(blob);
    const img    = new Image();
    img.onload = () => {
      const cvs = document.createElement('canvas');
      cvs.width  = img.width  || 1200;
      cvs.height = img.height || 800;
      cvs.getContext('2d').drawImage(img, 0, 0);
      _downloadDataURL(cvs.toDataURL('image/png'), _graph.name + '.png');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
}

function _downloadText(text, filename, type) {
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function _downloadDataURL(dataUrl, filename) {
  const a   = document.createElement('a');
  a.href    = dataUrl;
  a.download = filename;
  a.click();
}

// ─── Self-register with CYBER_APPS_REGISTRY ───────────────────────────────────

if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id:      'networkmap',
    name:    'NetworkMap',
    icon:    ICON_SVG,
    init,
    destroy,
    vault:   false,
  });
}
