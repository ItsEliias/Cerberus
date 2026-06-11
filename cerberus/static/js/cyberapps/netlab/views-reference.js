/**
 * static/js/cyberapps/netlab/views-reference.js
 * ReferenceView — command tables + flashcards. Ported from CyberOS NetLab.
 */

import { REFERENCE, FLASH_CARDS } from './data.js';

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function renderReferenceView(container) {
  const vendors = Object.keys(REFERENCE);
  let vendor = vendors[0];
  let category = null;
  let tab = 'commands';
  let search = '';

  function getCategories() {
    return Object.keys(REFERENCE[vendor] || {});
  }

  function init() {
    const cats = getCategories();
    category = cats[0] ?? null;
    render();
  }

  function render() {
    const cats = getCategories();
    if (!cats.includes(category)) category = cats[0] ?? null;
    const cmds = (category ? (REFERENCE[vendor][category] ?? []) : [])
      .filter(c => !search ||
        c.command.toLowerCase().includes(search) ||
        c.description.toLowerCase().includes(search));

    container.innerHTML = `
      <div class="nl-ref-layout">
        <!-- Left sidebar: vendor + category tree -->
        <div class="nl-ref-sidebar">
          <div class="nl-label" style="padding:12px 12px 6px;">Vendor</div>
          ${vendors.map(v => `
            <button class="nl-tree-item${vendor===v?' nl-tree-active':''}" data-vendor="${esc(v)}">${esc(v)}</button>
          `).join('')}
          <div class="nl-label" style="padding:12px 12px 6px;margin-top:8px;">Category</div>
          ${cats.map(c => `
            <button class="nl-tree-item${category===c?' nl-tree-active':''}" data-cat="${esc(c)}">${esc(c)}</button>
          `).join('')}
        </div>

        <!-- Right content -->
        <div class="nl-ref-content">
          <div class="nl-ref-toolbar">
            <div class="nl-tab-row">
              <button class="nl-tab${tab==='commands'?' nl-tab-active':''}" data-tab="commands">Command Table</button>
              <button class="nl-tab${tab==='flashcards'?' nl-tab-active':''}" data-tab="flashcards">Quick Cards</button>
            </div>
            ${tab === 'commands' ? `
              <input id="nl-ref-search" class="nl-input nl-input-sm" placeholder="Search commands..."
                value="${esc(search)}" style="max-width:220px;">` : ''}
          </div>

          ${tab === 'commands' ? `
            <div class="nl-ref-table-wrap">
              <h3 class="nl-ref-heading">${esc(vendor)} — ${esc(category || '')}
                <span class="nl-muted" style="font-size:11px;font-weight:400;"> (${cmds.length} commands)</span>
              </h3>
              ${cmds.length === 0 ? '<p class="nl-muted">No commands found.</p>' : `
                <table class="nl-table">
                  <thead>
                    <tr>
                      <th style="width:40%">Command</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${cmds.map(cmd => `
                      <tr>
                        <td><code class="nl-code-inline">${esc(cmd.command)}</code></td>
                        <td class="nl-muted-text">${esc(cmd.description)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>`}
            </div>` : `
            <div class="nl-cards-grid">
              <p class="nl-muted" style="margin-bottom:12px;grid-column:1/-1;">Click a card to flip it and reveal the answer.</p>
              ${FLASH_CARDS.map((card, i) => `
                <div class="nl-flash-card" data-card="${i}">
                  <span class="nl-flash-front">${esc(card.front)}</span>
                  <span class="nl-flash-back" style="display:none;">${esc(card.back)}</span>
                </div>
              `).join('')}
            </div>`}
        </div>
      </div>
    `;

    // Wire vendor/category
    container.querySelectorAll('[data-vendor]').forEach(btn => {
      btn.addEventListener('click', () => { vendor = btn.dataset.vendor; category = null; render(); });
    });
    container.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => { category = btn.dataset.cat; render(); });
    });
    container.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; render(); });
    });
    container.querySelector('#nl-ref-search')?.addEventListener('input', e => {
      search = e.target.value.toLowerCase();
      render();
    });
    // Flashcard flip
    container.querySelectorAll('.nl-flash-card').forEach(card => {
      card.addEventListener('click', () => {
        const front = card.querySelector('.nl-flash-front');
        const back = card.querySelector('.nl-flash-back');
        const flipped = back.style.display !== 'none';
        front.style.display = flipped ? '' : 'none';
        back.style.display = flipped ? 'none' : '';
      });
    });
  }

  init();

  return { destroy: () => {} };
}
