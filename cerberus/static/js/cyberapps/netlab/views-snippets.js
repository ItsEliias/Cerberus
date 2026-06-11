/**
 * static/js/cyberapps/netlab/views-snippets.js
 * SnippetsView — command snippet library. Ported from CyberOS NetLab.
 */

import * as State from './state.js';
import { BUILTIN_SNIPPETS } from './data.js';

const CATEGORIES = ['Cisco Routing','Cisco Switching','ACL','NAT','Linux Networking','FortiGate','Verification'];

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function mergeSnippets(custom) {
  const builtinIds = new Set(BUILTIN_SNIPPETS.map(s => s.id));
  return [...BUILTIN_SNIPPETS, ...custom.filter(s => !builtinIds.has(s.id))];
}

async function persistCustom(snippets) {
  const custom = snippets.filter(s => s.id.startsWith('custom-'));
  try {
    await fetch('/api/cyberapps/netlab/snippets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(custom),
    });
  } catch { /* best-effort */ }
}

export function renderSnippetsView(container) {
  let category = 'All';
  let search = '';
  let showAdd = false;
  let addTitle = '';
  let addCommand = '';
  let addCategory = 'Verification';
  let addDesc = '';

  function filtered() {
    return State.get('snippets').filter(s => {
      const mc = category === 'All' || s.category === category;
      const ms = !search || s.title.toLowerCase().includes(search) ||
        s.command.toLowerCase().includes(search);
      return mc && ms;
    });
  }

  function addSnippet() {
    if (!addTitle.trim() || !addCommand.trim()) return;
    const s = {
      id: `custom-${Date.now()}`,
      title: addTitle.trim(),
      command: addCommand.trim(),
      category: addCategory,
      description: addDesc.trim() || undefined,
    };
    const next = [...State.get('snippets'), s];
    State.setSnippets(next);
    persistCustom(next);
    addTitle = ''; addCommand = ''; addDesc = ''; showAdd = false;
    render();
  }

  function deleteSnippet(id) {
    const next = State.get('snippets').filter(s => s.id !== id);
    State.setSnippets(next);
    persistCustom(next);
    render();
  }

  async function copyCmd(command) {
    try { await navigator.clipboard.writeText(command); return true; } catch { return false; }
  }

  function render() {
    const snips = filtered();
    container.innerHTML = `
      <div class="nl-snip-layout">
        <!-- Toolbar -->
        <div class="nl-snip-toolbar">
          <input id="nl-snip-search" class="nl-input nl-input-sm" placeholder="Search snippets..."
            value="${esc(search)}" style="width:200px;">
          <div class="nl-cat-pills" style="flex:1;">
            ${(['All', ...CATEGORIES]).map(c =>
              `<button class="nl-pill${category===c?' nl-pill-active':''}" data-cat="${esc(c)}">${esc(c)}</button>`
            ).join('')}
          </div>
          <button id="nl-snip-add-btn" class="nl-btn-outline"${showAdd?' style="background:rgba(94,196,255,0.1)"':''}>+ Add Snippet</button>
        </div>

        <!-- Add form -->
        ${showAdd ? `
          <div class="nl-add-form">
            <p class="nl-label" style="margin-bottom:8px;">Add Custom Snippet</p>
            <input id="nl-add-title" class="nl-input" placeholder="Title" value="${esc(addTitle)}" style="margin-bottom:4px;">
            <textarea id="nl-add-command" class="nl-textarea nl-mono" rows="3"
              placeholder="Command(s)" style="margin-bottom:4px;">${esc(addCommand)}</textarea>
            <select id="nl-add-cat" class="nl-select" style="margin-bottom:4px;">
              ${CATEGORIES.map(c => `<option value="${esc(c)}"${addCategory===c?' selected':''}>${esc(c)}</option>`).join('')}
            </select>
            <input id="nl-add-desc" class="nl-input" placeholder="Description (optional)"
              value="${esc(addDesc)}" style="margin-bottom:8px;">
            <div style="display:flex;gap:6px;">
              <button id="nl-add-submit" class="nl-btn-primary" style="flex:1;">Add Snippet</button>
              <button id="nl-add-cancel" class="nl-btn-secondary">Cancel</button>
            </div>
          </div>` : ''}

        <!-- Snippet grid -->
        <div class="nl-snip-grid">
          ${snips.map(s => {
            const isCustom = s.id.startsWith('custom-');
            return `
              <div class="nl-snip-card">
                <div class="nl-snip-card-header">
                  <span class="nl-snip-title">${esc(s.title)}</span>
                  <div style="display:flex;gap:4px;align-items:center;">
                    ${isCustom ? `<button class="nl-btn-sm nl-danger-hover" data-del="${esc(s.id)}">✕</button>` : ''}
                    <button class="nl-btn-sm" data-copy="${esc(s.id)}">Copy</button>
                  </div>
                </div>
                <pre class="nl-snip-pre">${esc(s.command)}</pre>
                ${s.description ? `<p class="nl-muted" style="font-size:11px;margin-top:4px;">${esc(s.description)}</p>` : ''}
                ${s.variables?.length ? `
                  <div class="nl-snip-vars">
                    ${s.variables.map(v => `<span class="nl-var-badge">${esc(v)}</span>`).join('')}
                  </div>` : ''}
              </div>
            `;
          }).join('')}
          ${snips.length === 0 ? '<p class="nl-muted">No snippets match your filters.</p>' : ''}
        </div>
      </div>
    `;

    // Wire search + cats
    container.querySelector('#nl-snip-search')?.addEventListener('input', e => {
      search = e.target.value.toLowerCase();
      render();
    });
    container.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => { category = btn.dataset.cat; render(); });
    });
    container.querySelector('#nl-snip-add-btn')?.addEventListener('click', () => {
      showAdd = !showAdd;
      render();
    });

    // Add form
    if (showAdd) {
      container.querySelector('#nl-add-title')?.addEventListener('input', e => { addTitle = e.target.value; });
      container.querySelector('#nl-add-command')?.addEventListener('input', e => { addCommand = e.target.value; });
      container.querySelector('#nl-add-cat')?.addEventListener('change', e => { addCategory = e.target.value; });
      container.querySelector('#nl-add-desc')?.addEventListener('input', e => { addDesc = e.target.value; });
      container.querySelector('#nl-add-submit')?.addEventListener('click', addSnippet);
      container.querySelector('#nl-add-cancel')?.addEventListener('click', () => { showAdd = false; render(); });
    }

    // Copy + delete buttons
    container.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const snip = State.get('snippets').find(s => s.id === btn.dataset.copy);
        if (!snip) return;
        const ok = await copyCmd(snip.command);
        if (ok) {
          btn.textContent = 'Copied!';
          btn.style.color = '#3fb950';
          setTimeout(() => { btn.textContent = 'Copy'; btn.style.color = ''; }, 1500);
        }
      });
    });
    container.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => deleteSnippet(btn.dataset.del));
    });
  }

  const unsub = State.subscribe('snippets', () => render());
  render();

  return { destroy: () => unsub() };
}
