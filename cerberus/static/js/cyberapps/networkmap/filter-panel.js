/**
 * filter-panel.js — Port of FilterPanel.tsx.
 * Floating filter sidebar for the graph canvas view.
 */

export const EMPTY_FILTERS = { osType: '', openPort: '' };

export function applyFilters(nodes, filters) {
  const ids = new Set();
  for (const n of nodes) {
    let pass = true;
    if (filters.osType) {
      const l = (n.os ?? '').toLowerCase();
      if (filters.osType === 'windows' && !l.includes('windows')) pass = false;
      else if (filters.osType === 'linux' && !l.includes('linux') && !l.includes('ubuntu') && !l.includes('debian')) pass = false;
      else if (filters.osType === 'macos' && !l.includes('mac') && !l.includes('osx') && !l.includes('darwin')) pass = false;
      else if (filters.osType === 'router' && !l.includes('cisco') && !l.includes('router') && !l.includes('juniper')) pass = false;
      else if (filters.osType === 'unknown' && n.os) pass = false;
    }
    if (pass && filters.openPort) {
      const port = parseInt(filters.openPort, 10);
      if (!isNaN(port) && !n.ports.some(p => p.state === 'open' && p.port === port)) pass = false;
    }
    if (pass) ids.add(n.id);
  }
  return ids;
}

export function activeFilterCount(f) {
  return [f.osType, f.openPort].filter(Boolean).length;
}

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.cls)  e.className = opts.cls;
  if (opts.text) e.textContent = opts.text;
  if (opts.html) e.innerHTML = opts.html;
  if (opts.style) Object.assign(e.style, opts.style);
  return e;
}

/**
 * Build a floating filter panel DOM element.
 * @param {{ nodes: [], filters: {}, onChange: fn, onClose: fn }} opts
 * @returns {HTMLElement}
 */
export function buildFilterPanel({ nodes, filters, onChange, onClose }) {
  const panel = el('div', { style: {
    position: 'absolute', top: '60px', left: '200px',
    background: 'rgba(13,14,24,0.97)', border: '1px solid rgba(42,51,71,0.7)',
    borderRadius: '10px', zIndex: '40', minWidth: '240px', maxWidth: '280px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)', padding: '14px 16px',
  }});

  // Header
  const hdr = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } });
  hdr.appendChild(el('span', { text: 'FILTERS', style: { fontSize: '9px', fontWeight: '700', color: '#8b949e', letterSpacing: '0.08em' } }));
  const closeBtn = el('button', { text: '×', style: { background: 'transparent', border: 'none', color: '#8b949e', fontSize: '16px', cursor: 'pointer', padding: '0 4px' } });
  closeBtn.addEventListener('click', onClose);
  hdr.appendChild(closeBtn);
  panel.appendChild(hdr);

  // OS filter
  panel.appendChild(el('div', { text: 'OS Type', style: { fontSize: '10px', color: '#8b949e', marginBottom: '4px', fontWeight: '600' } }));
  const osSelect = el('select');
  Object.assign(osSelect.style, { width: '100%', background: '#0d0e18', border: '1px solid rgba(42,51,71,0.75)', borderRadius: '6px', padding: '6px 8px', color: '#e2e8f0', fontSize: '11px', outline: 'none', marginBottom: '10px' });
  [['', 'Any OS'], ['windows','Windows'], ['linux','Linux'], ['macos','macOS'], ['router','Router/Network'], ['unknown','Unknown']].forEach(([v,l]) => {
    const o = el('option', { text: l }); o.value = v;
    if (v === filters.osType) o.selected = true;
    osSelect.appendChild(o);
  });
  osSelect.addEventListener('change', () => onChange({ ...filters, osType: osSelect.value }));
  panel.appendChild(osSelect);

  // Port filter
  panel.appendChild(el('div', { text: 'Open Port', style: { fontSize: '10px', color: '#8b949e', marginBottom: '4px', fontWeight: '600' } }));
  const portInput = el('input');
  Object.assign(portInput, { type: 'text', placeholder: 'e.g. 80, 443, 22' });
  Object.assign(portInput.style, { width: '100%', background: '#0d0e18', border: '1px solid rgba(42,51,71,0.75)', borderRadius: '6px', padding: '6px 8px', color: '#e2e8f0', fontSize: '11px', outline: 'none', marginBottom: '12px', boxSizing: 'border-box' });
  portInput.value = filters.openPort;
  portInput.addEventListener('input', () => onChange({ ...filters, openPort: portInput.value }));
  panel.appendChild(portInput);

  // Stats
  const allMatching = applyFilters(nodes, filters);
  panel.appendChild(el('div', { text: `${allMatching.size} / ${nodes.length} hosts match`, style: { fontSize: '10px', color: '#8b949e', marginBottom: '8px' } }));

  // Clear all
  const clearBtn = el('button', { text: 'Clear All Filters' });
  Object.assign(clearBtn.style, { width: '100%', padding: '6px', borderRadius: '7px', background: 'transparent', border: '1px solid rgba(42,51,71,0.7)', color: '#8b949e', fontSize: '11px', cursor: 'pointer', transition: 'all 150ms' });
  clearBtn.addEventListener('click', () => onChange({ ...EMPTY_FILTERS }));
  clearBtn.addEventListener('mouseenter', () => { clearBtn.style.background = 'rgba(255,255,255,0.04)'; clearBtn.style.color = '#e2e8f0'; });
  clearBtn.addEventListener('mouseleave', () => { clearBtn.style.background = 'transparent'; clearBtn.style.color = '#8b949e'; });
  panel.appendChild(clearBtn);

  return panel;
}
