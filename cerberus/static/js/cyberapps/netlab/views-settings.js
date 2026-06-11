/**
 * static/js/cyberapps/netlab/views-settings.js
 * SettingsView — preferences + data management. Ported from CyberOS NetLab.
 */

import * as State from './state.js';

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function renderSettingsView(container) {
  let saved = false;

  function exportProgress() {
    const prog = State.get('progress');
    const json = JSON.stringify(prog, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netlab-progress-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  let resetArmed = false;

  function resetProgress() {
    if (!resetArmed) {
      resetArmed = true;
      render();
      setTimeout(() => { resetArmed = false; render(); }, 5000);
      return;
    }
    fetch('/api/cyberapps/netlab/progress', { method: 'DELETE' }).catch(() => {});
    State.setProgress({});
    resetArmed = false;
    render();
  }

  function render() {
    container.innerHTML = `
      <div class="nl-settings-wrap">
        <h2 class="nl-settings-title">Settings</h2>

        <!-- Data section -->
        <div class="nl-settings-section">
          <p class="nl-label" style="margin-bottom:8px;">Data</p>
          <div class="nl-settings-card">
            <div class="nl-setting-row">
              <div>
                <p class="nl-setting-label">Export Progress</p>
                <p class="nl-setting-desc">Download your lab progress as JSON.</p>
              </div>
              <button id="nl-export-btn" class="nl-btn-outline">Export JSON</button>
            </div>
            <div class="nl-setting-row">
              <div>
                <p class="nl-setting-label">Reset Progress</p>
                <p class="nl-setting-desc">Clear all lab progress and start fresh.</p>
              </div>
              <button id="nl-reset-btn" class="nl-btn-danger${resetArmed?' nl-btn-danger-armed':''}">
                ${resetArmed ? 'Click again to confirm' : 'Reset All'}
              </button>
            </div>
          </div>
        </div>

        <!-- About -->
        <div class="nl-settings-section" style="margin-top:24px;">
          <div class="nl-settings-about">
            <p class="nl-muted">NetLab — Part of the CYBERTOOLS ecosystem by ItsEliias</p>
            <p class="nl-muted">Cerberus native port — lab data stored in <code class="nl-code-inline">data/cyberapps/netlab/</code></p>
          </div>
        </div>

        ${saved ? '<p style="color:#3fb950;font-size:13px;margin-top:8px;">Saved!</p>' : ''}
      </div>
    `;

    container.querySelector('#nl-export-btn')?.addEventListener('click', exportProgress);
    container.querySelector('#nl-reset-btn')?.addEventListener('click', resetProgress);
  }

  render();

  return { destroy: () => {} };
}
