/**
 * static/js/cyberapps/netlab/views-labs.js
 * LabsView + LabStepView — ported from CyberOS NetLab.
 */

import * as State from './state.js';

const DIFF_LABELS = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];

function diffColor(d) {
  if (d <= 1) return '#3fb950';
  if (d <= 2) return '#5ec4ff';
  if (d <= 3) return '#d29922';
  return '#f85149';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// LabsView
// ---------------------------------------------------------------------------

export function renderLabsView(container) {
  const labs = State.get('labs');
  const progress = State.get('progress');
  let selectedLabId = labs[0]?.id ?? null;
  let filterCategory = 'All';
  let filterDiff = 'All';
  let search = '';

  function filtered() {
    return labs.filter(l => {
      const mc = filterCategory === 'All' || l.category === filterCategory;
      const md = filterDiff === 'All' || l.difficulty === filterDiff;
      const ms = !search || l.title.toLowerCase().includes(search) || l.tags.some(t => t.includes(search));
      return mc && md && ms;
    });
  }

  function previewLab() {
    const f = filtered();
    if (!f.find(l => l.id === selectedLabId) && f.length > 0) selectedLabId = f[0].id;
    return f.find(l => l.id === selectedLabId) ?? null;
  }

  function render() {
    const cats = ['All', 'CCNA', 'CCNP', 'Linux', 'FortiGate', 'EVE-NG', 'GNS3'];
    const fLabs = filtered();
    const lab = previewLab();
    const prog = lab ? progress[lab.id] : null;
    const completedSteps = prog ? Object.values(prog.stepResults).filter(r => r.passed).length : 0;

    container.innerHTML = `
      <div class="nl-labs-layout">
        <!-- Left list pane -->
        <div class="nl-list-pane">
          <div class="nl-list-search">
            <span class="nl-label">Labs</span>
            <input id="nl-search" class="nl-input" placeholder="Search labs..." value="${esc(search)}">
          </div>
          <div class="nl-cat-pills">
            ${cats.map(c => `<button class="nl-pill${filterCategory===c?' nl-pill-active':''}" data-cat="${c}">${c}</button>`).join('')}
          </div>
          <div class="nl-diff-row">
            <span class="nl-muted">Difficulty:</span>
            ${['All',1,2,3,4,5].map(d => `<button class="nl-diff-btn${filterDiff===d?' nl-diff-active':''}" data-diff="${d}">${d==='All'?'All':DIFF_LABELS[d]}</button>`).join('')}
          </div>
          <div class="nl-list-items">
            ${fLabs.length === 0 ? '<p class="nl-muted-center">No labs match your filters.</p>' :
              fLabs.map(l => {
                const p = progress[l.id];
                const isActive = l.id === selectedLabId;
                return `<button class="nl-lab-card${isActive?' nl-card-active':''}" data-labid="${l.id}">
                  <div class="nl-card-header">
                    <span class="nl-card-title">${esc(l.title)}</span>
                    ${p?.completedAt ? '<span class="nl-badge-done">Done</span>' : ''}
                  </div>
                  <div class="nl-card-meta">
                    <span class="nl-badge-vendor">${esc(l.vendor)}</span>
                    <span style="color:${diffColor(l.difficulty)};font-size:11px;">${DIFF_LABELS[l.difficulty]}</span>
                  </div>
                  <p class="nl-card-desc">${esc(l.description.slice(0,80))}${l.description.length>80?'...':''}</p>
                </button>`;
              }).join('')}
          </div>
        </div>

        <!-- Right detail pane -->
        <div class="nl-detail-pane">
          ${lab ? `
            <div class="nl-detail-header">
              <div>
                <h2 class="nl-detail-title">${esc(lab.title)}</h2>
                <div class="nl-detail-badges">
                  <span class="nl-badge-cat">${esc(lab.category)}</span>
                  <span class="nl-badge-vendor">${esc(lab.vendor)}</span>
                  <span style="color:${diffColor(lab.difficulty)};font-size:11px;">${DIFF_LABELS[lab.difficulty]}</span>
                </div>
              </div>
              <button id="nl-start-btn" class="nl-btn-primary">${prog?.completedAt ? 'Retry Lab' : 'Start Lab'}</button>
            </div>
            <p class="nl-detail-desc">${esc(lab.description)}</p>
            ${lab.topology ? `<div class="nl-topology-box"><span class="nl-label">Topology</span><p class="nl-mono">${esc(lab.topology)}</p></div>` : ''}
            ${prog ? `
              <div class="nl-progress-bar-wrap">
                <div class="nl-progress-meta"><span>Progress</span><span>${completedSteps} / ${lab.steps.length} steps</span></div>
                <div class="nl-progress-track"><div class="nl-progress-fill" style="width:${Math.round((completedSteps/lab.steps.length)*100)}%"></div></div>
              </div>` : ''}
            <div class="nl-steps-list">
              <p class="nl-label" style="margin-bottom:8px;">Steps (${lab.steps.length})</p>
              ${lab.steps.map(s => {
                const r = prog?.stepResults[s.id];
                return `<div class="nl-step-row">
                  <div class="nl-step-dot${r?.passed?' nl-step-done':''}">${r?.passed ? '✓' : s.number}</div>
                  <div>
                    <p class="nl-step-title">${esc(s.title)}</p>
                    ${s.command ? `<code class="nl-code-inline">${esc(s.command.split('\n')[0])}${s.command.includes('\n')?'...':''}</code>` : ''}
                  </div>
                </div>`;
              }).join('')}
            </div>
          ` : '<p class="nl-muted-center" style="padding:40px">Select a lab from the list.</p>'}
        </div>
      </div>
    `;

    // Wire events
    container.querySelector('#nl-search')?.addEventListener('input', e => {
      search = e.target.value.toLowerCase();
      render();
    });
    container.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => { filterCategory = btn.dataset.cat; render(); });
    });
    container.querySelectorAll('[data-diff]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.diff;
        filterDiff = v === 'All' ? 'All' : parseInt(v, 10);
        render();
      });
    });
    container.querySelectorAll('[data-labid]').forEach(btn => {
      btn.addEventListener('click', () => { selectedLabId = btn.dataset.labid; render(); });
    });
    container.querySelector('#nl-start-btn')?.addEventListener('click', () => {
      if (lab) { State.setActiveLab(lab); State.startLabTimer(); }
    });
  }

  // Re-render on lab/progress changes
  const unsubs = [
    State.subscribe('labs', () => render()),
    State.subscribe('progress', () => render()),
  ];

  render();

  return { destroy: () => unsubs.forEach(u => u()) };
}

// ---------------------------------------------------------------------------
// LabStepView
// ---------------------------------------------------------------------------

export function renderLabStepView(container) {
  let actualOutput = '';
  let verifyResult = null; // 'pass'|'fail'|null
  let hintIndex = 0;
  let showHints = false;

  function getActiveLab() { return State.get('activeLab'); }
  function getIdx() { return State.get('activeStepIndex'); }
  function getProgress() { return State.get('progress'); }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }

  function checkLabComplete(labId, stepId, passed) {
    const lab = getActiveLab();
    if (!lab) return;
    const prog = getProgress()[labId];
    if (!prog) return;
    const allPassed = lab.steps.every(s => {
      if (s.id === stepId) return passed;
      return prog.stepResults[s.id]?.passed === true;
    });
    if (allPassed && !prog.completedAt) {
      const labStart = State.get('labStartTime');
      State.markLabComplete(labId, labStart ? Date.now() - labStart : undefined);
    }
  }

  function verify() {
    const lab = getActiveLab();
    if (!lab) return;
    const step = lab.steps[getIdx()];
    if (!step?.expectedOutput) return;
    const passed = actualOutput.toLowerCase().includes(step.expectedOutput.toLowerCase());
    verifyResult = passed ? 'pass' : 'fail';
    State.updateStepResult(lab.id, step.id, passed, actualOutput);
    checkLabComplete(lab.id, step.id, passed);
    render();
  }

  function markComplete() {
    const lab = getActiveLab();
    if (!lab) return;
    const step = lab.steps[getIdx()];
    State.updateStepResult(lab.id, step.id, true);
    checkLabComplete(lab.id, step.id, true);
  }

  function render() {
    const lab = getActiveLab();
    if (!lab) return;
    const idx = getIdx();
    const step = lab.steps[idx];
    const prog = getProgress()[lab.id];
    const stepResult = prog?.stepResults[step.id];
    const notes = prog?.notes ?? '';
    const totalSteps = lab.steps.length;
    const verifiedCount = lab.steps.filter(s => prog?.stepResults[s.id]?.passed).length;

    container.innerHTML = `
      <div class="nl-step-layout">
        <!-- Header -->
        <div class="nl-step-header">
          <button id="nl-back-btn" class="nl-btn-ghost">← Back to Labs</button>
          <span class="nl-sep">|</span>
          <span class="nl-step-lab-title">${esc(lab.title)}</span>
          <div class="nl-flex1"></div>
          <div class="nl-step-dots">
            ${lab.steps.map((s, i) => {
              const r = prog?.stepResults[s.id];
              const cls = r?.passed ? 'nl-dot-done' : (i === idx ? 'nl-dot-active' : 'nl-dot-idle');
              return `<button class="nl-dot ${cls}" data-si="${i}" title="Step ${i+1}"></button>`;
            }).join('')}
          </div>
          <span class="nl-muted">${idx+1}/${totalSteps}</span>
        </div>

        <!-- Content -->
        <div class="nl-step-content">
          <div class="nl-step-inner">
            <!-- Step number + title -->
            <div class="nl-step-title-row">
              <div class="nl-step-num${stepResult?.passed?' nl-step-num-done':''}">${stepResult?.passed ? '✓' : step.number}</div>
              <h2 class="nl-step-heading">${esc(step.title)}</h2>
            </div>
            ${step.deviceName ? `<div class="nl-device-tag">Device: ${esc(step.deviceName)}</div>` : ''}
            <p class="nl-step-desc">${esc(step.description)}</p>

            <!-- Command block -->
            ${step.command ? `
              <div class="nl-cmd-block">
                <div class="nl-cmd-header">
                  <span class="nl-label">Command</span>
                  <div style="display:flex;gap:6px;">
                    <button id="nl-copy-btn" class="nl-btn-sm">Copy</button>
                  </div>
                </div>
                <pre class="nl-cmd-pre">${esc(step.command)}</pre>
              </div>` : ''}

            <!-- No-verification self-attest button -->
            ${!step.expectedOutput ? `
              <div class="nl-verify-row">
                <button id="nl-mark-complete-btn" class="nl-btn-primary${stepResult?.passed?' nl-btn-done':''}"
                  ${stepResult?.passed?'disabled':''}>
                  ${stepResult?.passed ? '✓ Marked Complete' : 'Mark Step Complete'}
                </button>
                ${stepResult?.passed ? '<button id="nl-undo-btn" class="nl-btn-ghost nl-danger-hover">undo</button>' : ''}
              </div>` : ''}

            <!-- Verification section -->
            ${step.expectedOutput ? `
              <div class="nl-verify-section">
                <div class="nl-verify-header">
                  <span class="nl-label">Verification</span>
                  ${step.verificationCommand ? `<code class="nl-code-inline">${esc(step.verificationCommand)}</code>` : ''}
                </div>
                <div class="nl-expected-box">
                  <span class="nl-muted" style="font-size:11px;">Expected output contains:</span>
                  <code class="nl-expected-code">${esc(step.expectedOutput)}</code>
                </div>
                <textarea id="nl-actual-output" class="nl-textarea" rows="4"
                  placeholder="Paste your actual command output here...">${esc(actualOutput)}</textarea>
                <div class="nl-verify-row">
                  <button id="nl-verify-btn" class="nl-btn-primary"${!actualOutput.trim()?' disabled':''}>Verify Output</button>
                  ${verifyResult ? `<span class="nl-verify-result${verifyResult==='pass'?' nl-pass':' nl-fail'}">
                    ${verifyResult==='pass'?'✓ Passed':'✗ Not matched — check output'}
                  </span>` : ''}
                </div>
              </div>` : ''}

            <!-- Hints -->
            ${step.hints.length > 0 ? `
              <div class="nl-hints-section">
                <button id="nl-hints-toggle" class="nl-btn-ghost">
                  ${showHints ? 'Hide hints' : `Show hint (${hintIndex+1}/${step.hints.length})`}
                </button>
                ${showHints ? `
                  <div class="nl-hint-box">
                    <p class="nl-hint-text">${esc(step.hints[hintIndex])}</p>
                    ${hintIndex < step.hints.length - 1 ? '<button id="nl-next-hint" class="nl-btn-ghost nl-hint-next">Next hint →</button>' : ''}
                  </div>` : ''}
              </div>` : ''}

            <!-- Notes -->
            <div class="nl-notes-section">
              <div class="nl-notes-header">
                <span class="nl-label">Notes</span>
              </div>
              <textarea id="nl-notes" class="nl-textarea" rows="3" placeholder="Your notes for this lab...">${esc(notes)}</textarea>
            </div>
          </div>
        </div>

        <!-- Footer nav -->
        <div class="nl-step-footer">
          <button id="nl-prev-btn" class="nl-btn-secondary" ${idx===0?'disabled':''}>← Previous Step</button>
          <span class="nl-muted">${verifiedCount} / ${totalSteps} verified</span>
          <button id="nl-next-btn" class="nl-btn-primary" ${idx===totalSteps-1?'disabled':''}>Next Step →</button>
        </div>
      </div>
    `;

    // Wire events
    container.querySelector('#nl-back-btn').addEventListener('click', () => {
      State.setActiveLab(null);
      State.clearLabTimer();
    });
    container.querySelectorAll('[data-si]').forEach(btn => {
      btn.addEventListener('click', () => {
        State.setActiveStepIndex(parseInt(btn.dataset.si, 10));
        actualOutput = '';
        verifyResult = null;
        hintIndex = 0;
        showHints = false;
      });
    });
    container.querySelector('#nl-copy-btn')?.addEventListener('click', async () => {
      const ok = await copyToClipboard(step.command);
      if (ok) {
        const btn = container.querySelector('#nl-copy-btn');
        if (btn) { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
      }
    });
    container.querySelector('#nl-mark-complete-btn')?.addEventListener('click', () => { markComplete(); });
    container.querySelector('#nl-undo-btn')?.addEventListener('click', () => {
      State.updateStepResult(lab.id, step.id, false);
    });
    const ta = container.querySelector('#nl-actual-output');
    if (ta) {
      ta.value = actualOutput;
      ta.addEventListener('input', e => { actualOutput = e.target.value; });
    }
    container.querySelector('#nl-verify-btn')?.addEventListener('click', verify);
    container.querySelector('#nl-hints-toggle')?.addEventListener('click', () => { showHints = !showHints; render(); });
    container.querySelector('#nl-next-hint')?.addEventListener('click', () => { hintIndex++; render(); });
    const notesEl = container.querySelector('#nl-notes');
    if (notesEl) {
      notesEl.addEventListener('input', e => { State.updateLabNotes(lab.id, e.target.value); });
    }
    container.querySelector('#nl-prev-btn')?.addEventListener('click', () => {
      if (idx > 0) { State.setActiveStepIndex(idx - 1); actualOutput = ''; verifyResult = null; hintIndex = 0; showHints = false; }
    });
    container.querySelector('#nl-next-btn')?.addEventListener('click', () => {
      if (idx < totalSteps - 1) { State.setActiveStepIndex(idx + 1); actualOutput = ''; verifyResult = null; hintIndex = 0; showHints = false; }
    });
  }

  const unsubs = [
    State.subscribe('activeStepIndex', () => render()),
    State.subscribe('progress', () => render()),
  ];

  render();

  return { destroy: () => unsubs.forEach(u => u()) };
}
