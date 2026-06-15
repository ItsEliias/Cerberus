// Cerberus OS — Finance (personal + project)

let _finance = { entries: [], notes: '' };
let _personal = {};
let _overview = {};
let _projects = [];
let _tab = 'personal';
let _deps = {};

function _el(id) {
  return document.getElementById(id);
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _fmt(n) {
  const v = Number(n) || 0;
  return '£' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function _fetchAll() {
  const [finRes, ovRes, projRes] = await Promise.all([
    fetch('/api/cerberus/finance', { credentials: 'same-origin' }),
    fetch('/api/cerberus/finance/overview', { credentials: 'same-origin' }),
    fetch('/api/cerberus/projects', { credentials: 'same-origin' }),
  ]);
  _finance = await finRes.json();
  const ov = await ovRes.json();
  _overview = ov.overview || {};
  _personal = ov.personal || {};
  const proj = await projRes.json();
  _projects = proj.projects || [];
}

function _renderOverviewCards() {
  const wrap = _el('cerberus-finance-overview-cards');
  if (!wrap) return;
  if (_tab === 'personal') {
    const o = _overview;
    wrap.innerHTML = `
      <div class="cerberus-finance-card"><span class="cerberus-finance-card-label">Due this week</span><span class="cerberus-finance-card-value">${_fmt(o.weekly_due)}</span></div>
      <div class="cerberus-finance-card"><span class="cerberus-finance-card-label">Due this month</span><span class="cerberus-finance-card-value">${_fmt(o.monthly_due)}</span></div>
      <div class="cerberus-finance-card"><span class="cerberus-finance-card-label">Week gross</span><span class="cerberus-finance-card-value">${_fmt(o.weekly_gross)}</span></div>
      <div class="cerberus-finance-card atlas-finance-card--profit"><span class="cerberus-finance-card-label">Week net</span><span class="cerberus-finance-card-value">${_fmt(o.weekly_net)}</span></div>
    `;
    if (o.days_until_next_bill != null) {
      wrap.insertAdjacentHTML('beforeend', `<div class="cerberus-finance-card"><span class="cerberus-finance-card-label">Next bill due</span><span class="cerberus-finance-card-value">${o.days_until_next_bill}d</span></div>`);
    }
  } else {
    const entries = _finance.entries || [];
    const expected = entries.reduce((s, e) => s + (Number(e.expected_revenue) || 0), 0);
    const actual = entries.reduce((s, e) => s + (Number(e.actual_revenue) || 0), 0);
    const costs = entries.reduce((s, e) => s + (Number(e.costs) || 0), 0);
    wrap.innerHTML = `
      <div class="cerberus-finance-card"><span class="cerberus-finance-card-label">Expected Revenue</span><span class="cerberus-finance-card-value">${_fmt(expected)}</span></div>
      <div class="cerberus-finance-card"><span class="cerberus-finance-card-label">Actual Revenue</span><span class="cerberus-finance-card-value">${_fmt(actual)}</span></div>
      <div class="cerberus-finance-card"><span class="cerberus-finance-card-label">Costs</span><span class="cerberus-finance-card-value">${_fmt(costs)}</span></div>
      <div class="cerberus-finance-card atlas-finance-card--profit"><span class="cerberus-finance-card-label">Profit Estimate</span><span class="cerberus-finance-card-value">${_fmt(actual - costs)}</span></div>
    `;
  }
}

function _renderPersonal() {
  const billsEl = _el('cerberus-finance-bills-list');
  const weekEl = _el('cerberus-finance-week-summary');
  const workEl = _el('cerberus-finance-work-list');
  const o = _overview;
  if (weekEl) {
    weekEl.textContent = [
      `Gross ${_fmt(o.weekly_gross)} · Deductions ${_fmt(o.weekly_deductions)} · Net ${_fmt(o.weekly_net)}`,
      `Friday payout target: ${o.friday_payout_date || '—'}`,
      `Last week: ${_fmt(o.last_week_total)} · MTD income: ${_fmt(o.month_to_date_income)}`,
    ].join(' · ');
  }
  const hasBills = (o.upcoming_bills || []).length > 0;
  const hasWork = (_personal.work_log || []).length > 0;
  const hasDeductions = (_personal.weekly_deductions || []).some((d) => d.active !== false);
  const hasGoals = (_overview.goals_count || 0) > 0;
  const emptyEl = _el('cerberus-finance-empty-state');
  if (emptyEl) {
    emptyEl.classList.toggle('hidden', hasBills || hasWork || hasDeductions || hasGoals);
  }
  if (billsEl) {
    const bills = o.upcoming_bills || [];
    billsEl.innerHTML = bills.length
      ? bills.map(b => `<li>${_esc(b.name)} ${_fmt(b.amount)} — ${b.days_until}d (${_esc(b.next_due_date || '')})</li>`).join('')
      : '<li class="cerberus-panel-empty">No bills yet — add income, expenses, or reminders above.</li>';
  }
  if (workEl) {
    const logs = (_personal.work_log || []).slice(-8).reverse();
    workEl.innerHTML = logs.length
      ? logs.map(w => `<li>${_esc(w.date)} · ${_esc(w.type)} · ${_fmt(w.amount)}</li>`).join('')
      : '<li class="cerberus-panel-empty">No income logged yet.</li>';
  }
}

function _renderProjectTable() {
  const tbody = _el('cerberus-finance-table-body');
  if (!tbody) return;
  const entries = _finance.entries || [];
  tbody.innerHTML = entries.map(e => `
    <tr data-finance-id="${_esc(e.id)}">
      <td>${_esc(e.name)}</td>
      <td><input type="number" class="cerberus-finance-input" data-field="expected_revenue" value="${e.expected_revenue || 0}" min="0" step="1" /></td>
      <td><input type="number" class="cerberus-finance-input" data-field="actual_revenue" value="${e.actual_revenue || 0}" min="0" step="1" /></td>
      <td><input type="number" class="cerberus-finance-input" data-field="costs" value="${e.costs || 0}" min="0" step="1" /></td>
      <td class="cerberus-finance-profit-cell">${_fmt((e.actual_revenue || 0) - (e.costs || 0))}</td>
      <td><button type="button" class="cerberus-finance-save-btn" data-save-finance="${_esc(e.id)}">Save</button></td>
    </tr>
  `).join('');
}

function _renderStrategy() {
  const wrap = _el('cerberus-finance-strategy');
  const sel = _el('cerberus-finance-project-select');
  if (sel) {
    const entries = _finance.entries || [];
    sel.innerHTML = entries.map(e => `<option value="${_esc(e.id)}">${_esc(e.name)}</option>`).join('');
  }
  if (!wrap) return;
  const pid = sel?.value;
  const entries = _finance.entries || [];
  const filtered = pid ? entries.filter(e => e.id === pid) : entries;
  wrap.innerHTML = filtered.map(e => `
    <article class="cerberus-finance-strategy-card">
      <h4>${_esc(e.name)}</h4>
      <textarea class="cerberus-finance-strategy-input" data-strategy-id="${_esc(e.id)}" rows="3">${_esc(e.monetisation_strategy || '')}</textarea>
      <p class="cerberus-finance-notes">${_esc(e.notes || '')}</p>
    </article>
  `).join('');
}

function _setTab(tab) {
  _tab = tab;
  document.querySelectorAll('.atlas-finance-tab').forEach(btn => {
    btn.classList.toggle('cerberus-finance-tab--active', btn.dataset.financeTab === tab);
  });
  _el('cerberus-finance-personal')?.classList.toggle('hidden', tab !== 'personal');
  _el('cerberus-finance-project')?.classList.toggle('hidden', tab !== 'project');
  _renderOverviewCards();
}

async function _saveEntry(id, fields) {
  const res = await fetch('/api/cerberus/finance', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...fields }),
  });
  const data = await res.json();
  if (data.ok) {
    _finance = data.finance;
    _renderOverviewCards();
    _renderProjectTable();
    _renderStrategy();
    if (_deps.showToast) _deps.showToast('Finance updated');
  }
}

async function _runBusinessAgent(action) {
  const pid = _el('cerberus-finance-project-select')?.value;
  const res = await fetch('/api/cerberus/agents/run', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: 'business', action, project_id: pid || undefined }),
  });
  const data = await res.json();
  if (_deps.showToast) _deps.showToast(data.message || (data.ok ? 'Report queued' : 'Failed'));
}

function _bindEvents() {
  const panel = _el('cerberus-finance-panel');
  if (!panel) return;

  panel.querySelectorAll('[data-finance-tab]').forEach(btn => {
    btn.addEventListener('click', () => _setTab(btn.dataset.financeTab));
  });

  _el('cerberus-finance-bill-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: _el('cerberus-finance-bill-name')?.value,
      amount: Number(_el('cerberus-finance-bill-amount')?.value) || 0,
      due_day: Number(_el('cerberus-finance-bill-due-day')?.value) || 1,
      frequency: 'monthly',
      remind: true,
    };
    await fetch('/api/cerberus/finance/bills', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await _fetchAll();
    _renderPersonal();
    _renderOverviewCards();
    if (_deps.showToast) _deps.showToast('Bill added');
    e.target.reset();
  });

  const workType = _el('cerberus-finance-work-type');
  const workAmt = _el('cerberus-finance-work-amount');
  workType?.addEventListener('change', () => {
    if (workAmt) workAmt.classList.toggle('hidden', workType.value !== 'Custom');
  });

  _el('cerberus-finance-work-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      date: _el('cerberus-finance-work-date')?.value || undefined,
      type: workType?.value || 'Full Day',
      amount: workType?.value === 'Custom' ? Number(workAmt?.value) || 0 : undefined,
    };
    await fetch('/api/cerberus/finance/work-log', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await _fetchAll();
    _renderPersonal();
    _renderOverviewCards();
    if (_deps.showToast) _deps.showToast('Work day logged');
  });

  _el('cerberus-finance-project-select')?.addEventListener('change', _renderStrategy);
  _el('cerberus-finance-ask-business')?.addEventListener('click', () => _runBusinessAgent('business_analysis'));
  _el('cerberus-finance-monetisation-plan')?.addEventListener('click', () => _runBusinessAgent('monetisation_plan'));

  panel.querySelectorAll('[data-finance-quick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.financeQuick;
      if (kind === 'goal') {
        _el('cerberus-finance-bill-name')?.focus();
        import('./cerberusGoals.js').then((m) => m.default?.openCreateGoal?.()).catch(() => {});
        return;
      }
      if (kind === 'income') {
        _el('cerberus-finance-work-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        _el('cerberus-finance-work-date')?.focus();
        return;
      }
      if (kind === 'expense') {
        _el('cerberus-finance-bill-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        _el('cerberus-finance-bill-name')?.focus();
      }
    });
  });

  panel.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-save-finance]');
    if (!btn) return;
    const id = btn.dataset.saveFinance;
    const row = btn.closest('tr');
    if (!row) return;
    const fields = {};
    row.querySelectorAll('[data-field]').forEach(inp => {
      fields[inp.dataset.field] = Number(inp.value) || 0;
    });
    const strat = panel.querySelector(`[data-strategy-id="${id}"]`);
    if (strat) fields.monetisation_strategy = strat.value;
    await _saveEntry(id, fields);
  });
}

export async function renderFinancePanel() {
  await _fetchAll();
  const dateInput = _el('cerberus-finance-work-date');
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  _setTab(_tab);
  _renderPersonal();
  _renderProjectTable();
  _renderStrategy();
}

export function initAtlasFinance(deps = {}) {
  _deps = deps;
  _bindEvents();
}

const cerberusFinanceModule = {
  initAtlasFinance,
  renderFinancePanel,
};

export default cerberusFinanceModule;
