// Cerberus CE — Settings → Storage panel

let _bound = false;

async function _fetchCeSettings() {
  const res = await fetch('/api/cerberus/workspace/ce/settings', { credentials: 'same-origin' });
  return res.json();
}

function _el(id) {
  return document.getElementById(id);
}

function _render(data) {
  const status = data.status || {};
  const settings = data.settings || {};
  const pathEl = _el('cerberus-settings-storage-path');
  const mountedEl = _el('cerberus-settings-storage-mounted');
  const inputEl = _el('cerberus-settings-storage-path-input');
  const defaultModeEl = _el('cerberus-settings-storage-default-mode');

  const path = status.workspace_host_root_hint || settings.workspacePath || '—';
  if (pathEl) pathEl.textContent = path;
  if (mountedEl) {
    const mounted = !!status.mounted;
    mountedEl.textContent = mounted ? 'Mounted' : 'Not initialized';
    mountedEl.classList.toggle('cerberus-workspace-mount-badge--ok', mounted);
    mountedEl.classList.toggle('cerberus-workspace-mount-badge--warn', !mounted);
  }
  if (inputEl && !inputEl.dataset.touched) inputEl.value = settings.workspacePath || './AtlasWorkspace';
  if (defaultModeEl) {
    const mode = settings.defaultProjectStorage || 'managed';
    defaultModeEl.querySelectorAll('input[name="cerberus-default-project-storage"]').forEach((inp) => {
      inp.checked = inp.value === mode;
    });
  }
}

async function refreshStorageSettingsPanel() {
  try {
    const data = await _fetchCeSettings();
    if (data.ok !== false) _render(data);
  } catch (_) {
    const mountedEl = _el('cerberus-settings-storage-mounted');
    if (mountedEl) mountedEl.textContent = 'Unavailable';
  }
}

function _bind() {
  if (_bound) return;
  _bound = true;

  _el('cerberus-settings-storage-bootstrap')?.addEventListener('click', async () => {
    await fetch('/api/cerberus/workspace/bootstrap', { method: 'POST', credentials: 'same-origin' });
    await refreshStorageSettingsPanel();
  });

  _el('cerberus-settings-storage-save-path')?.addEventListener('click', async () => {
    const input = _el('cerberus-settings-storage-path-input');
    const defaultMode = document.querySelector('input[name="cerberus-default-project-storage"]:checked')?.value || 'managed';
    const body = {
      workspacePath: input?.value?.trim() || './AtlasWorkspace',
      defaultProjectStorage: defaultMode,
    };
    await fetch('/api/cerberus/workspace/ce/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    if (input) delete input.dataset.touched;
    await refreshStorageSettingsPanel();
  });

  _el('cerberus-settings-storage-path-input')?.addEventListener('input', (e) => {
    e.target.dataset.touched = '1';
  });

  _el('cerberus-settings-storage-browse')?.addEventListener('click', async () => {
    const data = await _fetchCeSettings();
    const start = data?.status?.browse_start || data?.status?.workspace_host_root_hint;
    if (!start) return;
    try {
      const mod = await import('./workspace.js');
      mod.default?.openWorkspaceBrowser?.({ startPath: start, title: 'Atlas Storage' });
    } catch (_) {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(start);
        alert(`Storage path copied:\n${start}`);
      }
    }
  });

  _el('cerberus-settings-storage-open-folder')?.addEventListener('click', async () => {
    const data = await _fetchCeSettings();
    const path = data?.status?.workspace_host_root_hint;
    if (!path) return;
    const res = await fetch('/api/cerberus/desktop/command', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'open_folder', args: { path } }),
    });
    const out = await res.json();
    if (!out.ok && navigator.clipboard) {
      await navigator.clipboard.writeText(path);
      alert(`Storage path:\n${path}\n\n(Copied — open in your file manager.)`);
    }
  });

  _el('cerberus-settings-storage-backup')?.addEventListener('click', async () => {
    const res = await fetch('/api/cerberus/storage/backup', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json();
    alert(data.message || (data.ok ? 'Backup started' : 'Backup unavailable'));
  });

  _el('cerberus-settings-storage-export')?.addEventListener('click', async () => {
    const res = await fetch('/api/cerberus/storage/export', { credentials: 'same-origin' });
    if (!res.ok) {
      alert('Export unavailable');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cerberus-storage-export.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  _el('cerberus-settings-storage-import')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const res = await fetch('/api/cerberus/storage/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      const data = await res.json();
      alert(data.message || (data.ok ? 'Import complete' : 'Import failed'));
      await refreshStorageSettingsPanel();
    });
    input.click();
  });

  _el('cerberus-settings-storage-default-mode')?.addEventListener('change', () => {
    _el('cerberus-settings-storage-save-path')?.click();
  });
}

export function initAtlasStorageSettings() {
  _bind();
}

export function onStorageSettingsTabShown() {
  void refreshStorageSettingsPanel();
}

export default {
  initAtlasStorageSettings,
  onStorageSettingsTabShown,
  refreshStorageSettingsPanel,
};
