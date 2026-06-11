/**
 * toolbar.js — Graph canvas toolbar (port of GraphToolbar.tsx).
 * Layouts, export, filter, search, health score display.
 */

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.cls)  e.className = opts.cls;
  if (opts.text) e.textContent = opts.text;
  if (opts.html) e.innerHTML = opts.html;
  if (opts.style) Object.assign(e.style, opts.style);
  if (opts.title) e.title = opts.title;
  return e;
}

function toolBtn(text, title, opts = {}) {
  const b = el('button', { text, title });
  const active = opts.active ?? false;
  Object.assign(b.style, {
    padding: '5px 9px', fontSize: '11px', borderRadius: '7px', cursor: 'pointer',
    border: `1px solid ${active ? 'rgba(255,140,66,0.4)' : 'rgba(42,51,71,0.7)'}`,
    background: active ? 'rgba(255,140,66,0.12)' : 'rgba(10,10,15,0.8)',
    color: active ? '#ff8c42' : '#e2e8f0',
    transition: 'all 150ms',
    whiteSpace: 'nowrap',
  });
  b.addEventListener('mouseenter', () => {
    if (!b.dataset.active) { b.style.background = 'rgba(255,255,255,0.06)'; b.style.borderColor = 'rgba(42,51,71,1)'; }
  });
  b.addEventListener('mouseleave', () => {
    if (!b.dataset.active) { b.style.background = 'rgba(10,10,15,0.8)'; b.style.borderColor = 'rgba(42,51,71,0.7)'; }
  });
  return b;
}

function scoreColor(score) {
  if (score >= 80) return '#3fb950';
  if (score >= 50) return '#ff8c42';
  return '#f85149';
}

/** Builds the graph canvas toolbar. Returns { el, update(state) }. */
export function buildToolbar(callbacks) {
  const {
    onBack, onSave, onLayoutChange, onToggleSubnets, onToggleVulnOverlay,
    onToggleHeatmap, onToggleCompare, onToggleFilter, onSearchChange,
    onSearchEnter, onExport, onLayerChange,
  } = callbacks;

  const bar = el('div', { style: {
    minHeight: '48px', display: 'flex', alignItems: 'center', flexWrap: 'wrap',
    rowGap: '4px', gap: '6px', padding: '0 12px',
    background: 'rgba(7,8,15,0.98)',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    flexShrink: '0',
  }});

  // Back button
  const backBtn = toolBtn('← Back', 'Back to library');
  backBtn.addEventListener('click', onBack);
  bar.appendChild(backBtn);

  // Graph name
  const nameInput = el('input');
  Object.assign(nameInput.style, { background: 'transparent', border: 'none', color: '#e2e8f0', fontSize: '13px', fontWeight: '600', outline: 'none', minWidth: '100px', maxWidth: '200px', padding: '4px 6px', borderRadius: '4px' });
  nameInput.addEventListener('change', () => callbacks.onNameChange?.(nameInput.value));
  bar.appendChild(nameInput);

  // Separator
  bar.appendChild(el('div', { style: { width: '1px', height: '20px', background: 'rgba(42,51,71,0.7)' } }));

  // Layouts
  const layouts = [
    { mode: 'force', icon: '⊛', label: 'Force' },
    { mode: 'hierarchical', icon: '⊤', label: 'Tree' },
    { mode: 'circular', icon: '◯', label: 'Circle' },
    { mode: 'grid', icon: '⊞', label: 'Grid' },
  ];
  const layoutBtns = {};
  for (const { mode, icon, label } of layouts) {
    const b = toolBtn(icon, label);
    b.addEventListener('click', () => onLayoutChange(mode));
    layoutBtns[mode] = b;
    bar.appendChild(b);
  }

  bar.appendChild(el('div', { style: { width: '1px', height: '20px', background: 'rgba(42,51,71,0.7)' } }));

  // Toggle buttons
  const subnetBtn   = toolBtn('Subnets', 'Toggle subnet bubbles');
  const vulnBtn     = toolBtn('Vulns', 'Toggle vulnerability overlay');
  const heatmapBtn  = toolBtn('Heatmap', 'Toggle connection heatmap');
  const compareBtn  = toolBtn('Compare', 'Toggle scan comparison');
  const filterBtn   = toolBtn('Filter', 'Toggle filter panel');
  subnetBtn.addEventListener('click',  onToggleSubnets);
  vulnBtn.addEventListener('click',    onToggleVulnOverlay);
  heatmapBtn.addEventListener('click', onToggleHeatmap);
  compareBtn.addEventListener('click', onToggleCompare);
  filterBtn.addEventListener('click',  onToggleFilter);
  for (const b of [subnetBtn, vulnBtn, heatmapBtn, compareBtn, filterBtn]) bar.appendChild(b);

  bar.appendChild(el('div', { style: { width: '1px', height: '20px', background: 'rgba(42,51,71,0.7)' } }));

  // Layer mode
  const layerSelect = el('select');
  Object.assign(layerSelect.style, { background: '#0d0e18', border: '1px solid rgba(42,51,71,0.75)', borderRadius: '7px', padding: '4px 6px', color: '#8b949e', fontSize: '10px', outline: 'none', cursor: 'pointer' });
  [['all','All Layers'], ['2','L2'], ['3','L3'], ['4','L4']].forEach(([v,l]) => {
    const o = el('option', { text: l }); o.value = v; layerSelect.appendChild(o);
  });
  layerSelect.addEventListener('change', () => {
    const v = layerSelect.value === 'all' ? 'all' : parseInt(layerSelect.value, 10);
    onLayerChange(v);
  });
  bar.appendChild(layerSelect);

  // Search
  const searchInput = el('input');
  Object.assign(searchInput.style, { background: '#0d0e18', border: '1px solid rgba(42,51,71,0.75)', borderRadius: '7px', padding: '5px 10px', color: '#e2e8f0', fontSize: '11px', outline: 'none', width: '140px' });
  searchInput.placeholder = 'Search nodes…';
  searchInput.addEventListener('input', () => onSearchChange(searchInput.value));
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') onSearchEnter(); });
  bar.appendChild(searchInput);

  bar.appendChild(el('div', { style: { flex: '1' } }));

  // Health score badge
  const healthBadge = el('div', { style: { display: 'none', fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: '8px', border: '1px solid', whiteSpace: 'nowrap' } });
  bar.appendChild(healthBadge);

  // Node/edge count
  const countBadge = el('span', { style: { fontSize: '10px', color: '#8b949e', fontFamily: 'monospace', whiteSpace: 'nowrap' } });
  bar.appendChild(countBadge);

  // Save / export
  const saveMsg = el('span', { style: { fontSize: '10px', color: '#3fb950', display: 'none' } });
  bar.appendChild(saveMsg);

  const saveBtn = toolBtn('Save', 'Save graph');
  saveBtn.addEventListener('click', onSave);
  bar.appendChild(saveBtn);

  const exportBtn = toolBtn('Export ▾', 'Export graph');
  bar.appendChild(exportBtn);
  let exportOpen = false;
  const exportMenu = el('div', { style: { position: 'absolute', top: '44px', right: '12px', background: 'rgba(13,14,24,0.98)', border: '1px solid rgba(42,51,71,0.7)', borderRadius: '8px', zIndex: '100', display: 'none', flexDirection: 'column', minWidth: '120px', padding: '4px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' } });
  bar.style.position = 'relative';
  for (const fmt of ['SVG', 'PNG', 'JSON']) {
    const item = el('button', { text: fmt + ' file' });
    Object.assign(item.style, { padding: '7px 12px', fontSize: '12px', background: 'transparent', border: 'none', color: '#e2e8f0', cursor: 'pointer', textAlign: 'left', borderRadius: '5px', width: '100%' });
    item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.05)');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    item.addEventListener('click', () => { exportMenu.style.display = 'none'; exportOpen = false; onExport(fmt.toLowerCase()); });
    exportMenu.appendChild(item);
  }
  bar.appendChild(exportMenu);
  exportBtn.addEventListener('click', e => {
    e.stopPropagation();
    exportOpen = !exportOpen;
    exportMenu.style.display = exportOpen ? 'flex' : 'none';
  });
  document.addEventListener('click', () => { if (exportOpen) { exportOpen = false; exportMenu.style.display = 'none'; } });

  /** Update toolbar with current state */
  function update(state) {
    if (state.graphName != null) nameInput.value = state.graphName;
    if (state.nodeCount != null && state.edgeCount != null) {
      countBadge.textContent = `${state.nodeCount}n · ${state.edgeCount}e`;
    }
    if (state.healthScore != null) {
      const s = state.healthScore;
      healthBadge.style.display = 'inline-block';
      healthBadge.textContent = `Health: ${s.score}`;
      healthBadge.style.color = scoreColor(s.score);
      healthBadge.style.borderColor = scoreColor(s.score) + '40';
      healthBadge.style.background = scoreColor(s.score) + '10';
    }
    if (state.saveMsg != null) {
      saveMsg.textContent = state.saveMsg;
      saveMsg.style.display = state.saveMsg ? 'inline' : 'none';
    }

    // Active layout button
    for (const [m, b] of Object.entries(layoutBtns)) {
      const active = m === state.layoutMode;
      b.style.background    = active ? 'rgba(255,140,66,0.12)' : 'rgba(10,10,15,0.8)';
      b.style.color         = active ? '#ff8c42' : '#e2e8f0';
      b.style.borderColor   = active ? 'rgba(255,140,66,0.4)' : 'rgba(42,51,71,0.7)';
      b.dataset.active      = active ? '1' : '';
    }

    // Toggle button states
    const toggles = {
      subnet:     [subnetBtn,  state.showSubnets],
      vuln:       [vulnBtn,    state.showVulnOverlay],
      heatmap:    [heatmapBtn, state.showHeatmap],
      compare:    [compareBtn, state.compareMode],
      filter:     [filterBtn,  state.filterOpen],
    };
    for (const [, [b, active]] of Object.entries(toggles)) {
      if (active == null) continue;
      b.style.background  = active ? 'rgba(255,140,66,0.12)' : 'rgba(10,10,15,0.8)';
      b.style.color       = active ? '#ff8c42' : '#e2e8f0';
      b.style.borderColor = active ? 'rgba(255,140,66,0.4)' : 'rgba(42,51,71,0.7)';
      b.dataset.active    = active ? '1' : '';
    }

    if (state.filterCount != null && state.filterCount > 0) {
      filterBtn.textContent = `Filter (${state.filterCount})`;
    } else {
      filterBtn.textContent = 'Filter';
    }
  }

  return { el: bar, update };
}
