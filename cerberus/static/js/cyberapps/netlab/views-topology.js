/**
 * static/js/cyberapps/netlab/views-topology.js
 * TopologyView — SVG drag-and-drop network diagram. Ported from CyberOS NetLab.
 */

import * as State from './state.js';

const DEVICE_ICONS = { router:'R', switch:'SW', firewall:'FW', pc:'PC', cloud:'CL', server:'SRV' };
const DEVICE_COLORS = { router:'#5ec4ff', switch:'#3fb950', firewall:'#f85149', pc:'#8b949e', cloud:'#d29922', server:'#b44fff' };
const DEVICE_TYPES = ['router','switch','firewall','pc','cloud','server'];

function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }
function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

export function renderTopologyView(container) {
  let nodes = [];
  let links = [];
  let topoName = 'Untitled Topology';
  let selectedNodeId = null;
  let linkStart = null;
  let placingType = null;
  let draggingId = null;
  let dragOffset = { x: 0, y: 0 };

  // Load active topology
  const activeTopology = State.get('topologies').find(t => t.id === State.get('activeTopology')?.id)
    ?? State.get('topologies')[0] ?? null;
  if (activeTopology) {
    nodes = activeTopology.nodes.map(n => ({ ...n }));
    links = activeTopology.links.map(l => ({ ...l }));
    topoName = activeTopology.name;
  }

  function save() {
    const topo = { id: activeTopology?.id ?? genId(), name: topoName, nodes, links };
    const all = State.get('topologies');
    const idx = all.findIndex(t => t.id === topo.id);
    const next = idx >= 0 ? all.map((t, i) => i === idx ? topo : t) : [...all, topo];
    State.setTopologies(next);
    fetch('/api/cyberapps/netlab/topologies', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ topologies: next }),
    }).catch(() => {});
    renderMain();
  }

  function renderSvg(svg) {
    svg.innerHTML = '';
    // Links
    links.forEach(link => {
      const src = nodes.find(n => n.id === link.sourceId);
      const tgt = nodes.find(n => n.id === link.targetId);
      if (!src || !tgt) return;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', src.x); line.setAttribute('y1', src.y);
      line.setAttribute('x2', tgt.x); line.setAttribute('y2', tgt.y);
      line.setAttribute('stroke', '#2a3347'); line.setAttribute('stroke-width', '2');
      svg.appendChild(line);
    });
    // Nodes
    nodes.forEach(node => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${node.x},${node.y})`);
      g.dataset.nodeid = node.id;
      g.style.cursor = draggingId === node.id ? 'grabbing' : 'grab';

      const isSelected = node.id === selectedNodeId;
      const color = isSelected ? '#5ec4ff' : DEVICE_COLORS[node.type] || '#8b949e';

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '22');
      circle.setAttribute('fill', isSelected ? 'rgba(94,196,255,0.15)' : '#161b27');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', isSelected ? '2' : '1.5');
      g.appendChild(circle);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('fill', color);
      text.setAttribute('font-size', '10');
      text.setAttribute('font-family', 'JetBrains Mono, monospace');
      text.textContent = DEVICE_ICONS[node.type] || '?';
      g.appendChild(text);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('y', '34');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#e6edf3');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-family', 'JetBrains Mono, monospace');
      label.textContent = node.label;
      g.appendChild(label);

      if (node.interfaces[0]?.ip) {
        const ipText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        ipText.setAttribute('y', '46');
        ipText.setAttribute('text-anchor', 'middle');
        ipText.setAttribute('fill', '#5ec4ff');
        ipText.setAttribute('font-size', '9');
        ipText.textContent = node.interfaces[0].ip;
        g.appendChild(ipText);
      }

      g.addEventListener('click', e => {
        e.stopPropagation();
        if (linkStart) {
          if (linkStart !== node.id) {
            links.push({ id: genId(), sourceId: linkStart, targetId: node.id });
            renderSvg(svg);
            renderPanel();
          }
          linkStart = null;
          renderMain();
        } else {
          selectedNodeId = node.id;
          renderPanel();
          renderSvg(svg);
        }
      });
      g.addEventListener('mousedown', e => {
        e.stopPropagation();
        if (linkStart) return;
        draggingId = node.id;
        const svgRect = svg.getBoundingClientRect();
        dragOffset = { x: e.clientX - svgRect.left - node.x, y: e.clientY - svgRect.top - node.y };
      });

      svg.appendChild(g);
    });
  }

  function renderPanel() {
    const panel = container.querySelector('#nl-topo-panel');
    if (!panel) return;
    const saved = State.get('topologies');
    const selNode = nodes.find(n => n.id === selectedNodeId);
    panel.innerHTML = `
      <div class="nl-topo-panel-inner">
        <input id="nl-topo-name" class="nl-input" value="${esc(topoName)}" style="margin-bottom:6px;">
        <div style="display:flex;gap:6px;">
          <button id="nl-topo-save" class="nl-btn-primary" style="flex:1;font-size:12px;">Save</button>
        </div>
      </div>
      ${selNode ? `
        <div class="nl-topo-panel-inner" style="margin-top:8px;">
          <div class="nl-label" style="margin-bottom:6px;">Device Config</div>
          <button id="nl-del-node" class="nl-btn-ghost" style="color:#f85149;font-size:11px;float:right;">Delete</button>
          <label class="nl-label">Hostname</label>
          <input id="nl-node-label" class="nl-input" value="${esc(selNode.label)}" style="margin-bottom:4px;">
          <label class="nl-label">Interface</label>
          <input id="nl-node-iface" class="nl-input" placeholder="Gi0/0"
            value="${esc(selNode.interfaces[0]?.name ?? '')}" style="margin-bottom:4px;">
          <label class="nl-label">IP Address</label>
          <input id="nl-node-ip" class="nl-input nl-mono" placeholder="10.0.0.1"
            value="${esc(selNode.interfaces[0]?.ip ?? '')}" style="margin-bottom:4px;">
          <label class="nl-label">Config</label>
          <textarea id="nl-node-config" class="nl-textarea" rows="4" placeholder="IOS config snippet..."
            style="font-family:monospace;font-size:11px;">${esc(selNode.config ?? '')}</textarea>
          <button id="nl-draw-link" class="nl-btn-secondary" style="margin-top:4px;width:100%;font-size:11px;">
            ${linkStart === selNode.id ? 'Click target...' : 'Draw link from here'}
          </button>
        </div>
      ` : (saved.length > 0 ? `
        <div class="nl-topo-panel-inner" style="margin-top:8px;">
          <div class="nl-label" style="margin-bottom:6px;">Saved Topologies</div>
          ${saved.map(t => `<button class="nl-tree-item" data-topoid="${esc(t.id)}">${esc(t.name)}</button>`).join('')}
        </div>` : '')}
    `;

    panel.querySelector('#nl-topo-name')?.addEventListener('input', e => { topoName = e.target.value; });
    panel.querySelector('#nl-topo-save')?.addEventListener('click', save);
    panel.querySelector('#nl-del-node')?.addEventListener('click', () => {
      nodes = nodes.filter(n => n.id !== selectedNodeId);
      links = links.filter(l => l.sourceId !== selectedNodeId && l.targetId !== selectedNodeId);
      selectedNodeId = null;
      const svg = container.querySelector('#nl-topo-svg');
      if (svg) renderSvg(svg);
      renderPanel();
    });
    if (selNode) {
      panel.querySelector('#nl-node-label')?.addEventListener('input', e => {
        nodes = nodes.map(n => n.id === selNode.id ? { ...n, label: e.target.value } : n);
        const svg = container.querySelector('#nl-topo-svg');
        if (svg) renderSvg(svg);
      });
      panel.querySelector('#nl-node-iface')?.addEventListener('input', e => {
        nodes = nodes.map(n => n.id === selNode.id ? { ...n, interfaces: [{ ...n.interfaces[0], name: e.target.value }] } : n);
      });
      panel.querySelector('#nl-node-ip')?.addEventListener('input', e => {
        nodes = nodes.map(n => n.id === selNode.id ? { ...n, interfaces: [{ ...n.interfaces[0], ip: e.target.value }] } : n);
        const svg = container.querySelector('#nl-topo-svg');
        if (svg) renderSvg(svg);
      });
      panel.querySelector('#nl-node-config')?.addEventListener('input', e => {
        nodes = nodes.map(n => n.id === selNode.id ? { ...n, config: e.target.value } : n);
      });
      panel.querySelector('#nl-draw-link')?.addEventListener('click', () => {
        linkStart = linkStart === selNode.id ? null : selNode.id;
        renderMain();
      });
    }
    panel.querySelectorAll('[data-topoid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = State.get('topologies').find(x => x.id === btn.dataset.topoid);
        if (t) { nodes = t.nodes.map(n => ({ ...n })); links = t.links.map(l => ({ ...l })); topoName = t.name; renderMain(); }
      });
    });
  }

  function renderMain() {
    container.innerHTML = `
      <div class="nl-topo-layout">
        <!-- Device toolbar -->
        <div class="nl-topo-toolbar">
          ${DEVICE_TYPES.map(t => `
            <button class="nl-device-btn${placingType===t?' nl-device-btn-active':''}" data-place="${t}"
              title="${t}">${DEVICE_ICONS[t]}</button>`).join('')}
          <div style="flex:1;"></div>
          <button class="nl-device-btn${linkStart!==null?' nl-device-btn-active':''}" id="nl-link-mode" title="Draw Link">─</button>
        </div>

        <!-- SVG canvas -->
        <div class="nl-svg-wrap" style="position:relative;flex:1;overflow:hidden;">
          ${placingType ? `<div class="nl-canvas-tip">Click canvas to place ${placingType}</div>` : ''}
          ${linkStart ? `<div class="nl-canvas-tip">Click source device, then target</div>` : ''}
          <svg id="nl-topo-svg" class="nl-svg" style="width:100%;height:100%;background:#0a0a0f;cursor:crosshair;"></svg>
        </div>

        <!-- Right config panel -->
        <div id="nl-topo-panel" class="nl-topo-right-panel"></div>
      </div>
    `;

    const svg = container.querySelector('#nl-topo-svg');
    renderSvg(svg);
    renderPanel();

    // Device toolbar
    container.querySelectorAll('[data-place]').forEach(btn => {
      btn.addEventListener('click', () => {
        placingType = placingType === btn.dataset.place ? null : btn.dataset.place;
        renderMain();
      });
    });
    container.querySelector('#nl-link-mode')?.addEventListener('click', () => {
      linkStart = linkStart !== null ? null : 'pending';
      renderMain();
    });

    // SVG click to place
    svg.addEventListener('click', e => {
      if (e.target !== svg) return;
      if (placingType) {
        const rect = svg.getBoundingClientRect();
        nodes.push({ id: genId(), type: placingType, label: placingType, x: e.clientX - rect.left, y: e.clientY - rect.top, interfaces: [] });
        placingType = null;
        renderSvg(svg);
        renderPanel();
      } else {
        selectedNodeId = null;
        linkStart = null;
        renderPanel();
        renderSvg(svg);
      }
    });

    // Drag
    svg.addEventListener('mousemove', e => {
      if (!draggingId) return;
      const rect = svg.getBoundingClientRect();
      nodes = nodes.map(n => n.id === draggingId
        ? { ...n, x: e.clientX - rect.left - dragOffset.x, y: e.clientY - rect.top - dragOffset.y }
        : n);
      renderSvg(svg);
    });
    svg.addEventListener('mouseup', () => { draggingId = null; });
  }

  renderMain();

  return { destroy: () => {} };
}
