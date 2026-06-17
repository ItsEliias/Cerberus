// Cerberus OS — Home goals widgets (Finance Goal)

function _el(id) {
  return document.getElementById(id);
}

function _symbol(currency) {
  const c = String(currency || 'GBP').toUpperCase();
  if (c === 'GBP') return '£';
  if (c === 'USD') return '$';
  if (c === 'EUR') return '€';
  return c + ' ';
}

function _fmtMoney(n, currency) {
  const sym = _symbol(currency);
  const val = Number(n) || 0;
  return `${sym}${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

async function _fetchGoals() {
  const res = await fetch('/api/cerberus/goals', { credentials: 'same-origin' });
  const data = await res.json();
  return data.goals || [];
}

async function _patchGoal(id, patch) {
  const res = await fetch(`/api/cerberus/goals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return res.json();
}

function _renderFinanceGoal(goal, container) {
  if (!container || !goal) return;
  const pct = goal.target > 0 ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : 0;
  container.innerHTML = `
    <div class="cerberus-goal-card" data-goal-id="${goal.id}">
      <div class="cerberus-goal-card-head">
        <h3 class="cerberus-goal-card-title">${goal.title || 'Finance Goal'}</h3>
        <span class="cerberus-goal-card-pct">${pct}%</span>
      </div>
      <p class="cerberus-goal-card-amount">${_fmtMoney(goal.current, goal.currency)} / ${_fmtMoney(goal.target, goal.currency)}</p>
      <div class="cerberus-goal-card-bar"><div class="cerberus-goal-card-bar-fill" style="width:${pct}%"></div></div>
      <div class="cerberus-goal-card-edit">
        <label>Current <input type="number" class="cerberus-goal-input" data-field="current" value="${goal.current}" min="0" step="1" /></label>
        <label>Target <input type="number" class="cerberus-goal-input" data-field="target" value="${goal.target}" min="1" step="1" /></label>
        <button type="button" class="cerberus-goal-save-btn">Save</button>
      </div>
    </div>
  `;
  const saveBtn = container.querySelector('.cerberus-goal-save-btn');
  saveBtn?.addEventListener('click', async () => {
    const cur = container.querySelector('[data-field="current"]');
    const tgt = container.querySelector('[data-field="target"]');
    const res = await _patchGoal(goal.id, {
      current: Number(cur?.value) || 0,
      target: Number(tgt?.value) || goal.target,
    });
    if (res.ok && res.goal) _renderFinanceGoal(res.goal, container);
  });
}

export async function renderHomeGoals() {
  const financeSlot = _el('cerberus-widget-finance-goal');
  if (!financeSlot) return;
  try {
    const goals = await _fetchGoals();
    const finance = goals.find((g) => g.id === 'finance-main' || g.type === 'money');
    if (!finance) {
      financeSlot.innerHTML = '<p class="cerberus-widget-placeholder-text">No finance goals yet. Create your first finance tracker in Finance.</p>';
      return;
    }
    _renderFinanceGoal(finance, financeSlot);
  } catch (_) {
    financeSlot.innerHTML = '<p class="cerberus-widget-placeholder-text">Finance goal unavailable.</p>';
  }
}

const cerberusGoals = { renderHomeGoals };
export default cerberusGoals;
