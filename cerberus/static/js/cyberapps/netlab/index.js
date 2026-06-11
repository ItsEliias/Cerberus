/**
 * static/js/cyberapps/netlab/index.js
 * NetLab — Cerberus native app entry point.
 * Packet/protocol playground: lab exercises, reference, topology builder,
 * command snippets, and progress tracking.
 *
 * Self-registers with window.CYBER_APPS_REGISTRY.
 */

import * as State from './state.js';
import { BUILTIN_LABS, BUILTIN_SNIPPETS } from './data.js';
import { renderLabsView, renderLabStepView } from './views-labs.js';
import { renderReferenceView } from './views-reference.js';
import { renderTopologyView } from './views-topology.js';
import { renderSnippetsView } from './views-snippets.js';
import { renderProgressView } from './views-progress.js';
import { renderSettingsView } from './views-settings.js';

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------
(function injectCSS() {
  if (document.querySelector('[data-netlab-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/static/js/cyberapps/netlab/netlab.css';
  link.dataset.netlabCss = '1';
  document.head.appendChild(link);
})();

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------
const NAV_ITEMS = [
  { id:'labs',      label:'Labs',       icon:'◈' },
  { id:'reference', label:'Reference',  icon:'⊟' },
  { id:'topology',  label:'Topology',   icon:'⊕' },
  { id:'snippets',  label:'Snippets',   icon:'⊞' },
  { id:'progress',  label:'Progress',   icon:'◎' },
  { id:'settings',  label:'Settings',   icon:'⚙' },
];

// ---------------------------------------------------------------------------
// API bootstrap
// ---------------------------------------------------------------------------
async function _bootstrap() {
  // Load custom labs
  try {
    const res = await fetch('/api/cyberapps/netlab/labs');
    const { labs: custom } = await res.json();
    const builtinIds = new Set(BUILTIN_LABS.map(l => l.id));
    const merged = [...BUILTIN_LABS, ...custom.filter(l => !builtinIds.has(l.id))];
    State.setLabs(merged);
  } catch {
    State.setLabs(BUILTIN_LABS);
  }

  // Load progress
  try {
    const res = await fetch('/api/cyberapps/netlab/progress');
    const { progress } = await res.json();
    State.setProgress(progress || {});
  } catch { /* ignore */ }

  // Load custom snippets
  try {
    const res = await fetch('/api/cyberapps/netlab/snippets');
    const { snippets: custom } = await res.json();
    const builtinIds = new Set(BUILTIN_SNIPPETS.map(s => s.id));
    const merged = [...BUILTIN_SNIPPETS, ...custom.filter(s => !builtinIds.has(s.id))];
    State.setSnippets(merged);
  } catch {
    State.setSnippets(BUILTIN_SNIPPETS);
  }

  // Load topologies
  try {
    const res = await fetch('/api/cyberapps/netlab/topologies');
    const { topologies } = await res.json();
    State.setTopologies(topologies || []);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// View router
// ---------------------------------------------------------------------------
let _activeViewComp = null;

function _mountView(viewId, contentEl) {
  if (_activeViewComp?.destroy) _activeViewComp.destroy();
  _activeViewComp = null;
  contentEl.innerHTML = '';

  switch (viewId) {
    case 'labs':      _activeViewComp = renderLabsView(contentEl); break;
    case 'reference': _activeViewComp = renderReferenceView(contentEl); break;
    case 'topology':  _activeViewComp = renderTopologyView(contentEl); break;
    case 'snippets':  _activeViewComp = renderSnippetsView(contentEl); break;
    case 'progress':  _activeViewComp = renderProgressView(contentEl); break;
    case 'settings':  _activeViewComp = renderSettingsView(contentEl); break;
    default: contentEl.textContent = 'Unknown view.';
  }
}

// ---------------------------------------------------------------------------
// App shell render
// ---------------------------------------------------------------------------
function _renderShell(container) {
  container.innerHTML = `
    <div style="display:flex;height:100%;overflow:hidden;background:#0a0a0f;">
      <!-- Sidebar nav -->
      <div class="nl-sidebar" id="nl-nav">
        ${NAV_ITEMS.map(n => `
          <button class="nl-nav-btn" data-view="${n.id}">
            <span class="nl-nav-icon">${n.icon}</span>
            ${n.label}
          </button>
        `).join('')}
      </div>
      <!-- Main content -->
      <div id="nl-main" style="flex:1;overflow:hidden;display:flex;flex-direction:column;"></div>
    </div>
  `;

  const mainEl = container.querySelector('#nl-main');
  const navEl  = container.querySelector('#nl-nav');

  function activateView(id) {
    State.setActiveView(id);
    navEl.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('nl-nav-active', btn.dataset.view === id);
    });
    _mountView(id, mainEl);
  }

  navEl.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      // If inside a lab, clicking Labs nav exits the lab
      if (btn.dataset.view === 'labs' && State.get('activeLab')) {
        State.setActiveLab(null);
        State.clearLabTimer();
      }
      activateView(btn.dataset.view);
    });
  });

  // React to activeLab change — swap between LabsView and LabStepView
  State.subscribe('activeLab', lab => {
    if (State.get('activeView') !== 'labs') return;
    if (lab) {
      if (_activeViewComp?.destroy) _activeViewComp.destroy();
      mainEl.innerHTML = '';
      _activeViewComp = renderLabStepView(mainEl);
    } else {
      _mountView('labs', mainEl);
    }
    navEl.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('nl-nav-active', btn.dataset.view === 'labs');
    });
  });

  // Restore last view (default: labs)
  const startView = State.get('activeView') || 'labs';
  activateView(startView);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
let _bootstrapped = false;

function init(container, _ctx) {
  container.style.height = '100%';
  container.style.overflow = 'hidden';

  _renderShell(container);

  if (!_bootstrapped) {
    _bootstrapped = true;
    _bootstrap();
  }
}

function destroy() {
  if (_activeViewComp?.destroy) _activeViewComp.destroy();
  _activeViewComp = null;
  // Reset active lab on destroy so re-open starts fresh
  State.setActiveLab(null);
  State.clearLabTimer();
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------
if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id: 'netlab',
    name: 'NetLab',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="7" height="5" rx="1"/><rect x="15" y="3" width="7" height="5" rx="1"/><rect x="2" y="16" width="7" height="5" rx="1"/><rect x="15" y="16" width="7" height="5" rx="1"/><path d="M9 5.5h6M9 18.5h6M5.5 8v8M18.5 8v8"/></svg>',
    init,
    destroy,
    vault: false,
  });
}
