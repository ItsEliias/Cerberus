/**
 * canvas.js — SVG force-directed graph canvas.
 * Vanilla JS port of GraphSvg.tsx + GraphCanvas.tsx (rendering + interaction).
 * No external dependencies — uses inline SVG only.
 */

import { runSimulation, applyLayout, findShortestPath, pathEdgeIds, calcHealthScore, computeDiff } from './graph-algorithms.js';
import { inferEdges, osIcon } from './nmap-parser.js';

function nodeBaseColor(openPortCount) {
  if (openPortCount === 0)  return '#484f58';
  if (openPortCount <= 2)   return '#3fb950';
  if (openPortCount <= 5)   return '#d29922';
  return '#f85149';
}

function nodeRadius(n) {
  if (n === 0)  return 12;
  if (n <= 2)   return 16;
  if (n <= 5)   return 20;
  return 28;
}

function resolveNodeColor(node, showVuln, compareMode, added, removed, changed) {
  if (showVuln && node.vulns && node.vulns.length > 0) {
    const s = node.vulns[0].severity;
    if (s === 'critical') return '#ff4444';
    if (s === 'high')     return '#ff8800';
    if (s === 'medium')   return '#ffcc00';
    return '#44cc44';
  }
  if (compareMode) {
    if (added.has(node.id))   return '#3fb950';
    if (removed.has(node.id)) return '#f85149';
    if (changed.has(node.id)) return '#d29922';
  }
  return nodeBaseColor(node.openPortCount);
}

function protocolColor(protocol) {
  if (!protocol)        return 'rgba(42,51,71,0.8)';
  if (protocol === 'OSPF')  return '#4a9eff';
  if (protocol === 'EIGRP') return '#3fb950';
  if (protocol === 'BGP')   return '#ff8800';
  if (protocol === 'VLAN')  return '#a371f7';
  return 'rgba(42,51,71,0.8)';
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export class NetworkCanvas {
  /** @param {HTMLElement} container */
  constructor(container) {
    this._container = container;
    this._graph = { id: '', name: '', nodes: [], edges: [], createdAt: '', updatedAt: '' };
    this._transform = { x: 0, y: 0, scale: 1 };
    this._selectedId = null;
    this._pathStart = null;
    this._tracedPath = null;
    this._visibleSet = new Set();
    this._searchMatches = null;
    this._showSubnets = false;
    this._showVulnOverlay = false;
    this._showHeatmap = false;
    this._compareMode = false;
    this._diff = { added: new Set(), removed: new Set(), changed: new Set() };
    this._layerMode = 'all';
    this._nodeLabel = 'ip';
    this._drag = null;

    this._onSelect   = null;  // (node|null) => void
    this._onCtxMenu  = null;  // (node, x, y) => void

    this._buildDOM();
    this._bindEvents();
  }

  _buildDOM() {
    this._svg = svgEl('svg', {
      width: '100%', height: '100%',
      style: 'background:#0a0a0f;display:block;',
    });
    this._svg.setAttribute('class', 'nm-graph-canvas');

    // Defs
    this._defs = svgEl('defs');
    this._svg.appendChild(this._defs);

    // Background rect
    const bg = svgEl('rect', { width: '100%', height: '100%', fill: 'transparent' });
    this._svg.appendChild(bg);

    // Transform group
    this._g = svgEl('g');
    this._svg.appendChild(this._g);

    this._container.appendChild(this._svg);

    // Overlay: zoom level badge
    this._zoomBadge = document.createElement('div');
    Object.assign(this._zoomBadge.style, {
      position: 'absolute', bottom: '12px', right: '12px',
      background: 'rgba(10,10,15,0.88)', border: '1px solid rgba(42,51,71,0.5)',
      borderRadius: '6px', fontSize: '9px', fontFamily: 'var(--font-mono,monospace)',
      color: 'rgba(210,153,34,0.8)', fontWeight: '600',
      padding: '3px 6px', pointerEvents: 'none',
    });
    this._container.style.position = 'relative';
    this._container.appendChild(this._zoomBadge);
  }

  _bindEvents() {
    this._svg.addEventListener('mousedown', e => this._onBgMouseDown(e));
    this._svg.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    this._svg.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', this._onMouseMove.bind(this));
    window.addEventListener('mouseup',   this._onMouseUp.bind(this));
  }

  destroy() {
    window.removeEventListener('mousemove', this._onMouseMove.bind(this));
    window.removeEventListener('mouseup',   this._onMouseUp.bind(this));
    this._container.innerHTML = '';
  }

  setGraph(graph, options = {}) {
    this._graph = graph;
    this._selectedId = null;
    this._tracedPath = null;
    this._pathStart = null;

    const needsLayout = graph.nodes.length > 0 && graph.nodes.every(n => n.x === 0 && n.y === 0);
    if (needsLayout) {
      const rect = this._container.getBoundingClientRect();
      const w = rect.width || 900, h = rect.height || 650;
      this._graph = {
        ...graph,
        nodes: runSimulation(graph.nodes, graph.edges, w, h),
      };
    }
    this._updateVisible();
    this.render();
  }

  setOptions(opts) {
    if ('showSubnets'    in opts) this._showSubnets    = opts.showSubnets;
    if ('showVulnOverlay' in opts) this._showVulnOverlay = opts.showVulnOverlay;
    if ('showHeatmap'    in opts) this._showHeatmap    = opts.showHeatmap;
    if ('compareMode'    in opts) this._compareMode    = opts.compareMode;
    if ('layerMode'      in opts) this._layerMode      = opts.layerMode;
    if ('nodeLabel'      in opts) this._nodeLabel      = opts.nodeLabel;
    this.render();
  }

  setDiff(diff) {
    this._diff = diff;
    this.render();
  }

  setFilters(visibleSet) {
    this._visibleSet = visibleSet;
    this._searchMatches = null;
    this.render();
  }

  setSearch(matches) {
    this._searchMatches = matches;
    this._updateVisible();
    this.render();
  }

  applyLayout(mode) {
    const rect = this._container.getBoundingClientRect();
    const w = rect.width || 900, h = rect.height || 650;
    this._graph = { ...this._graph, nodes: applyLayout(this._graph.nodes, this._graph.edges, mode, w, h) };
    this.render();
    return this._graph;
  }

  getGraph()    { return this._graph; }
  getSelected() { return this._graph.nodes.find(n => n.id === this._selectedId) ?? null; }

  zoomIn()    { this._setScale(Math.min(3, this._transform.scale * 1.2)); }
  zoomOut()   { this._setScale(Math.max(0.3, this._transform.scale / 1.2)); }
  resetView() { this._transform = { x: 0, y: 0, scale: 1 }; this.render(); }

  fitView() {
    if (!this._graph.nodes.length) return;
    const rect = this._container.getBoundingClientRect();
    const xs = this._graph.nodes.map(n => n.x), ys = this._graph.nodes.map(n => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const gW = maxX - minX || 1, gH = maxY - minY || 1;
    const scale = Math.max(0.3, Math.min(3, Math.min((rect.width - 80) / gW, (rect.height - 80) / gH)));
    this._transform = {
      scale,
      x: rect.width  / 2 - ((minX + maxX) / 2) * scale,
      y: rect.height / 2 - ((minY + maxY) / 2) * scale,
    };
    this.render();
  }

  centerOn(nodeId) {
    const node = this._graph.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const rect = this._container.getBoundingClientRect();
    this._transform = {
      ...this._transform,
      x: rect.width  / 2 - node.x * this._transform.scale,
      y: rect.height / 2 - node.y * this._transform.scale,
    };
    this.render();
  }

  onSelect(cb)  { this._onSelect  = cb; }
  onCtxMenu(cb) { this._onCtxMenu = cb; }

  tracePathFrom(nodeId) {
    if (!this._pathStart) { this._pathStart = nodeId; }
    else if (this._pathStart === nodeId) { this._pathStart = null; this._tracedPath = null; }
    else {
      this._tracedPath = findShortestPath(this._graph.nodes, this._graph.edges, this._pathStart, nodeId);
      this._pathStart = null;
    }
    this.render();
    return this._tracedPath;
  }

  clearPath() { this._pathStart = null; this._tracedPath = null; this.render(); }

  pathStartId() { return this._pathStart; }
  tracedPath()  { return this._tracedPath; }

  /** Export SVG string */
  exportSvgString() {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + this._svg.outerHTML;
  }

  render() {
    this._g.innerHTML = '';
    this._defs.innerHTML = '';

    const { nodes, edges } = this._graph;
    if (!nodes.length) { this._updateZoomBadge(); return; }

    const pathEdgeSet = this._tracedPath ? pathEdgeIds(this._tracedPath, edges) : new Set();
    const neighborCounts = new Map();
    for (const e of edges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id;
      const t = typeof e.target === 'string' ? e.target : e.target.id;
      neighborCounts.set(s, (neighborCounts.get(s) ?? 0) + 1);
      neighborCounts.set(t, (neighborCounts.get(t) ?? 0) + 1);
    }

    const visSet = this._searchMatches ?? this._visibleSet;
    const edgesToRender = this._layerMode === 'all' ? edges : edges.filter(e => e.layer === this._layerMode || !e.layer);

    // Subnet bubbles
    if (this._showSubnets) this._renderSubnets(nodes);

    // Heatmap defs + circles
    if (this._showHeatmap) this._renderHeatmap(nodes, neighborCounts);

    // Edges
    for (const edge of edgesToRender) {
      const srcId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const tgtId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const src = nodes.find(n => n.id === srcId);
      const tgt = nodes.find(n => n.id === tgtId);
      if (!src || !tgt) continue;

      const isPath   = pathEdgeSet.has(edge.id);
      const bothVis  = visSet.has(srcId) && visSet.has(tgtId);
      const color    = isPath ? '#d29922' : protocolColor(edge.protocol);
      const edgeLbl  = edge.protocol ?? edge.service;

      const line = svgEl('line', {
        x1: src.x, y1: src.y, x2: tgt.x, y2: tgt.y,
        stroke: color, 'stroke-width': isPath ? 2.5 : 1.5,
        opacity: bothVis ? 1 : 0.07,
        'stroke-dasharray': edge.protocol === 'VLAN' ? '4 2' : '',
      });
      this._g.appendChild(line);

      if (edgeLbl && bothVis) {
        const midX = (src.x + tgt.x) / 2, midY = (src.y + tgt.y) / 2;
        const txt = svgEl('text', { x: midX, y: midY - 4, 'text-anchor': 'middle', 'font-size': 8, fill: edge.protocol ? color : 'rgba(139,148,158,0.7)', 'pointer-events': 'none' });
        txt.textContent = edgeLbl;
        this._g.appendChild(txt);
      }
    }

    // Path hop label
    if (this._tracedPath && this._tracedPath.length > 0) {
      const end = nodes.find(n => n.id === this._tracedPath[this._tracedPath.length - 1]);
      if (end) {
        const t = svgEl('text', { x: end.x, y: end.y - 36, 'text-anchor': 'middle', 'font-size': 10, fill: '#d29922', 'pointer-events': 'none' });
        t.textContent = `${this._tracedPath.length - 1} hops`;
        this._g.appendChild(t);
      }
    }

    // Nodes
    for (const node of nodes) {
      this._renderNode(node, visSet, pathEdgeSet);
    }

    this._g.setAttribute('transform', `translate(${this._transform.x},${this._transform.y}) scale(${this._transform.scale})`);
    this._updateZoomBadge();
  }

  _renderNode(node, visSet, pathEdgeSet) {
    const r         = nodeRadius(node.openPortCount);
    const fill      = resolveNodeColor(node, this._showVulnOverlay, this._compareMode, this._diff.added, this._diff.removed, this._diff.changed);
    const isSelected = node.id === this._selectedId;
    const isPathNode = !!this._tracedPath?.includes(node.id);
    const isStart    = node.id === this._pathStart;
    const isVisible  = visSet.has(node.id);
    const isMatch    = this._searchMatches ? this._searchMatches.has(node.id) : true;
    const em         = osIcon(node.os);

    const grp = svgEl('g', {
      transform: `translate(${node.x},${node.y})`,
      style: `cursor:pointer;opacity:${isVisible ? (isMatch ? 1 : 0.15) : 0.2}`,
    });

    if (isSelected || isPathNode || isStart) {
      grp.appendChild(svgEl('circle', {
        r: r + 6,
        fill:  isStart ? 'rgba(88,166,255,0.1)' : 'rgba(210,153,34,0.1)',
        stroke: isStart ? '#58a6ff' : '#d29922',
        'stroke-width': isSelected ? 2.5 : 2,
      }));
    }
    if (this._searchMatches?.has(node.id)) {
      grp.appendChild(svgEl('circle', { r: r + 10, fill: 'none', stroke: '#d29922', 'stroke-width': 1.5, opacity: 0.5 }));
    }

    grp.appendChild(svgEl('circle', {
      r, fill, stroke: isSelected ? '#d29922' : 'rgba(255,255,255,0.15)',
      'stroke-width': isSelected ? 2.5 : 1,
    }));

    const countTxt = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': r >= 20 ? 11 : 10, 'font-weight': 700, fill: 'white', 'pointer-events': 'none' });
    countTxt.textContent = node.openPortCount;
    grp.appendChild(countTxt);

    if (em && em !== '?') {
      const eEl = svgEl('text', { x: r, y: -r + 2, 'font-size': 9, fill: 'rgba(255,255,255,0.8)', 'text-anchor': 'middle', 'pointer-events': 'none' });
      eEl.textContent = em;
      grp.appendChild(eEl);
    }

    if (node.annotation) {
      const annEl = svgEl('text', { x: -r, y: -r + 2, 'font-size': 9, fill: '#d29922', 'pointer-events': 'none' });
      annEl.textContent = '✎';
      grp.appendChild(annEl);
    }

    // Primary label
    const primary = this._nodeLabel === 'hostname' ? (node.hostname ?? node.ip) : node.ip;
    const lblEl = svgEl('text', { y: r + 18, 'text-anchor': 'middle', 'font-size': 11, 'font-family': 'JetBrains Mono,monospace', fill: '#e2e8f0', 'pointer-events': 'none' });
    lblEl.textContent = primary;
    grp.appendChild(lblEl);

    if (this._nodeLabel === 'ip-hostname' && node.hostname) {
      const sec = svgEl('text', { y: r + 30, 'text-anchor': 'middle', 'font-size': 9, 'font-family': 'JetBrains Mono,monospace', fill: '#8b949e', 'pointer-events': 'none' });
      sec.textContent = node.hostname;
      grp.appendChild(sec);
    }

    // Event wiring
    grp.addEventListener('mousedown', e => { e.stopPropagation(); if (e.button !== 2) this._startNodeDrag(e, node); });
    grp.addEventListener('mouseup',   e => { e.stopPropagation(); this._onNodeMouseUp(e, node); });
    grp.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (this._onCtxMenu) this._onCtxMenu(node, e.clientX, e.clientY); });

    this._g.appendChild(grp);
  }

  _renderSubnets(nodes) {
    const groups = new Map();
    for (const n of nodes) {
      const parts = n.ip.split('.');
      const sub = parts.length >= 3 ? parts.slice(0, 3).join('.') + '.0/24' : n.ip;
      if (!groups.has(sub)) groups.set(sub, []);
      groups.get(sub).push(n);
    }
    const colors = ['rgba(88,166,255,0.06)', 'rgba(63,185,80,0.06)', 'rgba(210,153,34,0.06)', 'rgba(248,81,73,0.06)'];
    let ci = 0;
    for (const [sub, members] of groups) {
      if (members.length < 2) continue;
      const xs = members.map(n => n.x), ys = members.map(n => n.y);
      const pad = 40;
      const rx = Math.min(...xs) - pad, ry = Math.min(...ys) - pad;
      const rw = Math.max(...xs) - rx + pad, rh = Math.max(...ys) - ry + pad;
      const rect = svgEl('rect', { x: rx, y: ry, width: rw, height: rh, rx: 12, ry: 12, fill: colors[ci % colors.length], stroke: 'rgba(88,166,255,0.12)', 'stroke-width': 1 });
      this._g.appendChild(rect);
      const lbl = svgEl('text', { x: rx + 8, y: ry + 14, 'font-size': 9, fill: 'rgba(139,148,158,0.6)', 'pointer-events': 'none' });
      lbl.textContent = sub;
      this._g.appendChild(lbl);
      ci++;
    }
  }

  _renderHeatmap(nodes, neighborCounts) {
    for (const n of nodes) {
      const nc = neighborCounts.get(n.id) ?? 0;
      if (nc < 3) continue;
      const alpha = Math.min(0.35, 0.06 * nc);
      const gId = `hg-${n.id.replace(/\./g, '-')}`;
      const grad = svgEl('radialGradient', { id: gId, cx: '50%', cy: '50%', r: '50%' });
      const s1 = svgEl('stop', { offset: '0%', 'stop-color': `rgba(210,153,34,${alpha})` });
      const s2 = svgEl('stop', { offset: '100%', 'stop-color': 'rgba(210,153,34,0)' });
      grad.appendChild(s1); grad.appendChild(s2);
      this._defs.appendChild(grad);
      const r = Math.min(120, 40 + nc * 12);
      this._g.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r, fill: `url(#${gId})`, 'pointer-events': 'none' }));
    }
  }

  _setScale(newScale) {
    const rect = this._svg.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const r = newScale / this._transform.scale;
    this._transform = { scale: newScale, x: cx - (cx - this._transform.x) * r, y: cy - (cy - this._transform.y) * r };
    this._g.setAttribute('transform', `translate(${this._transform.x},${this._transform.y}) scale(${this._transform.scale})`);
    this._updateZoomBadge();
  }

  _updateZoomBadge() {
    this._zoomBadge.textContent = `${Math.round(this._transform.scale * 100)}%`;
  }

  _onBgMouseDown(e) {
    const el = e.target;
    if (el.tagName !== 'svg' && el.tagName !== 'rect') return;
    this._selectedId = null;
    this.render();
    this._drag = { type: 'pan', startMouseX: e.clientX, startMouseY: e.clientY, startPanX: this._transform.x, startPanY: this._transform.y, moved: false };
  }

  _startNodeDrag(e, node) {
    this._drag = { type: 'node', nodeId: node.id, startMouseX: e.clientX, startMouseY: e.clientY, startNodeX: node.x, startNodeY: node.y, moved: false };
  }

  _onMouseMove(e) {
    const d = this._drag;
    if (!d) return;
    const dx = e.clientX - d.startMouseX, dy = e.clientY - d.startMouseY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.moved = true;
    if (d.type === 'pan') {
      this._transform = { ...this._transform, x: d.startPanX + dx, y: d.startPanY + dy };
      this._g.setAttribute('transform', `translate(${this._transform.x},${this._transform.y}) scale(${this._transform.scale})`);
      this._updateZoomBadge();
    } else if (d.type === 'node') {
      const s = this._transform.scale;
      const nx = d.startNodeX + dx / s, ny = d.startNodeY + dy / s;
      this._graph = {
        ...this._graph,
        nodes: this._graph.nodes.map(n => n.id !== d.nodeId ? n : { ...n, x: nx, y: ny, fx: nx, fy: ny }),
      };
      this.render();
    }
  }

  _onMouseUp() { this._drag = null; }

  _onNodeMouseUp(e, node) {
    if (this._drag?.moved) { this._drag = null; return; }
    this._drag = null;
    if (e.shiftKey) {
      this.tracePathFrom(node.id);
      if (this._onSelect) this._onSelect(this.getSelected());
    } else {
      this._selectedId = this._selectedId === node.id ? null : node.id;
      this.render();
      if (this._onSelect) this._onSelect(this.getSelected());
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this._svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const d = e.deltaY > 0 ? 0.9 : 1.1;
    const ns = Math.max(0.3, Math.min(3.0, this._transform.scale * d));
    const r = ns / this._transform.scale;
    this._transform = { scale: ns, x: mx - (mx - this._transform.x) * r, y: my - (my - this._transform.y) * r };
    this._g.setAttribute('transform', `translate(${this._transform.x},${this._transform.y}) scale(${this._transform.scale})`);
    this._updateZoomBadge();
  }

  _updateVisible() {
    const all = new Set(this._graph.nodes.map(n => n.id));
    this._visibleSet = this._searchMatches ?? all; }
}
