/**
 * labs.js — Lab tracker panel for CyberLab.
 *
 * Features: CRUD, set-active-lab, active badge, search/filter, sort.
 */

const API = '';

export async function renderLabs(container, ctx) {
  container.innerHTML = '<div class="cl-empty">Loading labs…</div>';
  let labs = [];
  try {
    const res = await fetch(`${API}/api/cyberlab/labs`);
    labs = await res.json();
  } catch { container.innerHTML = '<div class="cl-error">Failed to load labs.</div>'; return; }

  let activeLab = ctx.activeLab || {};
  let searchQ = '';
  let sortField = 'created_at';
  let showForm = false;
  let editingId = null;

  function render() {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'cl-section-header';
    header.innerHTML = `
      <span class="cl-section-title">Lab Tracker</span>
      <button class="cl-btn cl-btn-primary" id="cl-labs-new">+ New Lab</button>
    `;
    container.appendChild(header);

    // Search + sort bar
    const bar = document.createElement('div');
    bar.className = 'cl-row';
    bar.style.marginBottom = '10px';
    bar.innerHTML = `
      <input class="cl-input" id="cl-labs-search" placeholder="Search labs…" value="${_esc(searchQ)}" style="flex:1">
      <select class="cl-select" id="cl-labs-sort" style="width:130px">
        <option value="created_at" ${sortField==='created_at'?'selected':''}>Newest</option>
        <option value="name" ${sortField==='name'?'selected':''}>Name</option>
        <option value="status" ${sortField==='status'?'selected':''}>Status</option>
        <option value="difficulty" ${sortField==='difficulty'?'selected':''}>Difficulty</option>
      </select>
    `;
    container.appendChild(bar);

    bar.querySelector('#cl-labs-search').addEventListener('input', e => { searchQ = e.target.value; render(); });
    bar.querySelector('#cl-labs-sort').addEventListener('change', e => { sortField = e.target.value; render(); });
    container.querySelector('#cl-labs-new').addEventListener('click', () => { showForm = true; editingId = null; render(); });

    // Inline form
    if (showForm) {
      container.appendChild(_labForm(editingId ? labs.find(l => l.id === editingId) : null, async (data) => {
        if (editingId) {
          await fetch(`${API}/api/cyberlab/labs/${editingId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
          const idx = labs.findIndex(l => l.id === editingId);
          if (idx >= 0) labs[idx] = { ...labs[idx], ...data };
        } else {
          const res = await fetch(`${API}/api/cyberlab/labs`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
          const lab = await res.json();
          labs.push(lab);
        }
        showForm = false; editingId = null; render();
      }, () => { showForm = false; editingId = null; render(); }));
    }

    // Lab list
    let filtered = labs.filter(l => !searchQ || l.name.toLowerCase().includes(searchQ.toLowerCase()) || (l.ip||'').includes(searchQ) || (l.platform||'').toLowerCase().includes(searchQ.toLowerCase()));
    filtered = _sortLabs(filtered, sortField);

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cl-empty';
      empty.textContent = labs.length === 0 ? 'No labs yet. Create your first lab.' : 'No labs match your search.';
      container.appendChild(empty);
      return;
    }

    filtered.forEach(lab => {
      const isActive = activeLab && activeLab.id === lab.id;
      const card = document.createElement('div');
      card.className = 'cl-card';
      card.style.cursor = 'pointer';
      if (isActive) card.style.borderColor = 'var(--red,#c0392b)';

      const tagsHtml = (lab.tags||[]).map(t => `<span class="cl-tag">${_esc(t)}</span>`).join('');
      card.innerHTML = `
        <div class="cl-card-title">
          ${_esc(lab.name)}
          ${isActive ? '<span class="cl-tag" style="margin-left:6px;background:rgba(192,57,43,.3);">ACTIVE</span>' : ''}
        </div>
        <div class="cl-card-meta">
          <span>${_esc(lab.platform||'').toUpperCase()}</span>
          ${lab.os ? `<span>${_esc(lab.os)}</span>` : ''}
          ${lab.difficulty ? `<span>${_esc(lab.difficulty)}</span>` : ''}
          <span class="cl-status-badge" data-status="${_esc(lab.status||'')}">${_esc(lab.status||'')}</span>
          ${lab.ip ? `<span style="font-family:monospace">${_esc(lab.ip)}</span>` : ''}
        </div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${tagsHtml}</div>
        <div style="margin-top:8px;display:flex;gap:6px;">
          <button class="cl-btn cl-btn-ghost" data-action="set-active" style="font-size:11px;padding:3px 8px">${isActive ? 'Active' : 'Set Active'}</button>
          <button class="cl-btn cl-btn-ghost" data-action="edit" style="font-size:11px;padding:3px 8px">Edit</button>
          <button class="cl-btn cl-btn-danger" data-action="delete" style="font-size:11px;padding:3px 8px">Delete</button>
        </div>
      `;

      card.querySelector('[data-action="set-active"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        activeLab = lab;
        await fetch(`${API}/api/cyberlab/active-lab`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(lab) });
        ctx.onLabChange(lab);
        render();
      });

      card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
        e.stopPropagation();
        editingId = lab.id;
        showForm = true;
        render();
      });

      card.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete lab "${lab.name}"?`)) return;
        await fetch(`${API}/api/cyberlab/labs/${lab.id}`, { method:'DELETE' });
        labs = labs.filter(l => l.id !== lab.id);
        if (activeLab && activeLab.id === lab.id) {
          activeLab = {};
          await fetch(`${API}/api/cyberlab/active-lab`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({}) });
          ctx.onLabChange({});
        }
        render();
      });

      container.appendChild(card);
    });
  }

  render();
}

function _labForm(lab, onSave, onCancel) {
  const div = document.createElement('div');
  div.className = 'cl-card';
  div.style.marginBottom = '12px';
  div.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:10px;">${lab ? 'Edit Lab' : 'New Lab'}</div>
    <div class="cl-field"><label class="cl-label">Name *</label><input class="cl-input" id="clf-name" value="${_esc(lab?.name||'')}"></div>
    <div class="cl-row">
      <div class="cl-field" style="flex:1"><label class="cl-label">Platform</label>
        <select class="cl-select" id="clf-platform" style="width:100%">
          ${['htb','thm','pg','ctf','other'].map(p=>`<option value="${p}" ${(lab?.platform||'htb')===p?'selected':''}>${p.toUpperCase()}</option>`).join('')}
        </select>
      </div>
      <div class="cl-field" style="flex:1"><label class="cl-label">OS</label><input class="cl-input" id="clf-os" value="${_esc(lab?.os||'')}"></div>
    </div>
    <div class="cl-row">
      <div class="cl-field" style="flex:1"><label class="cl-label">Difficulty</label>
        <select class="cl-select" id="clf-difficulty" style="width:100%">
          ${['','Easy','Medium','Hard','Insane'].map(d=>`<option value="${d}" ${(lab?.difficulty||'')===d?'selected':''}>${d||'—'}</option>`).join('')}
        </select>
      </div>
      <div class="cl-field" style="flex:1"><label class="cl-label">Status</label>
        <select class="cl-select" id="clf-status" style="width:100%">
          ${['in-progress','completed','abandoned'].map(s=>`<option value="${s}" ${(lab?.status||'in-progress')===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="cl-field"><label class="cl-label">Target IP</label><input class="cl-input" id="clf-ip" value="${_esc(lab?.ip||'')}"></div>
    <div class="cl-field"><label class="cl-label">Tags (comma-separated)</label><input class="cl-input" id="clf-tags" value="${_esc((lab?.tags||[]).join(', '))}"></div>
    <div class="cl-field"><label class="cl-label">Notes</label><textarea class="cl-input cl-textarea" id="clf-notes">${_esc(lab?.notes||'')}</textarea></div>
    <div class="cl-row" style="justify-content:flex-end;margin-top:4px">
      <button class="cl-btn cl-btn-ghost" id="clf-cancel">Cancel</button>
      <button class="cl-btn cl-btn-primary" id="clf-save">Save</button>
    </div>
  `;

  div.querySelector('#clf-cancel').addEventListener('click', onCancel);
  div.querySelector('#clf-save').addEventListener('click', () => {
    const name = div.querySelector('#clf-name').value.trim();
    if (!name) { alert('Name is required.'); return; }
    onSave({
      name,
      platform: div.querySelector('#clf-platform').value,
      os: div.querySelector('#clf-os').value.trim(),
      difficulty: div.querySelector('#clf-difficulty').value,
      status: div.querySelector('#clf-status').value,
      ip: div.querySelector('#clf-ip').value.trim(),
      tags: div.querySelector('#clf-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
      notes: div.querySelector('#clf-notes').value,
    });
  });

  return div;
}

function _sortLabs(labs, field) {
  return [...labs].sort((a, b) => {
    if (field === 'created_at') return (b.created_at||'') > (a.created_at||'') ? 1 : -1;
    if (field === 'name') return (a.name||'').localeCompare(b.name||'');
    return (a[field]||'').localeCompare(b[field]||'');
  });
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
