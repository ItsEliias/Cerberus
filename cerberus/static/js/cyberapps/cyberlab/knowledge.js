/**
 * knowledge.js — Knowledge Base panel for CyberLab.
 *
 * Features: CRUD entries (title, content, tags, linked_lab_id),
 *           inline search modal, auto-surface for active lab tags.
 */

const API = '';

export async function renderKnowledge(container, ctx) {
  container.innerHTML = '<div class="cl-empty">Loading knowledge base…</div>';
  let entries = [];
  let labs = [];
  try {
    const [kRes, lRes] = await Promise.all([
      fetch(`${API}/api/cyberlab/knowledge`),
      fetch(`${API}/api/cyberlab/labs`),
    ]);
    entries = await kRes.json();
    labs = await lRes.json();
  } catch { container.innerHTML = '<div class="cl-error">Failed to load knowledge base.</div>'; return; }

  let showForm = false;
  let editingId = null;
  let searchQ = '';

  function render() {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'cl-section-header';
    header.innerHTML = `<span class="cl-section-title">Knowledge Base</span><button class="cl-btn cl-btn-primary" id="cl-kb-new">+ New Entry</button>`;
    container.appendChild(header);

    // Search bar
    const searchRow = document.createElement('div');
    searchRow.style.marginBottom = '10px';
    searchRow.innerHTML = `<input class="cl-input" id="cl-kb-search" placeholder="Search entries…" value="${_esc(searchQ)}">`;
    container.appendChild(searchRow);
    searchRow.querySelector('#cl-kb-search').addEventListener('input', e => { searchQ = e.target.value; render(); });

    header.querySelector('#cl-kb-new').addEventListener('click', () => { showForm = true; editingId = null; render(); });

    // Auto-surfaced entries for active lab
    if (ctx.activeLab && ctx.activeLab.name && !searchQ) {
      const surfaced = _autoSurface(entries, ctx.activeLab);
      if (surfaced.length > 0) {
        const surfaceDiv = document.createElement('div');
        surfaceDiv.style.cssText = 'background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.2);border-radius:6px;padding:8px 10px;margin-bottom:10px;';
        surfaceDiv.innerHTML = `<div style="font-size:11px;opacity:.7;margin-bottom:6px;">Related to ${_esc(ctx.activeLab.name)}:</div>` +
          surfaced.map(e => `<div style="font-size:12px;padding:2px 0;"><strong>${_esc(e.title)}</strong> — ${_esc(e.content.slice(0,80))}${e.content.length>80?'…':''}</div>`).join('');
        container.appendChild(surfaceDiv);
      }
    }

    if (showForm) container.appendChild(_kbForm(
      editingId ? entries.find(e => e.id === editingId) : null,
      labs,
      async (data) => {
        if (editingId) {
          await fetch(`${API}/api/cyberlab/knowledge/${editingId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
          const idx = entries.findIndex(e => e.id === editingId);
          if (idx >= 0) entries[idx] = { ...entries[idx], ...data, updated_at: new Date().toISOString() };
        } else {
          const res = await fetch(`${API}/api/cyberlab/knowledge`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
          entries.unshift(await res.json());
        }
        showForm = false; editingId = null; render();
      },
      () => { showForm = false; editingId = null; render(); }
    ));

    let filtered = entries;
    if (searchQ) {
      const ql = searchQ.toLowerCase();
      filtered = entries.filter(e => e.title.toLowerCase().includes(ql) || e.content.toLowerCase().includes(ql) || (e.tags||[]).some(t=>t.toLowerCase().includes(ql)));
    }

    if (filtered.length === 0 && !showForm) {
      container.appendChild(Object.assign(document.createElement('div'), { className: 'cl-empty', textContent: entries.length===0?'No entries yet.':'No entries match your search.' }));
      return;
    }

    filtered.forEach(entry => {
      const linkedLab = labs.find(l => l.id === entry.linked_lab_id);
      const tagsHtml = (entry.tags||[]).map(t=>`<span class="cl-tag">${_esc(t)}</span>`).join('');
      const card = document.createElement('div');
      card.className = 'cl-card';
      card.innerHTML = `
        <div class="cl-card-title">${_esc(entry.title)}</div>
        <div style="font-size:12px;margin:4px 0;opacity:.75;white-space:pre-wrap;max-height:80px;overflow:hidden;">${_esc(entry.content)}</div>
        <div class="cl-card-meta">
          ${linkedLab ? `<span>Lab: ${_esc(linkedLab.name)}</span>` : ''}
          <span>${_dateStr(entry.updated_at || entry.created_at)}</span>
        </div>
        <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${tagsHtml}</div>
        <div style="margin-top:8px;display:flex;gap:6px;">
          <button class="cl-btn cl-btn-ghost" data-action="view" style="font-size:11px;padding:3px 8px">View</button>
          <button class="cl-btn cl-btn-ghost" data-action="edit" style="font-size:11px;padding:3px 8px">Edit</button>
          <button class="cl-btn cl-btn-danger" data-action="delete" style="font-size:11px;padding:3px 8px">Delete</button>
        </div>
      `;

      card.querySelector('[data-action="view"]').addEventListener('click', () => _showEntryModal(entry));
      card.querySelector('[data-action="edit"]').addEventListener('click', () => { editingId = entry.id; showForm = true; render(); });
      card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm(`Delete "${entry.title}"?`)) return;
        await fetch(`${API}/api/cyberlab/knowledge/${entry.id}`, { method:'DELETE' });
        entries = entries.filter(e => e.id !== entry.id);
        render();
      });

      container.appendChild(card);
    });
  }

  render();
}

function _kbForm(entry, labs, onSave, onCancel) {
  const div = document.createElement('div');
  div.className = 'cl-card';
  div.style.marginBottom = '12px';
  div.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:10px;">${entry ? 'Edit Entry' : 'New KB Entry'}</div>
    <div class="cl-field"><label class="cl-label">Title *</label><input class="cl-input" id="clf-kbtitle" value="${_esc(entry?.title||'')}"></div>
    <div class="cl-field"><label class="cl-label">Content</label><textarea class="cl-input cl-textarea" id="clf-kbcontent" style="min-height:120px">${_esc(entry?.content||'')}</textarea></div>
    <div class="cl-field"><label class="cl-label">Tags (comma-separated)</label><input class="cl-input" id="clf-kbtags" value="${_esc((entry?.tags||[]).join(', '))}"></div>
    <div class="cl-field"><label class="cl-label">Link to Lab</label>
      <select class="cl-select" id="clf-kblab" style="width:100%">
        <option value="">— None —</option>
        ${labs.map(l=>`<option value="${l.id}" ${entry?.linked_lab_id===l.id?'selected':''}>${_esc(l.name)}</option>`).join('')}
      </select>
    </div>
    <div class="cl-row" style="justify-content:flex-end;margin-top:4px">
      <button class="cl-btn cl-btn-ghost" id="clf-kbcancel">Cancel</button>
      <button class="cl-btn cl-btn-primary" id="clf-kbsave">Save</button>
    </div>
  `;
  div.querySelector('#clf-kbcancel').addEventListener('click', onCancel);
  div.querySelector('#clf-kbsave').addEventListener('click', () => {
    const title = div.querySelector('#clf-kbtitle').value.trim();
    if (!title) { alert('Title is required.'); return; }
    onSave({
      title,
      content: div.querySelector('#clf-kbcontent').value,
      tags: div.querySelector('#clf-kbtags').value.split(',').map(t=>t.trim()).filter(Boolean),
      linked_lab_id: div.querySelector('#clf-kblab').value || null,
    });
  });
  return div;
}

function _showEntryModal(entry) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg,#1a1d23);border:1px solid var(--border,#3a2a2a);border-radius:8px;max-width:600px;width:100%;max-height:80vh;overflow-y:auto;padding:20px;';
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <strong style="font-size:14px;">${_esc(entry.title)}</strong>
      <button id="kb-modal-close" style="background:none;border:none;color:var(--fg);cursor:pointer;font-size:16px;">✕</button>
    </div>
    <pre style="white-space:pre-wrap;font-size:13px;font-family:inherit;word-break:break-word;">${_esc(entry.content)}</pre>
    <div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">
      ${(entry.tags||[]).map(t=>`<span class="cl-tag">${_esc(t)}</span>`).join('')}
    </div>
  `;
  box.querySelector('#kb-modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function _autoSurface(entries, activeLab) {
  if (!activeLab) return [];
  const labTags = (activeLab.tags || []).map(t => t.toLowerCase());
  const labName = (activeLab.name || '').toLowerCase();
  return entries.filter(e => {
    const eTags = (e.tags || []).map(t => t.toLowerCase());
    return (e.linked_lab_id && e.linked_lab_id === activeLab.id) ||
      eTags.some(t => labTags.includes(t) || labName.includes(t));
  }).slice(0, 3);
}

function _dateStr(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
