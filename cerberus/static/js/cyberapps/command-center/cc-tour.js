/**
 * cc-tour.js — First-run guided tour for the Command Center.
 *
 * On first CC open (localStorage cerberus.cc_tour_done absent), shows a
 * tooltip sequence pointing at each tab with NEXT / SKIP TOUR buttons.
 * Dims the shell and spotlights the active tab. Finish or skip sets the
 * flag and hides forever. A "?" button in the brand bar re-triggers manually.
 *
 * Reduced-motion: instant positioning, no spotlight animation.
 *
 * Public API:
 *   initTour(shell)      — call after shell renders; shows on first run
 *   retriggerTour(shell) — force-show regardless of flag
 */

const LS_KEY  = 'cerberus.cc_tour_done';
const TOUR_ID = 'cc-tour-overlay';

const STEPS = [
  { tab: 'command',       title: 'COMMAND',   body: 'Live system status — tasks, swarm activity, model health, gateway feed.' },
  { tab: 'council',       title: 'COUNCIL',   body: 'Multi-agent deliberation — run council sessions with your 16-agent roster.' },
  { tab: 'workspace',     title: 'WORKSPACE', body: 'Tasks, webhooks, git operations, and scheduled automations.' },
  { tab: 'assistant',     title: 'ASSISTANT', body: 'Your profile, notes, docs, contacts, and memory timeline.' },
  { tab: 'gateway',       title: 'GATEWAY',   body: 'Discord / Telegram integration + approval queue for agent actions.' },
  { tab: 'agents',        title: 'AGENTS',    body: 'Your 16-agent roster — configure, invoke, and inspect each agent.' },
  { tab: 'rooms',         title: 'ROOMS',     body: 'Conference rooms for persistent multi-agent conversations.' },
  { tab: 'compare',       title: 'COMPARE',   body: 'Test agents side by side with the same prompt to benchmark output.' },
  { tab: 'observability', title: 'OBSERVE',   body: 'Usage metrics, diagnostics, and performance telemetry.' },
];

let _shell = null;
let _step  = 0;

// ── Persistence ────────────────────────────────────────────────────────────

function _isDone()  { try { return !!localStorage.getItem(LS_KEY); } catch (_) { return false; } }
function _setDone() { try { localStorage.setItem(LS_KEY, '1'); } catch (_) {} }

// ── Public API ─────────────────────────────────────────────────────────────

export function initTour(shell) {
  _addHelpButton(shell);
  if (!_isDone()) _showTour(shell);
}

export function retriggerTour(shell) {
  _showTour(shell);
}

// ── Help button ────────────────────────────────────────────────────────────

function _addHelpButton(shell) {
  const bar = shell?.querySelector('.cc-brand-bar');
  if (!bar || bar.querySelector('.cc-tour-help-btn')) return;
  const btn = document.createElement('button');
  btn.className = 'cc-tour-help-btn';
  btn.type = 'button';
  btn.title = 'Re-run guided tour';
  btn.textContent = '?';
  btn.addEventListener('click', () => retriggerTour(shell));
  const anchor = bar.querySelector('#cc-refresh') || bar.lastElementChild;
  anchor?.insertAdjacentElement('beforebegin', btn);
}

// ── Tour lifecycle ─────────────────────────────────────────────────────────

function _showTour(shell) {
  _endTour();
  if (!shell) return;
  _shell = shell;
  _step  = 0;

  const overlay = document.createElement('div');
  overlay.id = TOUR_ID;
  overlay.className = 'cc-tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Command Center tour');
  document.body.appendChild(overlay);

  _goToStep(0);
}

function _goToStep(idx) {
  const overlay = document.getElementById(TOUR_ID);
  if (!overlay || !_shell) return;
  _step = idx;

  const step    = STEPS[idx];
  const total   = STEPS.length;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tabBtn  = _shell.querySelector(`.cc-tab-btn[data-tab="${step.tab}"]`);
  const rect    = tabBtn ? tabBtn.getBoundingClientRect() : null;

  const dots = STEPS.map((_, i) =>
    `<span class="cc-tour-dot${i === idx ? ' active' : ''}"></span>`
  ).join('');

  const spotlightHTML = rect ? `<div class="cc-tour-spotlight${reduced ? ' no-anim' : ''}"
    style="top:${rect.top - 4}px;left:${rect.left - 6}px;width:${rect.width + 12}px;height:${rect.height + 8}px;"
    aria-hidden="true"></div>` : '';

  const cardStyle = rect
    ? `top:${rect.bottom + 12}px;left:${Math.max(8, rect.left - 20)}px;`
    : 'top:40%;left:50%;transform:translate(-50%,-50%);';

  overlay.innerHTML = `
    ${spotlightHTML}
    <div class="cc-tour-card${reduced ? ' no-anim' : ''}" style="${cardStyle}">
      <div class="cc-tour-step-label">// ${_esc(step.title)}</div>
      <p class="cc-tour-card-body">${_esc(step.body)}</p>
      <div class="cc-tour-card-footer">
        <div class="cc-tour-dots" aria-hidden="true">${dots}</div>
        <div class="cc-tour-card-btns">
          <button class="cc-tour-btn cc-tour-skip" type="button">SKIP TOUR</button>
          <button class="cc-tour-btn cc-tour-next" type="button">
            ${idx + 1 < total ? 'NEXT' : 'DONE'}
          </button>
        </div>
      </div>
    </div>
  `.trim();

  overlay.querySelector('.cc-tour-skip')?.addEventListener('click', () => {
    _setDone();
    _endTour();
  });
  overlay.querySelector('.cc-tour-next')?.addEventListener('click', () => {
    if (idx + 1 < total) _goToStep(idx + 1);
    else { _setDone(); _endTour(); }
  });
}

function _endTour() {
  const overlay = document.getElementById(TOUR_ID);
  if (overlay) overlay.remove();
  _shell = null;
  _step  = 0;
}

// ── Utility ────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Testables ──────────────────────────────────────────────────────────────

export const __testables = {
  STEPS, LS_KEY,
  isDone:        _isDone,
  setDone:       _setDone,
  endTour:       _endTour,
  goToStep:      _goToStep,
  addHelpButton: _addHelpButton,
};
