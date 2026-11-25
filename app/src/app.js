import {
  allocateFromDistributable,
  BUCKET_META,
  BUCKETS,
  computeAllMonths,
  computeFrequentSuggestions,
  computeLendingForMonth,
  computeLendingSummary,
  CURRENCIES,
  formatMoney,
  formatMonthLabel,
  getCurrencyMeta,
  getDaysRemainingInMonth,
  GIVINGS_TAGS,
  nextMonthId,
  prevMonthId
} from './budgetEngine.js';
import { renderGivingsTagBreakdown, renderMonthlyTrendSvg } from './charts.js';
import { bindDateField, renderDateFieldHtml } from './datePicker.js';
import {
  deleteLending,
  deleteTransaction,
  exportBackupPayload,
  exportTransactionsCsv,
  getKv,
  importBackupPayload,
  loadAppState,
  reseedFromExcel,
  saveLending,
  saveMonth,
  saveSettings,
  saveSyncConfig,
  saveTransaction,
  setKv,
  syncWithCloudflareWorker,
  syncWithGitHubGist,
  syncWithGoogleSheets
} from './db.js';
import { parseBatchAlerts, parseCsvStatement, parseQuickBatch } from './parser.js';

const state = {
  months: [],
  transactions: [],
  lending: [],
  rules: null,
  chips: [],
  customRules: [],
  syncConfig: { gistId: '', token: '', lastSyncAt: null },
  activeMonthId: '2026-11',
  activeView: 'quick',
  filters: { bucket: 'all', method: 'all', tag: 'all', search: '' },
  quickLogMode: 'expense',
  hideHomeBalances: false,
  pendingBatch: [],
  deferredInstallPrompt: null
};

let summaries = new Map();

function uid(prefix = 'tx') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function recompute() {
  summaries = computeAllMonths(state.months, state.transactions, state.rules);
  if (!summaries.has(state.activeMonthId) && state.months.length > 0) {
    const sorted = [...state.months].sort((a, b) => a.id.localeCompare(b.id));
    state.activeMonthId = sorted[sorted.length - 1].id;
  }
}

function showToast(message, undoFn = null) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (undoFn) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = 'Undo';
    btn.onclick = async () => {
      await undoFn();
      el.remove();
    };
    el.appendChild(btn);
  }
  container.appendChild(el);
  setTimeout(() => el.remove(), 4800);
}

function openModal(html, onBind) {
  const backdrop = document.getElementById('modal-backdrop');
  const card = document.getElementById('modal-card');
  card.innerHTML = html;
  backdrop.classList.remove('hidden');
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeModal();
  };
  if (onBind) onBind(card);
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
}

function updateSyncPill() {
  const pill = document.getElementById('sync-pill');
  if (!pill) return;
  const online = navigator.onLine;
  const cfg = state.syncConfig || {};
  const last = cfg.lastSyncAt
    ? new Date(cfg.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Ready';
  if (cfg.provider === 'gsheets' && cfg.sheetUrl && cfg.sheetKey) {
    pill.textContent = `${online ? 'Google Sheets' : 'Offline Cache'} • ${last}`;
  } else if (cfg.provider === 'cloudflare' && cfg.workerUrl && cfg.syncKey) {
    pill.textContent = `${online ? 'Cloudflare D1' : 'Offline Cache'} • ${last}`;
  } else if (cfg.gistId && cfg.token) {
    pill.textContent = `${online ? 'Synced Gist' : 'Offline Cache'} • ${last}`;
  } else {
    pill.textContent = `${online ? 'Local-First' : 'Offline Mode'}`;
  }
}

function renderMonthSelector() {
  const sel = document.getElementById('month-select');
  const sorted = [...state.months].sort((a, b) => b.id.localeCompare(a.id));
  sel.innerHTML = sorted
    .map((m) => `<option value="${m.id}" ${m.id === state.activeMonthId ? 'selected' : ''}>${formatMonthLabel(m.id)}</option>`)
    .join('');
}

async function maybeAutoSync(direction = 'push') {
  const cfg = state.syncConfig || {};
  if (!navigator.onLine) return;
  try {
    if (cfg.provider === 'gsheets' && cfg.sheetUrl && cfg.sheetKey) {
      const mode = direction === 'auto' ? 'sync' : direction;
      const res = await syncWithGoogleSheets(cfg, [...summaries.values()], mode);
      state.syncConfig = res.config;
      if (res.reloaded) {
        const fresh = await loadAppState();
        Object.assign(state, fresh);
        recompute();
        render();
      } else {
        updateSyncPill();
      }
      return;
    }
    if (cfg.provider === 'cloudflare' && cfg.workerUrl && cfg.syncKey) {
      const res = await syncWithCloudflareWorker(cfg);
      state.syncConfig = res.config;
      const fresh = await loadAppState();
      Object.assign(state, fresh);
      recompute();
      render();
      return;
    }
    if (cfg.token && cfg.gistId) {
      const res = await syncWithGitHubGist(cfg, direction);
      state.syncConfig = res.config;
      if (res.action === 'pulled') {
        const fresh = await loadAppState();
        Object.assign(state, fresh);
        recompute();
        render();
      } else {
        updateSyncPill();
      }
    }
  } catch {
    updateSyncPill();
  }
}

function getMonthCurrency(monthId) {
  return summaries.get(monthId)?.currency
    || state.months.find((m) => m.id === monthId)?.currency
    || state.rules?.currency
    || 'NGN';
}

function currencyOptionsHtml(selectedCode = 'NGN') {
  return Object.values(CURRENCIES)
    .map((c) => `<option value="${c.code}" ${c.code === selectedCode ? 'selected' : ''}>${c.label}</option>`)
    .join('');
}

async function addTransaction(txInput) {
  const date = txInput.date || new Date().toISOString().slice(0, 10);
  const monthId = txInput.monthId || date.slice(0, 7);

  // Auto-create month record if logging into a new month
  if (!state.months.some((m) => m.id === monthId)) {
    const sorted = [...state.months].sort((a, b) => a.id.localeCompare(b.id));
    const latestNet = sorted[sorted.length - 1]?.netIncome || 300000;
    const cur = txInput.currency || state.rules?.currency || 'NGN';
    const newMonth = { id: monthId, netIncome: latestNet, currency: cur, note: formatMonthLabel(monthId) };
    await saveMonth(newMonth);
    state.months.push(newMonth);
  }

  const cur = txInput.currency || getMonthCurrency(monthId);
  const tx = {
    id: uid('tx'),
    monthId,
    currency: cur,
    date,
    bucket: txInput.bucket || 'personal',
    description: (txInput.description || 'Expense').trim(),
    amount: Math.round((Number(txInput.amount) || 0) * 100) / 100,
    paymentMethod: txInput.paymentMethod || 'cash',
    tag: txInput.bucket === 'givings' ? (txInput.tag || 'gifts') : '',
    source: txInput.source || 'manual'
  };

  await saveTransaction(tx);
  state.transactions.push(tx);
  state.activeMonthId = monthId;
  recompute();
  render();
  maybeAutoSync('push');

  showToast(`Logged ${formatMoney(tx.amount, cur)} → ${BUCKET_META[tx.bucket].short}`, async () => {
    await deleteTransaction(tx.id);
    state.transactions = state.transactions.filter((x) => x.id !== tx.id);
    recompute();
    render();
    maybeAutoSync('push');
  });
}

async function addTransactionsBatch(txInputs) {
  if (!txInputs || txInputs.length === 0) return;
  if (txInputs.length === 1) return addTransaction(txInputs[0]);

  const created = [];
  let total = 0;
  let lastMonthId = state.activeMonthId;
  let lastCur = getMonthCurrency(lastMonthId);

  for (const txInput of txInputs) {
    const date = txInput.date || new Date().toISOString().slice(0, 10);
    const monthId = txInput.monthId || date.slice(0, 7);
    if (!state.months.some((m) => m.id === monthId)) {
      const sorted = [...state.months].sort((a, b) => a.id.localeCompare(b.id));
      const latestNet = sorted[sorted.length - 1]?.netIncome || 300000;
      const newCur = txInput.currency || state.rules?.currency || 'NGN';
      const newMonth = { id: monthId, netIncome: latestNet, currency: newCur, note: formatMonthLabel(monthId) };
      await saveMonth(newMonth);
      state.months.push(newMonth);
    }
    const cur = txInput.currency || getMonthCurrency(monthId);
    const tx = {
      id: uid('tx'),
      monthId,
      currency: cur,
      date,
      bucket: txInput.bucket || 'personal',
      description: (txInput.description || 'Expense').trim(),
      amount: Math.round((Number(txInput.amount) || 0) * 100) / 100,
      paymentMethod: txInput.paymentMethod || 'cash',
      tag: txInput.bucket === 'givings' ? (txInput.tag || 'gifts') : '',
      source: txInput.source || 'manual'
    };
    await saveTransaction(tx);
    state.transactions.push(tx);
    created.push(tx);
    total += tx.amount;
    lastMonthId = monthId;
    lastCur = cur;
  }

  state.activeMonthId = lastMonthId;
  recompute();
  render();
  maybeAutoSync('push');

  showToast(`Logged ${created.length} expenses (${formatMoney(total, lastCur)})`, async () => {
    const ids = new Set(created.map((c) => c.id));
    for (const c of created) await deleteTransaction(c.id);
    state.transactions = state.transactions.filter((x) => !ids.has(x.id));
    recompute();
    render();
    maybeAutoSync('push');
  });
}

function maskVal(formatted) {
  return state.hideHomeBalances ? '••••••' : formatted;
}

function renderEnvelopeCards(s) {
  const cur = s.currency || 'NGN';
  const daysLeft = getDaysRemainingInMonth(s.id);
  const spendableRem = s.balance.personal + s.balance.givings;
  const spendableCap = s.available.personal + s.available.givings;
  const spendableSpent = s.spent.personal + s.spent.givings;
  const dailyPace = daysLeft > 0 && spendableRem > 0
    ? `${maskVal(formatMoney(Math.round(spendableRem / daysLeft), cur))}/day safe to spend`
    : (daysLeft > 0 ? 'Spend limit exceeded' : `${s.label} closed`);

  const heroCard = `
    <section class="hero-wallet">
      <div class="hero-wallet-top">
        <div class="hero-wallet-label">
          <span>Available Spend (${s.label})</span>
          <button type="button" id="btn-toggle-home-eye" class="hero-eye-btn" aria-label="Toggle balance visibility">
            ${state.hideHomeBalances ? 'Show' : 'Hide'}
          </button>
        </div>
        <span style="font-size:0.76rem;opacity:0.9;">Personal + Givings • ${cur}</span>
      </div>
      <div class="hero-wallet-main">
        <div>
          <div class="hero-bal mono">${maskVal(formatMoney(spendableRem, cur))}</div>
          <div class="hero-sub mono">Spent ${maskVal(formatMoney(spendableSpent, cur))} of ${maskVal(formatMoney(spendableCap, cur))} • ${dailyPace}</div>
        </div>
        <button type="button" id="btn-hero-log" class="hero-cta">+ Log Expense</button>
      </div>
    </section>
  `;

  const cards = [
    { key: 'personal', label: 'Personal', rem: s.balance.personal, cap: s.available.personal, spent: s.spent.personal, bbf: s.bbf.personal },
    { key: 'givings', label: 'Givings', rem: s.balance.givings, cap: s.available.givings, spent: s.spent.givings, bbf: s.bbf.givings }
  ];

  const html = cards.map((c) => {
    const meta = BUCKET_META[c.key];
    const pct = c.cap > 0 ? Math.min(100, Math.max(0, Math.round((c.spent / c.cap) * 100))) : (c.spent > 0 ? 100 : 0);
    const isNeg = c.rem < 0;
    const pace = daysLeft > 0 && c.rem > 0 ? `${maskVal(formatMoney(Math.round(c.rem / daysLeft), cur))}/day` : (daysLeft > 0 ? 'Over' : `${pct}%`);
    const bbfText = c.bbf !== 0 ? ` • <span class="nowrap">BBF ${maskVal(formatMoney(c.bbf, cur, { plus: true }))}</span>` : '';
    return `
      <div class="envelope-card">
        <div class="envelope-head">
          <span><span class="dot" style="background:${meta.color}"></span>${c.label}</span>
          <span class="muted">${pace}</span>
        </div>
        <div class="envelope-val mono ${isNeg ? 'negative' : ''}">${maskVal(formatMoney(c.rem, cur))}</div>
        <div class="envelope-sub mono">Spent ${maskVal(formatMoney(c.spent, cur))} / ${maskVal(formatMoney(c.cap, cur))}${bbfText}</div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%;background:${isNeg ? 'var(--danger)' : meta.color}"></div>
        </div>
      </div>
    `;
  }).join('');

  const workCard = `
    <div class="envelope-card">
      <div class="envelope-head">
        <span><span class="dot" style="background:${BUCKET_META.work.color}"></span>Work Expenses</span>
        <span class="muted">Next month</span>
      </div>
      <div class="envelope-val mono">${maskVal(formatMoney(s.spent.work, cur))}</div>
      <div class="envelope-sub mono">Prev WE: ${maskVal(formatMoney(s.prevWorkSpent, cur))}</div>
      <div class="progress-track">
        <div class="progress-fill" style="width:100%;background:${BUCKET_META.work.color};opacity:0.5"></div>
      </div>
    </div>
  `;

  return `${heroCard}<div class="grid-3">${html}${workCard}</div>`;
}

function renderTxRows(txList, fallbackCur = 'NGN') {
  if (txList.length === 0) {
    return '<div class="empty-state">No entries match this view yet.</div>';
  }
  const avatarLetter = { personal: 'P', givings: 'G', work: 'W', investments: 'I' };
  return `<div class="tx-list">${txList.map((t) => {
    const cur = t.currency || getMonthCurrency(t.monthId) || fallbackCur;
    return `
    <div class="tx-row">
      <div class="tx-avatar pill-${t.bucket}">${avatarLetter[t.bucket] || getCurrencyMeta(cur).symbol}</div>
      <div>
        <div class="tx-desc">${escapeHtml(t.description)}</div>
        <div class="tx-meta">
          <span class="mono">${escapeHtml(t.date)}</span>
          <span>•</span>
          <span class="pill pill-${t.bucket}">${BUCKET_META[t.bucket].short}</span>
          ${t.tag ? `<span class="pill">#${escapeHtml(t.tag)}</span>` : ''}
          <span>• ${escapeHtml(t.paymentMethod || 'cash')}</span>
        </div>
      </div>
      <div class="tx-amt mono">-${formatMoney(t.amount, cur)}</div>
      <div class="tx-actions">
        <button class="icon-btn" data-edit-tx="${t.id}" title="Edit">Edit</button>
        <button class="icon-btn" data-del-tx="${t.id}" title="Delete">✕</button>
      </div>
    </div>
  `;
  }).join('')}</div>`;
}

function renderQuickView(main, s) {
  const recent = [...s.transactions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 15);

  const todayStr = new Date().toISOString().slice(0, 10);
  const suggestions = computeFrequentSuggestions(state.transactions, 12);
  const chipItems = suggestions.length > 0
    ? suggestions
    : state.chips.map((c) => ({
        key: c.label.toLowerCase(),
        label: c.description || c.label,
        amount: c.amount,
        count: 0,
        bucketCounts: { personal: 0, givings: 0, work: 0, investments: 0 },
        recommendedBucket: c.bucket,
        paymentMethod: c.paymentMethod || 'cash',
        tag: c.tag || 'gifts'
      }));

  const cur = s.currency || 'NGN';
  const sym = getCurrencyMeta(cur).symbol;
  const lendSummary = computeLendingSummary(state.lending, cur);
  const isLendingMode = state.quickLogMode === 'lending';

  main.innerHTML = `
    ${renderEnvelopeCards(s)}

    <section class="card">
      <div class="card-title">
        <span>${isLendingMode ? 'Log Lending / Repaid' : '3-Second Quick Log'}</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <button type="button" class="bucket-pill-btn ${!isLendingMode ? 'active' : ''}" data-qmode="expense">Expense</button>
          <button type="button" class="bucket-pill-btn ${isLendingMode ? 'active' : ''}" data-qmode="lending">Lending / Repaid</button>
        </div>
      </div>

      ${isLendingMode ? `
        <div class="muted" style="font-size:0.8rem;margin-bottom:10px;">
          Currently owed in ${cur}: <strong class="mono ${lendSummary.totalNetOwed > 0 ? 'positive' : ''}">${formatMoney(lendSummary.totalNetOwed, cur)}</strong>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>Person</label>
            <input id="ql-lend-person" type="text" placeholder="e.g. Alex" />
          </div>
          <div class="field">
            <label>Amount (${sym})</label>
            <input id="ql-lend-amount" type="number" min="1" placeholder="5000" />
          </div>
          <div class="field">
            <label>Direction</label>
            <select id="ql-lend-dir">
              <option value="lent">Lent Out</option>
              <option value="repaid">Repaid to Me</option>
            </select>
          </div>
          <div class="field">
            <label>Currency</label>
            <select id="ql-lend-cur">${currencyOptionsHtml(cur)}</select>
          </div>
          <div class="field">
            <label>Date</label>
            ${renderDateFieldHtml('ql-lend-date', todayStr)}
          </div>
          <div class="field">
            <label>Note</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <input id="ql-lend-note" type="text" placeholder="Reason..." style="flex:1;min-width:120px;" />
              <button type="button" id="btn-ql-add-lend" class="btn btn-accent">Save Lending</button>
            </div>
          </div>
        </div>
      ` : `
        <div class="muted" style="font-size:0.76rem;margin-bottom:8px;">
          Separate multiple with commas or new lines (e.g. "200 egg, 500 bread, 6k fuel work")
        </div>
        <div class="quick-input-wrap">
          <textarea id="quick-input" class="quick-input" rows="1" placeholder="200 egg, 500 bread, 6k fuel" autocomplete="off"></textarea>
          <button id="btn-quick-add" class="btn btn-accent">Log Expense</button>
          <button id="btn-full-add" class="btn btn-ghost">+ Detailed</button>
        </div>

        <div id="quick-preview" class="preview-strip hidden"></div>

        <div style="margin-top:12px;">
          <div class="muted" style="font-size:0.76rem;margin-bottom:6px;">
            Frequent inputs (tap to choose category):
          </div>
          <div class="chips-grid" id="chips-grid" style="margin-top:0;">
            ${chipItems.map((item, idx) => `
              <button class="speed-chip" data-suggest-idx="${idx}">
                <span>${escapeHtml(item.label)}</span>
                <span class="mono muted">${formatMoney(item.amount, cur)}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `}
    </section>

    <section class="card">
      <div class="card-title">
        <span>Recent in ${s.label} (${s.txCount})</span>
        <button class="btn btn-ghost btn-sm" id="btn-view-all-ledger">View All →</button>
      </div>
      ${renderTxRows(recent, cur)}
    </section>
  `;

  main.querySelectorAll('[data-qmode]').forEach((btn) => {
    btn.onclick = () => {
      state.quickLogMode = btn.dataset.qmode;
      render();
    };
  });

  document.getElementById('btn-toggle-home-eye').onclick = () => {
    state.hideHomeBalances = !state.hideHomeBalances;
    render();
  };
  document.getElementById('btn-view-all-ledger').onclick = () => {
    state.activeView = 'ledger';
    render();
  };

  if (isLendingMode) {
    const lendCard = main.querySelector('.card');
    const lendDateField = bindDateField(lendCard, 'ql-lend-date');
    document.getElementById('btn-hero-log').onclick = () => {
      state.quickLogMode = 'expense';
      render();
    };
    document.getElementById('btn-ql-add-lend').onclick = async () => {
      const person = document.getElementById('ql-lend-person').value.trim();
      const amount = Number(document.getElementById('ql-lend-amount').value);
      const direction = document.getElementById('ql-lend-dir').value;
      const lendCur = document.getElementById('ql-lend-cur').value || cur;
      const date = lendDateField.getValue();
      const note = document.getElementById('ql-lend-note').value.trim();
      if (!date) return showToast('Enter a valid date (e.g. 2026-11-25 or 25/11/2026).');
      if (!person || !(amount > 0)) return showToast('Enter a person and valid amount.');
      const entry = { id: uid('lend'), person, currency: lendCur, amount, direction, date, note };
      await saveLending(entry);
      state.lending.push(entry);
      render();
      maybeAutoSync('push');
      showToast(`${direction === 'repaid' ? 'Repayment' : 'Lent'} ${formatMoney(amount, lendCur)} (${person}) saved.`, async () => {
        await deleteLending(entry.id);
        state.lending = state.lending.filter((l) => l.id !== entry.id);
        render();
        maybeAutoSync('push');
      });
    };
    bindTxActions(main);
    return;
  }

  const input = document.getElementById('quick-input');
  const preview = document.getElementById('quick-preview');
  const addBtn = document.getElementById('btn-quick-add');
  let drafts = [];

  const renderPreview = () => {
    if (drafts.length === 0) {
      addBtn.textContent = 'Log Expense';
      return;
    }
    if (drafts.length === 1) {
      const d = drafts[0];
      addBtn.textContent = 'Log Expense';
      preview.classList.remove('hidden');
      preview.innerHTML = `
        <div>
          <strong class="mono">${formatMoney(d.amount, cur)}</strong> — <span>${escapeHtml(d.description)}</span>
          <span class="pill pill-${d.bucket}">${BUCKET_META[d.bucket].short}</span>
          <span class="muted" style="font-size:0.78rem;">(${d.date})</span>
        </div>
        <div class="preview-controls">
          <select data-d-bucket="0">
            ${BUCKETS.map((b) => `<option value="${b}" ${d.bucket === b ? 'selected' : ''}>${BUCKET_META[b].short}</option>`).join('')}
          </select>
          <select data-d-tag="0" class="${d.bucket === 'givings' ? '' : 'hidden'}">
            ${GIVINGS_TAGS.map((t) => `<option value="${t.id}" ${d.tag === t.id ? 'selected' : ''}>#${t.id}</option>`).join('')}
          </select>
          <select data-d-method="0">
            <option value="cash" ${d.paymentMethod === 'cash' ? 'selected' : ''}>Cash</option>
            <option value="transfer" ${d.paymentMethod === 'transfer' ? 'selected' : ''}>Transfer</option>
            <option value="card" ${d.paymentMethod === 'card' ? 'selected' : ''}>Card/POS</option>
          </select>
        </div>
      `;
    } else {
      const total = drafts.reduce((sum, x) => sum + x.amount, 0);
      addBtn.textContent = `Log ${drafts.length} Expenses`;
      preview.classList.remove('hidden');
      preview.innerHTML = `
        <div style="width:100%;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="font-size:0.84rem;">${drafts.length} expenses detected</strong>
            <span class="mono" style="font-weight:700;color:var(--accent);">Total ${formatMoney(total, cur)}</span>
          </div>
          <div class="tx-list">
            ${drafts.map((d, idx) => `
              <div class="batch-preview-row">
                <div>
                  <strong class="mono">${formatMoney(d.amount, cur)}</strong>
                  <span>${escapeHtml(d.description)}</span>
                </div>
                <div class="preview-controls">
                  <select data-d-bucket="${idx}">
                    ${BUCKETS.map((b) => `<option value="${b}" ${d.bucket === b ? 'selected' : ''}>${BUCKET_META[b].short}</option>`).join('')}
                  </select>
                  <select data-d-tag="${idx}" class="${d.bucket === 'givings' ? '' : 'hidden'}">
                    ${GIVINGS_TAGS.map((t) => `<option value="${t.id}" ${d.tag === t.id ? 'selected' : ''}>#${t.id}</option>`).join('')}
                  </select>
                  <select data-d-method="${idx}">
                    <option value="cash" ${d.paymentMethod === 'cash' ? 'selected' : ''}>Cash</option>
                    <option value="transfer" ${d.paymentMethod === 'transfer' ? 'selected' : ''}>Transfer</option>
                    <option value="card" ${d.paymentMethod === 'card' ? 'selected' : ''}>Card/POS</option>
                  </select>
                  <button type="button" class="icon-btn" data-d-del="${idx}" title="Remove">✕</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    preview.querySelectorAll('[data-d-bucket]').forEach((sel) => {
      sel.onchange = (e) => {
        const idx = Number(sel.dataset.dBucket);
        drafts[idx].bucket = e.target.value;
        if (drafts[idx].bucket === 'givings' && !drafts[idx].tag) drafts[idx].tag = 'gifts';
        renderPreview();
      };
    });
    preview.querySelectorAll('[data-d-tag]').forEach((sel) => {
      sel.onchange = (e) => { drafts[Number(sel.dataset.dTag)].tag = e.target.value; };
    });
    preview.querySelectorAll('[data-d-method]').forEach((sel) => {
      sel.onchange = (e) => { drafts[Number(sel.dataset.dMethod)].paymentMethod = e.target.value; };
    });
    preview.querySelectorAll('[data-d-del]').forEach((btn) => {
      btn.onclick = () => {
        drafts.splice(Number(btn.dataset.dDel), 1);
        if (drafts.length === 0) preview.classList.add('hidden');
        renderPreview();
      };
    });
  };

  const updatePreview = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(120, input.scrollHeight)}px`;

    const val = input.value.trim();
    if (!val) {
      drafts = [];
      addBtn.textContent = 'Log Expense';
      preview.classList.add('hidden');
      return;
    }
    const parsedList = parseQuickBatch(val, state.customRules);
    if (parsedList.length === 0) {
      drafts = [];
      addBtn.textContent = 'Log Expense';
      preview.classList.remove('hidden');
      preview.innerHTML = `<span class="muted">Include an amount (e.g. <code>200 egg, 500 bread</code>) or paste bank alerts.</span>`;
      return;
    }
    drafts = parsedList.map((p) => ({ ...p, date: p.source === 'alert' ? p.date : todayStr }));
    renderPreview();
  };

  input.oninput = updatePreview;
  input.onkeydown = async (e) => {
    if (e.key === 'Enter' && !e.shiftKey && drafts.length > 0) {
      e.preventDefault();
      await addTransactionsBatch(drafts);
    }
  };
  addBtn.onclick = async () => {
    if (drafts.length > 0) await addTransactionsBatch(drafts);
    else openTransactionModal({ date: todayStr });
  };
  document.getElementById('btn-hero-log').onclick = () => {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  document.getElementById('btn-full-add').onclick = () => openTransactionModal({ date: todayStr });

  main.querySelectorAll('[data-suggest-idx]').forEach((btn) => {
    btn.onclick = () => {
      const item = chipItems[Number(btn.dataset.suggestIdx)];
      if (item) openQuickCategoryPopup(item, todayStr, cur);
    };
  });

  bindTxActions(main);
}

function openQuickCategoryPopup(item, defaultDate, cur = 'NGN') {
  const sym = getCurrencyMeta(cur).symbol;
  let selectedTag = item.tag || 'gifts';
  openModal(`
    <h3 style="margin:0 0 4px;">Log "${escapeHtml(item.label)}"</h3>
    <div class="muted" style="font-size:0.8rem;margin-bottom:12px;">
      ${item.count > 0 ? `Logged ${item.count}× in your history — choose which category for this entry:` : 'Choose which category for this entry:'}
    </div>
    <div class="form-grid">
      <div class="field">
        <label>Amount (${sym})</label>
        <input id="pop-amt" type="number" step="0.01" value="${item.amount}" />
      </div>
      <div class="field">
        <label>Payment Method</label>
        <select id="pop-method">
          <option value="cash" ${item.paymentMethod === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="transfer" ${item.paymentMethod === 'transfer' ? 'selected' : ''}>Transfer</option>
          <option value="card" ${item.paymentMethod === 'card' ? 'selected' : ''}>Card / POS</option>
        </select>
      </div>
      <div class="field" style="grid-column:1 / -1;">
        <label>Date (type YYYY-MM-DD, 25/11/2026, "25 Nov" or pick on calendar)</label>
        ${renderDateFieldHtml('pop-date', defaultDate)}
      </div>
    </div>

    <div style="margin-top:12px;">
      <div class="muted" style="font-size:0.75rem;margin-bottom:5px;">If Givings, tag as:</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;" id="pop-tags">
        ${GIVINGS_TAGS.map((t) => `
          <button type="button" class="bucket-pill-btn ${selectedTag === t.id ? 'active' : ''}" data-pop-tag="${t.id}">
            #${t.id}
          </button>
        `).join('')}
      </div>
    </div>

    <div class="category-pick-grid">
      ${['personal', 'givings', 'work', 'investments'].map((b) => {
        const prevCount = item.bucketCounts?.[b] || 0;
        const isRec = item.recommendedBucket === b && item.count > 0;
        return `
          <button type="button" class="category-pick-btn ${isRec ? 'is-recommended' : ''}" data-pick-bucket="${b}">
            <div class="category-pick-title">
              <span class="dot" style="background:${BUCKET_META[b].color}"></span>
              <span>${BUCKET_META[b].label}</span>
            </div>
            <div class="category-pick-sub">
              ${isRec ? `Recommended (${prevCount}×)` : (prevCount > 0 ? `Used ${prevCount}×` : 'Tap to log here')}
            </div>
          </button>
        `;
      }).join('')}
    </div>

    <div style="display:flex;justify-content:flex-end;margin-top:14px;">
      <button id="pop-cancel" class="btn btn-ghost btn-sm">Cancel</button>
    </div>
  `, (card) => {
    const popDateField = bindDateField(card, 'pop-date');
    card.querySelectorAll('[data-pop-tag]').forEach((tBtn) => {
      tBtn.onclick = () => {
        selectedTag = tBtn.dataset.popTag;
        card.querySelectorAll('[data-pop-tag]').forEach((b) => b.classList.toggle('active', b === tBtn));
      };
    });

    card.querySelectorAll('[data-pick-bucket]').forEach((bBtn) => {
      bBtn.onclick = async () => {
        const bucket = bBtn.dataset.pickBucket;
        const amount = Number(card.querySelector('#pop-amt').value);
        const paymentMethod = card.querySelector('#pop-method').value;
        const date = popDateField.getValue();
        if (!date) return showToast('Enter a valid date (e.g. 2026-11-25 or 25/11/2026).');
        if (!(amount > 0)) return showToast('Enter a valid amount.');
        closeModal();
        await addTransaction({
          date,
          monthId: date.slice(0, 7),
          currency: cur,
          bucket,
          description: item.label,
          amount,
          paymentMethod,
          tag: bucket === 'givings' ? selectedTag : '',
          source: 'chip'
        });
      };
    });

    card.querySelector('#pop-cancel').onclick = closeModal;
  });
}

function getFilteredTransactions(s) {
  return s.transactions.filter((t) => {
    if (state.filters.bucket !== 'all' && t.bucket !== state.filters.bucket) return false;
    if (state.filters.method !== 'all' && (t.paymentMethod || 'cash') !== state.filters.method) return false;
    if (state.filters.tag !== 'all' && t.tag !== state.filters.tag) return false;
    if (state.filters.search && !t.description.toLowerCase().includes(state.filters.search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));
}

function renderLedgerView(main, s) {
  const cur = getMonthCurrency(s.id);
  const filtered = getFilteredTransactions(s);
  const lendMonth = computeLendingForMonth(state.lending, s.id, cur);

  const renderFilteredBody = (list) => {
    if (list.length > 0) return renderTxRows(list, cur);
    const hasFilter = state.filters.bucket !== 'all' || state.filters.method !== 'all' || state.filters.tag !== 'all' || Boolean(state.filters.search.trim());
    const maybeExpense = parseQuickBatch(state.filters.search, state.customRules);
    return `
      <div class="empty-state">
        <div>${hasFilter ? 'No transactions match these filters.' : 'No transactions logged in this month yet.'}</div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px;">
          ${maybeExpense.length > 0 ? `<button type="button" class="btn btn-accent btn-sm" id="btn-filter-log-instead">+ Log "${escapeHtml(state.filters.search.trim())}" as Expense</button>` : ''}
          ${hasFilter ? `<button type="button" class="btn btn-ghost btn-sm" id="btn-clear-filters">Reset Filters</button>` : ''}
        </div>
      </div>
    `;
  };

  main.innerHTML = `
    <section class="card">
      <div class="card-title">
        <span>${s.label} — Income Waterfall & Envelopes</span>
        <button class="btn btn-ghost btn-sm" id="btn-edit-income">Set Up in Settings →</button>
      </div>
      <div class="muted" style="font-size:0.84rem;margin-bottom:10px;">
        Net <strong class="mono">${formatMoney(s.netIncome, cur)}</strong> − Prev Work <strong class="mono">${formatMoney(s.prevWorkSpent, cur)}</strong> = Distributable <strong class="mono">${formatMoney(s.distributable, cur)}</strong>
      </div>
      <div style="overflow-x:auto;">
        <table class="waterfall-table">
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Allocated</th>
              <th>Auto BBF</th>
              <th>Available</th>
              <th>Spent</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody class="mono">
            ${['personal', 'givings'].map((k) => `
              <tr>
                <td><span class="dot" style="background:${BUCKET_META[k].color}"></span>${BUCKET_META[k].label}</td>
                <td>${formatMoney(s.alloc[k], cur)}</td>
                <td class="${s.bbf[k] < 0 ? 'negative' : (s.bbf[k] > 0 ? 'positive' : '')}">${formatMoney(s.bbf[k], cur, { plus: true })}</td>
                <td>${formatMoney(s.available[k], cur)}</td>
                <td>${formatMoney(s.spent[k], cur)}</td>
                <td class="${s.balance[k] < 0 ? 'negative' : 'positive'}"><strong>${formatMoney(s.balance[k], cur)}</strong></td>
              </tr>
            `).join('')}
            <tr>
              <td><span class="dot" style="background:${BUCKET_META.investments.color}"></span>${BUCKET_META.investments.label}</td>
              <td class="muted">••••••</td>
              <td class="muted">••••••</td>
              <td class="muted">••••••</td>
              <td>${formatMoney(s.spent.investments, cur)}</td>
              <td><button type="button" class="btn btn-ghost btn-sm" id="btn-jump-insights">View in Insights →</button></td>
            </tr>
            <tr>
              <td><span class="dot" style="background:${BUCKET_META.work.color}"></span>Work Expenses</td>
              <td class="muted">Off top</td>
              <td class="muted">—</td>
              <td class="muted">—</td>
              <td>${formatMoney(s.spent.work, cur)}</td>
              <td class="muted">Deducted next month</td>
            </tr>
            <tr id="row-lending-bucket" style="cursor:pointer;" title="Click to open Lending Details">
              <td><span class="dot" style="background:#ec4899"></span><strong>Lending</strong></td>
              <td class="muted">Separate</td>
              <td class="${lendMonth.carriedUnpaid > 0 ? 'negative' : 'muted'}">${lendMonth.carriedUnpaid > 0 ? formatMoney(lendMonth.carriedUnpaid, cur) : formatMoney(0, cur)}</td>
              <td>${formatMoney(lendMonth.lentThisMonth, cur)}</td>
              <td class="positive">${formatMoney(lendMonth.repaidThisMonth, cur)}</td>
              <td>
                <span class="${lendMonth.endingOwed > 0 ? 'negative' : 'positive'}" style="margin-right:8px;">
                  <strong>${lendMonth.endingOwed > 0 ? `${formatMoney(lendMonth.endingOwed, cur)} owed` : 'Paid'}</strong>
                </span>
                <button type="button" class="btn btn-ghost btn-sm" id="btn-open-lending-page">Details →</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-title">
        <span id="ledger-tx-count">Transactions (${filtered.length})</span>
        <button class="btn btn-accent btn-sm" id="btn-ledger-add">+ Add Entry</button>
      </div>
      <div class="filter-bar">
        <input id="f-search" type="search" placeholder="Filter existing transactions..." value="${escapeHtml(state.filters.search)}" />
        <select id="f-bucket" aria-label="Filter by bucket">
          <option value="all">Bucket: All</option>
          ${BUCKETS.map((b) => `<option value="${b}" ${state.filters.bucket === b ? 'selected' : ''}>Bucket: ${BUCKET_META[b].short}</option>`).join('')}
        </select>
        <select id="f-method" aria-label="Filter by method">
          <option value="all">Method: All</option>
          <option value="cash" ${state.filters.method === 'cash' ? 'selected' : ''}>Method: Cash</option>
          <option value="transfer" ${state.filters.method === 'transfer' ? 'selected' : ''}>Method: Transfer</option>
          <option value="card" ${state.filters.method === 'card' ? 'selected' : ''}>Method: Card/POS</option>
        </select>
        <select id="f-tag" aria-label="Filter by tag">
          <option value="all">Tag: All</option>
          ${GIVINGS_TAGS.map((t) => `<option value="${t.id}" ${state.filters.tag === t.id ? 'selected' : ''}>Tag: #${t.id}</option>`).join('')}
        </select>
      </div>
      <div id="ledger-tx-list">${renderFilteredBody(filtered)}</div>
    </section>
  `;

  document.getElementById('btn-edit-income').onclick = () => { state.activeView = 'settings'; render(); };
  document.getElementById('btn-jump-insights').onclick = () => { state.activeView = 'insights'; render(); };
  document.getElementById('row-lending-bucket').onclick = () => { state.activeView = 'lending'; render(); };
  document.getElementById('btn-ledger-add').onclick = () => openTransactionModal({
    date: `${s.id}-01` > new Date().toISOString().slice(0, 10) ? `${s.id}-01` : new Date().toISOString().slice(0, 10)
  });

  const bindEmptyActions = (listWrap) => {
    const clearBtn = listWrap.querySelector('#btn-clear-filters');
    if (clearBtn) {
      clearBtn.onclick = () => {
        state.filters = { bucket: 'all', method: 'all', tag: 'all', search: '' };
        render();
      };
    }
    const logInsteadBtn = listWrap.querySelector('#btn-filter-log-instead');
    if (logInsteadBtn) {
      logInsteadBtn.onclick = async () => {
        const parsed = parseQuickBatch(state.filters.search, state.customRules);
        if (parsed.length === 0) return;
        const targetBucket = state.filters.bucket !== 'all' ? state.filters.bucket : parsed[0].bucket;
        const targetMethod = state.filters.method !== 'all' ? state.filters.method : parsed[0].paymentMethod;
        const targetTag = targetBucket === 'givings' ? (state.filters.tag !== 'all' ? state.filters.tag : parsed[0].tag) : '';
        const defaultDate = `${s.id}-01` > new Date().toISOString().slice(0, 10) ? `${s.id}-01` : new Date().toISOString().slice(0, 10);
        const items = parsed.map((p) => ({
          ...p,
          bucket: state.filters.bucket !== 'all' ? state.filters.bucket : p.bucket,
          paymentMethod: state.filters.method !== 'all' ? state.filters.method : p.paymentMethod,
          tag: (state.filters.bucket !== 'all' ? state.filters.bucket : p.bucket) === 'givings' ? targetTag : '',
          date: defaultDate,
          monthId: s.id
        }));
        state.filters = { bucket: 'all', method: 'all', tag: 'all', search: '' };
        await addTransactionsBatch(items);
      };
    }
  };

  const refreshListOnly = () => {
    const nextFiltered = getFilteredTransactions(s);
    document.getElementById('ledger-tx-count').textContent = `Transactions (${nextFiltered.length})`;
    const listWrap = document.getElementById('ledger-tx-list');
    listWrap.innerHTML = renderFilteredBody(nextFiltered);
    bindTxActions(listWrap);
    bindEmptyActions(listWrap);
  };

  document.getElementById('f-search').oninput = (e) => { state.filters.search = e.target.value; refreshListOnly(); };
  document.getElementById('f-bucket').onchange = (e) => { state.filters.bucket = e.target.value; refreshListOnly(); };
  document.getElementById('f-method').onchange = (e) => { state.filters.method = e.target.value; refreshListOnly(); };
  document.getElementById('f-tag').onchange = (e) => { state.filters.tag = e.target.value; refreshListOnly(); };
  const initialListWrap = document.getElementById('ledger-tx-list');
  bindTxActions(initialListWrap);
  bindEmptyActions(initialListWrap);
}

function renderInsightsView(main, s) {
  const cur = getMonthCurrency(s.id);
  const allList = [...summaries.values()].filter((m) => !m.isBaselineOnly && (m.currency || 'NGN') === cur);
  const totalInvAlloc = allList.reduce((acc, m) => acc + m.alloc.investments, 0);
  const totalInvSpent = allList.reduce((acc, m) => acc + m.spent.investments, 0);
  const netReserve = totalInvAlloc - totalInvSpent;

  const lendSummary = computeLendingSummary(state.lending, cur);
  const curLending = state.lending.filter((l) => (l.currency || 'NGN') === cur);

  main.innerHTML = `
    <section class="card">
      <div class="card-title">
        <span>Income vs. Spending Trend (${cur})</span>
        <span class="muted" style="font-size:0.78rem;">Blue outline = Net Income | Stacked = Spend</span>
      </div>
      ${renderMonthlyTrendSvg(allList, cur)}
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-title">
          <span>Where Givings Went (${s.label})</span>
          <span class="mono muted">${formatMoney(s.spent.givings, cur)}</span>
        </div>
        ${renderGivingsTagBreakdown(s.givingsByTag, cur)}
      </section>

      <section class="card">
        <div class="card-title">
          <span>Investments & Reserves (${cur})</span>
          <button type="button" id="btn-toggle-inv-mask" class="btn btn-ghost btn-sm">Hide</button>
        </div>
        <div id="inv-privacy-body">
          <div class="envelope-val mono ${netReserve < 0 ? 'negative' : 'positive'}" style="margin-bottom:8px;">
            ${formatMoney(netReserve, cur)}
          </div>
          <div class="muted" style="font-size:0.82rem;line-height:1.6;">
            <strong>${s.label}:</strong> Alloc <span class="mono">${formatMoney(s.alloc.investments, cur)}</span> •
            BBF <span class="mono">${formatMoney(s.bbf.investments, cur, { plus: true })}</span> •
            Spent <span class="mono">${formatMoney(s.spent.investments, cur)}</span> •
            Left <strong class="mono">${formatMoney(s.balance.investments, cur)}</strong><br/>
            <strong>All-Time (${cur}):</strong> Allocated <span class="mono">${formatMoney(totalInvAlloc, cur)}</span> • Spent <span class="mono">${formatMoney(totalInvSpent, cur)}</span>
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-title">
        <span>Lending / Receivables (${cur})</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="mono ${lendSummary.totalNetOwed > 0 ? 'positive' : ''}">Owed: ${formatMoney(lendSummary.totalNetOwed, cur)}</span>
          <button type="button" id="btn-insights-lending-page" class="btn btn-ghost btn-sm">Details →</button>
          <button type="button" id="btn-insights-log-lend" class="btn btn-ghost btn-sm">+ Log</button>
        </div>
      </div>

      ${lendSummary.people.length === 0 ? `<div class="empty-state">No ${cur} lending records yet.</div>` : lendSummary.people.map((p) => `
        <div class="tx-row" style="margin-bottom:4px;">
          <div class="tx-avatar pill-givings">${escapeHtml((p.person || 'L')[0].toUpperCase())}</div>
          <div>
            <div class="tx-desc">${escapeHtml(p.person)}</div>
            <div class="tx-meta">Lent ${formatMoney(p.lent, p.currency || cur)} • Repaid ${formatMoney(p.repaid, p.currency || cur)}</div>
          </div>
          <div class="tx-amt mono ${p.netOwed > 0 ? 'positive' : ''}">${formatMoney(p.netOwed, p.currency || cur)}</div>
          <div></div>
        </div>
      `).join('')}

      <div class="tx-list" style="margin-top:8px;">
        ${curLending.map((l) => `
          <div class="tx-row">
            <div class="tx-avatar ${l.direction === 'repaid' ? 'pill-personal' : 'pill-investments'}">${l.direction === 'repaid' ? '+' : '−'}</div>
            <div>
              <div class="tx-desc">${escapeHtml(l.person)} — <span class="muted">${escapeHtml(l.note || l.direction)}</span></div>
              <div class="tx-meta mono">${escapeHtml(l.date)}</div>
            </div>
            <div class="tx-amt mono ${l.direction === 'repaid' ? 'positive' : ''}">${l.direction === 'repaid' ? '+' : '-'}${formatMoney(l.amount, l.currency || 'NGN')}</div>
            <button class="icon-btn" data-del-lend="${l.id}">✕</button>
          </div>
        `).join('')}
      </div>
    </section>
  `;

  let invMasked = false;
  document.getElementById('btn-toggle-inv-mask').onclick = () => {
    invMasked = !invMasked;
    document.getElementById('btn-toggle-inv-mask').textContent = invMasked ? 'Show' : 'Hide';
    document.getElementById('inv-privacy-body').style.filter = invMasked ? 'blur(7px)' : 'none';
  };

  document.getElementById('btn-insights-lending-page').onclick = () => {
    state.activeView = 'lending';
    render();
  };

  document.getElementById('btn-insights-log-lend').onclick = () => {
    state.activeView = 'quick';
    state.quickLogMode = 'lending';
    render();
  };

  main.querySelectorAll('[data-del-lend]').forEach((btn) => {
    btn.onclick = async () => {
      await deleteLending(btn.dataset.delLend);
      state.lending = state.lending.filter((l) => l.id !== btn.dataset.delLend);
      render();
      maybeAutoSync('push');
    };
  });
}

function renderLendingDetailsView(main, s) {
  const cur = getMonthCurrency(s.id);
  const lendSummary = computeLendingSummary(state.lending, cur);
  const lendMonth = computeLendingForMonth(state.lending, s.id, cur);
  const sortedEntries = state.lending
    .filter((l) => (l.currency || 'NGN') === cur)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  main.innerHTML = `
    <section class="card">
      <div class="card-title">
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" id="btn-back-transactions" class="btn btn-ghost btn-sm">← Back</button>
          <span>Lending & Debt Details (${cur})</span>
        </div>
        <button type="button" id="btn-lending-add-new" class="btn btn-accent btn-sm">+ Log Lending / Repaid</button>
      </div>

      <div class="grid-3" style="margin-bottom:0;">
        <div class="envelope-card" style="box-shadow:none;background:var(--surface-2);">
          <div class="envelope-head"><span>Unpaid Carried (${s.label})</span></div>
          <div class="envelope-val mono ${lendMonth.endingOwed > 0 ? 'negative' : 'positive'}">${formatMoney(lendMonth.endingOwed, cur)}</div>
          <div class="envelope-sub mono">Carried in: ${formatMoney(lendMonth.carriedUnpaid, cur)}</div>
        </div>
        <div class="envelope-card" style="box-shadow:none;background:var(--surface-2);">
          <div class="envelope-head"><span>Total Lent (${cur})</span></div>
          <div class="envelope-val mono">${formatMoney(lendSummary.totalLent, cur)}</div>
          <div class="envelope-sub mono">In ${s.label}: ${formatMoney(lendMonth.lentThisMonth, cur)}</div>
        </div>
        <div class="envelope-card" style="box-shadow:none;background:var(--surface-2);">
          <div class="envelope-head"><span>Total Repaid (${cur})</span></div>
          <div class="envelope-val mono positive">${formatMoney(lendSummary.totalRepaid, cur)}</div>
          <div class="envelope-sub mono">In ${s.label}: ${formatMoney(lendMonth.repaidThisMonth, cur)}</div>
        </div>
      </div>
      <div class="muted" style="font-size:0.78rem;margin-top:10px;">
        Unpaid debts automatically carry forward into every subsequent ${cur} month until marked repaid.
      </div>
    </section>

    <section class="card">
      <div class="card-title"><span>By Person (${cur})</span></div>
      ${lendSummary.people.length === 0 ? `<div class="empty-state">No ${cur} lending records yet.</div>` : `
        <div class="tx-list">
          ${lendSummary.people.map((p, idx) => {
            const pCur = p.currency || cur;
            return `
            <div class="tx-row">
              <div class="tx-avatar ${p.netOwed > 0 ? 'pill-investments' : 'pill-personal'}">${escapeHtml((p.person || 'L')[0].toUpperCase())}</div>
              <div>
                <div class="tx-desc">${escapeHtml(p.person)} ${p.netOwed <= 0 ? '<span class="pill pill-personal">Paid</span>' : ''}</div>
                <div class="tx-meta mono">Lent ${formatMoney(p.lent, pCur)} • Repaid ${formatMoney(p.repaid, pCur)}</div>
              </div>
              <div class="tx-amt mono ${p.netOwed > 0 ? 'negative' : 'positive'}">${p.netOwed > 0 ? `${formatMoney(p.netOwed, pCur)} owed` : 'Settled'}</div>
              <div class="tx-actions">
                ${p.netOwed > 0 ? `
                  <button type="button" class="btn btn-accent btn-sm" data-mark-repaid="${idx}">Mark Repaid</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-partial-repay="${idx}">Partial</button>
                ` : ''}
              </div>
            </div>
          `;
          }).join('')}
        </div>
      `}
    </section>

    <section class="card">
      <div class="card-title"><span>Lending History (${sortedEntries.length})</span></div>
      ${sortedEntries.length === 0 ? '<div class="empty-state">No entries yet.</div>' : `
        <div class="tx-list">
          ${sortedEntries.map((l) => `
            <div class="tx-row">
              <div class="tx-avatar ${l.direction === 'repaid' ? 'pill-personal' : 'pill-investments'}">${l.direction === 'repaid' ? '+' : '−'}</div>
              <div>
                <div class="tx-desc">${escapeHtml(l.person)} — <span class="muted">${escapeHtml(l.note || (l.direction === 'repaid' ? 'Repayment' : 'Lent out'))}</span></div>
                <div class="tx-meta mono">${escapeHtml(l.date)} • ${l.direction === 'repaid' ? 'Repaid' : 'Lent Out'}</div>
              </div>
              <div class="tx-amt mono ${l.direction === 'repaid' ? 'positive' : ''}">${l.direction === 'repaid' ? '+' : '-'}${formatMoney(l.amount, l.currency || 'NGN')}</div>
              <button class="icon-btn" data-del-lend="${l.id}">✕</button>
            </div>
          `).join('')}
        </div>
      `}
    </section>
  `;

  document.getElementById('btn-back-transactions').onclick = () => {
    state.activeView = 'ledger';
    render();
  };
  document.getElementById('btn-lending-add-new').onclick = () => {
    state.activeView = 'quick';
    state.quickLogMode = 'lending';
    render();
  };

  const recordRepayment = async (person, amount, note, entryCur = cur) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const entry = { id: uid('lend'), person, currency: entryCur, amount, direction: 'repaid', date: todayStr, note };
    await saveLending(entry);
    state.lending.push(entry);
    render();
    maybeAutoSync('push');
    showToast(`Marked ${formatMoney(amount, entryCur)} repaid by ${person}.`, async () => {
      await deleteLending(entry.id);
      state.lending = state.lending.filter((l) => l.id !== entry.id);
      render();
      maybeAutoSync('push');
    });
  };

  main.querySelectorAll('[data-mark-repaid]').forEach((btn) => {
    btn.onclick = async () => {
      const p = lendSummary.people[Number(btn.dataset.markRepaid)];
      if (!p || p.netOwed <= 0) return;
      await recordRepayment(p.person, p.netOwed, 'Full repayment', p.currency || cur);
    };
  });

  main.querySelectorAll('[data-partial-repay]').forEach((btn) => {
    btn.onclick = () => {
      const p = lendSummary.people[Number(btn.dataset.partialRepay)];
      if (!p || p.netOwed <= 0) return;
      const pCur = p.currency || cur;
      const pSym = getCurrencyMeta(pCur).symbol;
      const todayStr = new Date().toISOString().slice(0, 10);
      openModal(`
        <h3 style="margin:0 0 12px;">Repayment from ${escapeHtml(p.person)}</h3>
        <div class="muted" style="font-size:0.82rem;margin-bottom:10px;">Currently owed: <strong class="mono">${formatMoney(p.netOwed, pCur)}</strong></div>
        <div class="form-grid">
          <div class="field">
            <label>Repaid Amount (${pSym})</label>
            <input id="pr-amt" type="number" step="0.01" min="0.01" max="${p.netOwed}" value="${p.netOwed}" />
          </div>
          <div class="field">
            <label>Date</label>
            ${renderDateFieldHtml('pr-date', todayStr)}
          </div>
          <div class="field" style="grid-column:1 / -1;">
            <label>Note</label>
            <input id="pr-note" type="text" placeholder="Partial repayment" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button id="pr-cancel" class="btn btn-ghost">Cancel</button>
          <button id="pr-save" class="btn btn-accent">Save Repayment</button>
        </div>
      `, (card) => {
        const prDate = bindDateField(card, 'pr-date');
        card.querySelector('#pr-cancel').onclick = closeModal;
        card.querySelector('#pr-save').onclick = async () => {
          const amt = Number(card.querySelector('#pr-amt').value);
          const date = prDate.getValue();
          const note = card.querySelector('#pr-note').value.trim() || 'Repayment';
          if (!date) return showToast('Enter a valid date.');
          if (!(amt > 0)) return showToast('Enter a valid amount.');
          closeModal();
          const entry = { id: uid('lend'), person: p.person, currency: pCur, amount: amt, direction: 'repaid', date, note };
          await saveLending(entry);
          state.lending.push(entry);
          render();
          maybeAutoSync('push');
          showToast(`Recorded ${formatMoney(amt, pCur)} repaid by ${p.person}.`);
        };
      });
    };
  });

  main.querySelectorAll('[data-del-lend]').forEach((btn) => {
    btn.onclick = async () => {
      await deleteLending(btn.dataset.delLend);
      state.lending = state.lending.filter((l) => l.id !== btn.dataset.delLend);
      render();
      maybeAutoSync('push');
    };
  });
}

function renderSettingsView(main, s) {
  const r = state.rules;
  const cur = getMonthCurrency(s.id);
  const sym = getCurrencyMeta(cur).symbol;
  const defaultCur = r.currency || 'NGN';
  const curG = s.pct.givings;
  const curP = s.pct.personal;
  const curI = s.pct.investments;
  const simMin = cur === 'NGN' ? 100000 : 500;
  const simMax = cur === 'NGN' ? 1000000 : 20000;
  const simStep = cur === 'NGN' ? 25000 : 250;
  const simDefaultVal = Math.max(simMin, Math.min(simMax, s.netIncome || simMin));

  main.innerHTML = `
    <div class="grid-2">
      <section class="card">
        <div class="card-title">
          <span>Month Setup & Percentage Rule — ${s.label}</span>
          <div style="display:flex;gap:6px;">
            <button id="btn-settings-add-month" class="btn btn-ghost btn-sm">+ Add Month</button>
            <button id="btn-preset-classic" class="btn btn-ghost btn-sm" title="Reset to 30 / 5 / 65">30 / 5 / 65</button>
          </div>
        </div>
        <p class="muted" style="font-size:0.82rem;margin-top:0;">
          Prev Work Expenses deducted for <strong>${s.label}</strong>: <strong class="mono">${formatMoney(s.prevWorkSpent, cur)}</strong>
        </p>
        <div class="form-grid">
          <div class="field">
            <label>Default Currency (New Months)</label>
            <select id="r-default-cur">${currencyOptionsHtml(defaultCur)}</select>
          </div>
          <div class="field">
            <label>Currency for ${s.label}</label>
            <select id="r-month-cur">${currencyOptionsHtml(cur)}</select>
          </div>
          <div class="field">
            <label>Amount for ${s.label} (<span id="r-amt-sym">${sym}</span>)</label>
            <input id="r-net" type="number" step="0.01" value="${s.netIncome}" />
          </div>
          <div class="field">
            <label>Givings %</label>
            <input id="r-gpct" type="number" min="0" max="100" step="0.5" value="${curG}" />
          </div>
          <div class="field">
            <label>Personal %</label>
            <input id="r-ppct" type="number" min="0" max="100" step="0.5" value="${curP}" />
          </div>
          <div class="field">
            <label>Investments % (Auto Remainder)</label>
            <input id="r-ipct" type="number" value="${curI}" disabled />
          </div>
          <div class="field">
            <label>Month-End Overspend Rule</label>
            <select id="r-mode">
              <option value="bbf" ${r.overspendMode === 'bbf' ? 'selected' : ''}>Auto BBF Carryover</option>
              <option value="reset" ${r.overspendMode === 'reset' ? 'selected' : ''}>Clean Monthly Reset (${sym}0 BBF)</option>
            </select>
          </div>
          <div class="field">
            <label>Deduct Prior Month Work Expenses</label>
            <select id="r-we">
              <option value="true" ${r.deductPrevWork !== false ? 'selected' : ''}>Yes (Recommended)</option>
              <option value="false" ${r.deductPrevWork === false ? 'selected' : ''}>No</option>
            </select>
          </div>
        </div>

        <div class="sim-box" id="month-translation-box"></div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
          <button id="btn-save-month-pct" class="btn btn-accent">Apply to ${s.label}</button>
          <button id="btn-save-rules" class="btn btn-ghost">Save as Default for New Months</button>
        </div>

        <div class="sim-box">
          <div style="display:flex;justify-content:space-between;font-size:0.84rem;margin-bottom:6px;">
            <span><strong>What-If Income Simulator</strong> (after <span id="sim-we-label">${formatMoney(s.prevWorkSpent, cur)}</span> WE)</span>
            <span id="sim-inc-label" class="mono">${formatMoney(s.netIncome || simMin, cur)}</span>
          </div>
          <input id="sim-slider" type="range" min="${simMin}" max="${simMax}" step="${simStep}" value="${simDefaultVal}" style="width:100%;" />
          <div id="sim-output" class="mono" style="font-size:0.82rem;margin-top:8px;"></div>
        </div>
      </section>

      <section class="card">
        <div class="card-title"><span>Cloud Sync & Backup</span></div>
        <p class="muted" style="font-size:0.82rem;margin-top:0;">
          Runs offline on your device in IndexedDB. Connect <strong>Google Sheets (Live Sync)</strong> to auto-update your spreadsheet on every entry, or export JSON/CSV backups anytime.
        </p>
        <div class="field" style="margin-bottom:10px;">
          <label>Sync Provider</label>
          <select id="sync-provider">
            <option value="none" ${(state.syncConfig?.provider || 'none') === 'none' ? 'selected' : ''}>Local Only (JSON / CSV Backup)</option>
            <option value="gsheets" ${state.syncConfig?.provider === 'gsheets' ? 'selected' : ''}>Google Sheets (Live Sync)</option>
          </select>
        </div>
        <div id="sync-gsheets-fields" class="${state.syncConfig?.provider === 'gsheets' ? '' : 'hidden'}">
          <div class="form-grid">
            <div class="field">
              <label>Apps Script Web App URL</label>
              <input id="sync-sheet-url" type="url" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHtml(state.syncConfig?.sheetUrl || '')}" />
            </div>
            <div class="field">
              <label>Sync Key</label>
              <input id="sync-sheet-key" type="password" placeholder="Matches SYNC_KEY in script" value="${escapeHtml(state.syncConfig?.sheetKey || '')}" />
            </div>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" id="btn-pull-sheet" class="btn btn-ghost btn-sm">Pull from Sheet</button>
            <button type="button" id="btn-gsheets-guide" class="btn btn-ghost btn-sm">Setup Guide & Script</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <button id="btn-sync-now" class="btn btn-accent btn-sm">Sync Now</button>
          <button id="btn-export-json" class="btn btn-ghost btn-sm">Export JSON</button>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
            Import JSON <input id="file-import-json" type="file" accept=".json" class="hidden" />
          </label>
          <button id="btn-export-csv" class="btn btn-ghost btn-sm">Export CSV</button>
        </div>
        <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;">
          <button id="btn-reseed" class="btn btn-danger btn-sm">Load Demo Sample Data</button>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-title"><span>Batch Bank Alert & CSV Importer (Transfers / POS)</span></div>
      <div class="grid-2">
        <div>
          <textarea id="batch-alerts" rows="5" style="width:100%;" placeholder="Paste 1 or more SMS/email debit alerts here (separated by blank lines)..."></textarea>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <button id="btn-parse-alerts" class="btn btn-accent btn-sm">Parse Alerts</button>
            <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
              Upload Bank CSV <input id="file-csv" type="file" accept=".csv,text/csv" class="hidden" />
            </label>
          </div>
        </div>
        <div id="batch-preview">
          ${renderBatchPreview(cur)}
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-title"><span>Customize 1-Tap Cash Speed-Dial Chips</span></div>
      <div class="chips-grid" style="margin-bottom:10px;">
        ${state.chips.map((c) => `
          <span class="speed-chip chip-${c.bucket}">
            <span class="pill pill-${c.bucket}">${BUCKET_META[c.bucket].short}</span>
            ${escapeHtml(c.label)} <span class="mono muted">${formatMoney(c.amount, cur)}</span>
            <button class="icon-btn" data-del-chip="${c.id}" style="border:none;padding:0 3px;">✕</button>
          </span>
        `).join('')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="chip-label" type="text" placeholder="Label (e.g. Fuel 4k)" />
        <input id="chip-amt" type="number" placeholder="Amount" style="width:110px;" />
        <select id="chip-bucket">
          ${BUCKETS.map((b) => `<option value="${b}">${BUCKET_META[b].short}</option>`).join('')}
        </select>
        <button id="btn-add-chip" class="btn btn-ghost btn-sm">+ Add Chip</button>
      </div>
    </section>
  `;

  const getPctInputs = () => {
    const g = Math.max(0, Number(document.getElementById('r-gpct').value) || 0);
    const p = Math.max(0, Number(document.getElementById('r-ppct').value) || 0);
    const rem = Math.round((100 - g - p) * 100) / 100;
    document.getElementById('r-ipct').value = rem;
    return { g, p, rem };
  };

  const updateSim = () => {
    const { g, p, rem } = getPctInputs();
    const selCur = document.getElementById('r-month-cur').value || cur;
    const selSym = getCurrencyMeta(selCur).symbol;
    document.getElementById('r-amt-sym').textContent = selSym;

    const slider = document.getElementById('sim-slider');
    const wantMin = selCur === 'NGN' ? 100000 : 500;
    if (Number(slider.min) !== wantMin) {
      slider.min = selCur === 'NGN' ? 100000 : 500;
      slider.max = selCur === 'NGN' ? 1000000 : 20000;
      slider.step = selCur === 'NGN' ? 25000 : 250;
      slider.value = Math.max(Number(slider.min), Math.min(Number(slider.max), Number(document.getElementById('r-net').value) || Number(slider.min)));
    }

    const monthNet = Math.max(0, Number(document.getElementById('r-net').value) || 0);
    const monthWe = document.getElementById('r-we').value === 'true' ? s.prevWorkSpent : 0;
    document.getElementById('sim-we-label').textContent = formatMoney(monthWe, selCur);
    const monthDist = Math.max(0, monthNet - monthWe);
    const tBox = document.getElementById('month-translation-box');
    if (rem < 0) {
      tBox.innerHTML = `<span class="negative">Givings (${g}%) + Personal (${p}%) exceeds 100%. Reduce by ${Math.abs(rem)}%.</span>`;
    } else {
      const mAlloc = allocateFromDistributable(monthDist, { personalPct: p, givingsPct: g });
      tBox.innerHTML = `
        <div style="font-size:0.8rem;margin-bottom:4px;" class="muted">What this translates to in <strong>${s.label}</strong> (Distributable ${formatMoney(monthDist, selCur)}):</div>
        <div class="mono" style="font-size:0.86rem;">
          Givings (${g}%): <strong style="color:var(--purple);">${formatMoney(mAlloc.givings, selCur)}</strong> •
          Personal (${p}%): <strong style="color:var(--accent);">${formatMoney(mAlloc.personal, selCur)}</strong> •
          Investments (${rem}%): <strong style="color:var(--amber);">${formatMoney(mAlloc.investments, selCur)}</strong>
        </div>
      `;
    }

    const net = Number(slider.value);
    document.getElementById('sim-inc-label').textContent = formatMoney(net, selCur);
    const simDist = Math.max(0, net - monthWe);
    const res = allocateFromDistributable(simDist, { personalPct: p, givingsPct: g });
    document.getElementById('sim-output').innerHTML =
      `Givings (${g}%): <strong>${formatMoney(res.givings, selCur)}</strong> • Personal (${p}%): <strong>${formatMoney(res.personal, selCur)}</strong> • Investments (${Math.max(0, rem)}%): <strong>${formatMoney(res.investments, selCur)}</strong>`;
  };
  updateSim();
  ['sim-slider', 'r-net', 'r-ppct', 'r-gpct', 'r-we', 'r-month-cur'].forEach((id) => {
    document.getElementById(id).oninput = updateSim;
  });

  document.getElementById('r-default-cur').onchange = async (e) => {
    const newCur = e.target.value;
    state.rules = { ...(state.rules || {}), currency: newCur };
    await saveSettings({ rules: state.rules });
    showToast(`Default currency for new months set to ${getCurrencyMeta(newCur).label}.`);
  };

  document.getElementById('btn-settings-add-month').onclick = () => openMonthModal(null);

  document.getElementById('btn-preset-classic').onclick = () => {
    document.getElementById('r-gpct').value = 30;
    document.getElementById('r-ppct').value = 5;
    updateSim();
  };

  document.getElementById('btn-save-month-pct').onclick = async () => {
    const { g, p, rem } = getPctInputs();
    if (rem < 0) return showToast('Givings % + Personal % cannot exceed 100%.');
    const existing = state.months.find((m) => m.id === s.id);
    if (!existing) return;
    const netIncome = Math.max(0, Number(document.getElementById('r-net').value) || 0);
    const monthCur = document.getElementById('r-month-cur').value || 'NGN';
    const updatedMonth = {
      ...existing,
      currency: monthCur,
      netIncome,
      givingsPct: g,
      personalPct: p,
      investmentsPct: rem
    };
    await saveMonth(updatedMonth);
    await markMonthConfirmed(s.id);
    state.months = state.months.map((m) => (m.id === s.id ? updatedMonth : m));
    state.rules = {
      ...state.rules,
      overspendMode: document.getElementById('r-mode').value,
      deductPrevWork: document.getElementById('r-we').value === 'true'
    };
    await saveSettings({ rules: state.rules });
    recompute();
    render();
    maybeAutoSync('push');
    showToast(`Saved ${formatMoney(netIncome, monthCur)} (${g}/${p}/${rem}%) for ${s.label}.`);
  };

  document.getElementById('btn-save-rules').onclick = async () => {
    const { g, p, rem } = getPctInputs();
    if (rem < 0) return showToast('Givings % + Personal % cannot exceed 100%.');
    const defCur = document.getElementById('r-default-cur').value || 'NGN';
    state.rules = {
      currency: defCur,
      personalPct: p,
      givingsPct: g,
      investmentsPct: rem,
      overspendMode: document.getElementById('r-mode').value,
      deductPrevWork: document.getElementById('r-we').value === 'true'
    };
    await saveSettings({ rules: state.rules });
    recompute();
    render();
    maybeAutoSync('push');
    showToast(`Saved ${defCur} • ${g}/${p}/${rem}% as default for new months.`);
  };

  document.getElementById('sync-provider').onchange = async (e) => {
    const provider = e.target.value;
    state.syncConfig = { ...(state.syncConfig || {}), provider };
    await saveSyncConfig(state.syncConfig);
    document.getElementById('sync-gsheets-fields').classList.toggle('hidden', provider !== 'gsheets');
    updateSyncPill();
  };

  document.getElementById('btn-gsheets-guide').onclick = () => {
    openModal(`
      <h3 style="margin:0 0 8px;">Two-Way Google Sheets Setup</h3>
      <ol class="muted" style="font-size:0.84rem;padding-left:18px;margin:0 0 12px;line-height:1.6;">
        <li>Open your Google Sheet → <strong>Extensions → Apps Script</strong>.</li>
        <li>Paste the contents of <code>cloud/google-apps-script.gs</code> and set your own <code>SYNC_KEY</code>.</li>
        <li>Click <strong>Deploy → New deployment → Web app</strong> (Execute as <em>Me</em>, Access: <em>Anyone</em>).</li>
        <li>Paste the Web App URL and <code>SYNC_KEY</code> here. Click <strong>Sync Now</strong> to push & merge (updates <em>Overview</em>, <em>Transactions</em>, and <em>Lending</em> in Naira ₦ equivalents with official FX rates), or <strong>Pull from Sheet</strong> on any new device to restore your data from your sheet.</li>
      </ol>
      <div style="display:flex;justify-content:flex-end;">
        <button id="gs-close" class="btn btn-accent btn-sm">Got it</button>
      </div>
    `, (card) => {
      card.querySelector('#gs-close').onclick = closeModal;
    });
  };

  const runSync = async (mode = 'sync') => {
    const provider = document.getElementById('sync-provider').value;
    const cfg = {
      provider,
      sheetUrl: document.getElementById('sync-sheet-url').value.trim(),
      sheetKey: document.getElementById('sync-sheet-key').value.trim(),
      lastSyncAt: state.syncConfig?.lastSyncAt || null
    };
    await saveSyncConfig(cfg);
    state.syncConfig = cfg;
    if (provider === 'none') return showToast('Saved as Local-Only mode.');
    try {
      const res = await syncWithGoogleSheets(cfg, [...summaries.values()], mode);
      state.syncConfig = res.config;
      if (res.reloaded) {
        const fresh = await loadAppState();
        Object.assign(state, fresh);
        recompute();
      }
      render();
      showToast(`Google Sheets synced (${res.action}).`);
    } catch (err) {
      showToast(err.message);
    }
  };
  document.getElementById('btn-sync-now').onclick = () => runSync('sync');
  document.getElementById('btn-pull-sheet').onclick = () => runSync('pull');

  document.getElementById('btn-export-json').onclick = async () => {
    const payload = await exportBackupPayload();
    downloadText(`moneyflow-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
  };
  document.getElementById('btn-export-csv').onclick = () => {
    downloadText(`moneyflow-ledger-${new Date().toISOString().slice(0, 10)}.csv`, exportTransactionsCsv(state.transactions, state.months), 'text/csv');
  };
  document.getElementById('file-import-json').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      await importBackupPayload(parsed);
      const fresh = await loadAppState();
      Object.assign(state, fresh);
      recompute();
      render();
      showToast('Backup restored!');
    } catch (err) {
      showToast(err.message);
    }
  };
  document.getElementById('btn-reseed').onclick = async () => {
    await reseedFromExcel();
    const fresh = await loadAppState();
    Object.assign(state, fresh);
    recompute();
    render();
    showToast('Loaded fictional portfolio demo data.');
  };

  document.getElementById('btn-parse-alerts').onclick = () => {
    const text = document.getElementById('batch-alerts').value;
    state.pendingBatch = parseBatchAlerts(text, state.customRules);
    render();
    if (state.pendingBatch.length === 0) showToast('No debit alerts detected.');
  };
  document.getElementById('file-csv').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.pendingBatch = parseCsvStatement(await file.text(), state.customRules);
    render();
    showToast(`Parsed ${state.pendingBatch.length} debit rows from CSV.`);
  };
  bindBatchActions(main);

  document.getElementById('btn-add-chip').onclick = async () => {
    const label = document.getElementById('chip-label').value.trim();
    const amount = Number(document.getElementById('chip-amt').value);
    const bucket = document.getElementById('chip-bucket').value;
    if (!label || !(amount > 0)) return showToast('Enter label and amount.');
    state.chips.push({ id: uid('chip'), label, description: label, amount, bucket, paymentMethod: 'cash', tag: bucket === 'givings' ? 'gifts' : '' });
    await saveSettings({ chips: state.chips });
    render();
    maybeAutoSync('push');
  };
  main.querySelectorAll('[data-del-chip]').forEach((btn) => {
    btn.onclick = async () => {
      state.chips = state.chips.filter((c) => c.id !== btn.dataset.delChip);
      await saveSettings({ chips: state.chips });
      render();
      maybeAutoSync('push');
    };
  });
}

function renderBatchPreview(cur = 'NGN') {
  if (!state.pendingBatch.length) {
    return '<div class="empty-state">Parsed alerts or CSV debit rows appear here for 1-click confirmation.</div>';
  }
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong>${state.pendingBatch.length} Ready to Import</strong>
      <button id="btn-confirm-batch" class="btn btn-accent btn-sm">Import All</button>
    </div>
    <div class="tx-list" style="max-height:220px;overflow-y:auto;">
      ${state.pendingBatch.map((item, idx) => `
        <div class="tx-row">
          <div class="mono muted" style="font-size:0.75rem;">${escapeHtml(item.date)}</div>
          <div>${escapeHtml(item.description)}</div>
          <div class="mono">${formatMoney(item.amount, item.currency || cur)}</div>
          <select data-batch-bucket="${idx}">
            ${BUCKETS.map((b) => `<option value="${b}" ${item.bucket === b ? 'selected' : ''}>${BUCKET_META[b].short}</option>`).join('')}
          </select>
        </div>
      `).join('')}
    </div>
  `;
}

function bindBatchActions(main) {
  main.querySelectorAll('[data-batch-bucket]').forEach((sel) => {
    sel.onchange = (e) => {
      const idx = Number(sel.dataset.batchBucket);
      if (state.pendingBatch[idx]) state.pendingBatch[idx].bucket = e.target.value;
    };
  });
  const confirmBtn = document.getElementById('btn-confirm-batch');
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      const batch = [...state.pendingBatch];
      state.pendingBatch = [];
      for (const item of batch) await addTransaction(item);
      render();
      showToast(`Imported ${batch.length} transactions.`);
    };
  }
}

function bindTxActions(root) {
  root.querySelectorAll('[data-edit-tx]').forEach((btn) => {
    btn.onclick = () => {
      const tx = state.transactions.find((t) => t.id === btn.dataset.editTx);
      if (tx) openTransactionModal(tx);
    };
  });
  root.querySelectorAll('[data-del-tx]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.delTx;
      const old = state.transactions.find((t) => t.id === id);
      if (!old) return;
      await deleteTransaction(id);
      state.transactions = state.transactions.filter((t) => t.id !== id);
      recompute();
      render();
      maybeAutoSync('push');
      showToast(`Deleted "${old.description}"`, async () => {
        await saveTransaction(old);
        state.transactions.push(old);
        recompute();
        render();
      });
    };
  });
}

function openTransactionModal(existing = {}) {
  const isEdit = Boolean(existing.id);
  const bucket = existing.bucket || 'personal';
  const defaultDate = existing.date || new Date().toISOString().slice(0, 10);
  const initCur = existing.currency || getMonthCurrency(defaultDate.slice(0, 7));
  const initSym = getCurrencyMeta(initCur).symbol;
  openModal(`
    <h3 style="margin:0 0 14px;">${isEdit ? 'Edit Expense' : 'Add Expense'}</h3>
    <div class="form-grid">
      <div class="field">
        <label>Date</label>
        ${renderDateFieldHtml('m-date', escapeHtml(defaultDate))}
      </div>
      <div class="field">
        <label>Amount (<span id="m-amt-sym">${initSym}</span>)</label>
        <input id="m-amt" type="number" step="0.01" value="${existing.amount || ''}" placeholder="500" />
      </div>
      <div class="field" style="grid-column:1 / -1;">
        <label>Description</label>
        <input id="m-desc" type="text" value="${escapeHtml(existing.description || '')}" placeholder="e.g. Fuel, Groceries, Gift" />
      </div>
      <div class="field">
        <label>Bucket</label>
        <select id="m-bucket">
          ${BUCKETS.map((b) => `<option value="${b}" ${bucket === b ? 'selected' : ''}>${BUCKET_META[b].label}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Payment Method</label>
        <select id="m-method">
          <option value="cash" ${(existing.paymentMethod || 'cash') === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="transfer" ${existing.paymentMethod === 'transfer' ? 'selected' : ''}>Transfer</option>
          <option value="card" ${existing.paymentMethod === 'card' ? 'selected' : ''}>Card / POS</option>
        </select>
      </div>
      <div class="field ${bucket === 'givings' ? '' : 'hidden'}" id="m-tag-wrap">
        <label>Givings Tag</label>
        <select id="m-tag">
          ${GIVINGS_TAGS.map((t) => `<option value="${t.id}" ${existing.tag === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
      <button id="m-cancel" class="btn btn-ghost">Cancel</button>
      <button id="m-save" class="btn btn-accent">${isEdit ? 'Save Changes' : 'Add Expense'}</button>
    </div>
  `, (card) => {
    const mDateField = bindDateField(card, 'm-date');
    card.querySelector('#m-bucket').onchange = (e) => {
      card.querySelector('#m-tag-wrap').classList.toggle('hidden', e.target.value !== 'givings');
    };
    card.querySelector('#m-cancel').onclick = closeModal;
    card.querySelector('#m-save').onclick = async () => {
      const date = mDateField.getValue();
      if (!date) return showToast('Enter a valid date (e.g. 2026-11-25 or 25/11/2026).');
      const amount = Number(card.querySelector('#m-amt').value);
      const description = card.querySelector('#m-desc').value.trim();
      const b = card.querySelector('#m-bucket').value;
      const paymentMethod = card.querySelector('#m-method').value;
      const tag = b === 'givings' ? card.querySelector('#m-tag').value : '';
      const txCur = existing.currency || getMonthCurrency(date.slice(0, 7));
      if (!description || !(amount > 0)) return showToast('Enter description and positive amount.');

      if (isEdit) {
        const updated = { ...existing, date, monthId: date.slice(0, 7), currency: txCur, amount, description, bucket: b, paymentMethod, tag };
        await saveTransaction(updated);
        state.transactions = state.transactions.map((t) => (t.id === updated.id ? updated : t));
        recompute();
        render();
        maybeAutoSync('push');
      } else {
        await addTransaction({ date, currency: txCur, amount, description, bucket: b, paymentMethod, tag, source: 'manual' });
      }
      closeModal();
    };
  });
}

async function markMonthConfirmed(monthId) {
  const list = (await getKv('confirmedMonths', [])) || [];
  if (!list.includes(monthId)) {
    list.push(monthId);
    await setKv('confirmedMonths', list);
  }
}

async function checkMonthlySetupPrompt() {
  const now = new Date();
  const curId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let confirmed = await getKv('confirmedMonths', null);
  if (!Array.isArray(confirmed)) {
    // Pre-confirm past historical months so only the current & future new months prompt
    confirmed = state.months.filter((m) => m.id < curId).map((m) => m.id);
    await setKv('confirmedMonths', confirmed);
  }
  if (!confirmed.includes(curId)) {
    openMonthModal(curId, { isMonthlyPrompt: true });
  }
}

function openMonthModal(monthId, opts = {}) {
  const isPrompt = Boolean(opts.isMonthlyPrompt);
  const existing = state.months.find((m) => m.id === monthId);
  const sorted = [...state.months].sort((a, b) => a.id.localeCompare(b.id));
  const latestMonth = sorted[sorted.length - 1];
  const defaultNewId = sorted.length ? nextMonthId(latestMonth.id) : new Date().toISOString().slice(0, 7);
  const initId = monthId || defaultNewId;
  const prevId = prevMonthId(initId);
  const prevRec = state.months.find((m) => m.id === prevId) || latestMonth;
  const initCur = existing?.currency || state.rules?.currency || 'NGN';
  const initSym = getCurrencyMeta(initCur).symbol;
  const initNet = existing ? existing.netIncome : (prevRec?.netIncome || (initCur === 'NGN' ? 300000 : 2000));
  const initG = existing?.givingsPct ?? prevRec?.givingsPct ?? state.rules?.givingsPct ?? 30;
  const initP = existing?.personalPct ?? prevRec?.personalPct ?? state.rules?.personalPct ?? 5;
  const initI = Math.max(0, 100 - initG - initP);

  const getPrevWeFor = (targetId, targetCur) => {
    if (state.rules?.deductPrevWork === false) return 0;
    const sameCurPrev = [...summaries.values()]
      .filter((m) => (m.currency || 'NGN') === targetCur && m.id < targetId)
      .sort((a, b) => a.id.localeCompare(b.id));
    return sameCurPrev[sameCurPrev.length - 1]?.spent?.work || 0;
  };

  openModal(`
    <h3 style="margin:0 0 ${isPrompt ? '4px' : '14px'};">${isPrompt ? `Set Up ${formatMonthLabel(initId)}` : (existing ? `Edit ${formatMonthLabel(initId)}` : 'Add Month & Percentage Split')}</h3>
    ${isPrompt ? `<p class="muted" style="font-size:0.82rem;margin:0 0 12px;">New month started — enter how much you have for ${formatMonthLabel(initId)} and continue with or update your percentage sharing.</p>` : ''}
    <div class="form-grid">
      <div class="field">
        <label>Month (YYYY-MM)</label>
        <input id="mm-id" type="month" value="${initId}" ${existing || isPrompt ? 'disabled' : ''} />
      </div>
      <div class="field">
        <label>Currency</label>
        <select id="mm-cur">${currencyOptionsHtml(initCur)}</select>
      </div>
      <div class="field">
        <label>Amount for Month / Net Income (<span id="mm-cur-sym">${initSym}</span>)</label>
        <input id="mm-net" type="number" step="0.01" value="${initNet}" />
      </div>
      <div class="field">
        <label>Givings %</label>
        <input id="mm-gpct" type="number" min="0" max="100" step="0.5" value="${initG}" />
      </div>
      <div class="field">
        <label>Personal %</label>
        <input id="mm-ppct" type="number" min="0" max="100" step="0.5" value="${initP}" />
      </div>
      <div class="field">
        <label>Investments % (Auto Remainder)</label>
        <input id="mm-ipct" type="number" value="${initI}" disabled />
      </div>
    </div>
    <div id="mm-preview" class="sim-box" style="margin-top:12px;"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
      <button id="mm-cancel" class="btn btn-ghost">${isPrompt ? 'Later' : 'Cancel'}</button>
      <button id="mm-save" class="btn btn-accent">${isPrompt ? 'Confirm & Start Month' : 'Save Month'}</button>
    </div>
  `, (card) => {
    const updateModalPreview = () => {
      const id = existing ? existing.id : card.querySelector('#mm-id').value;
      const selCur = card.querySelector('#mm-cur').value || initCur;
      card.querySelector('#mm-cur-sym').textContent = getCurrencyMeta(selCur).symbol;
      const net = Number(card.querySelector('#mm-net').value) || 0;
      const g = Math.max(0, Number(card.querySelector('#mm-gpct').value) || 0);
      const p = Math.max(0, Number(card.querySelector('#mm-ppct').value) || 0);
      const rem = Math.round((100 - g - p) * 100) / 100;
      card.querySelector('#mm-ipct').value = rem;

      const prevWe = id ? getPrevWeFor(id, selCur) : 0;
      const dist = Math.max(0, net - prevWe);
      const box = card.querySelector('#mm-preview');
      if (rem < 0) {
        box.innerHTML = `<span class="negative">Givings (${g}%) + Personal (${p}%) exceeds 100%.</span>`;
        return;
      }
      const res = allocateFromDistributable(dist, { personalPct: p, givingsPct: g });
      box.innerHTML = `
        <div class="muted" style="font-size:0.78rem;margin-bottom:4px;">
          Net ${formatMoney(net, selCur)} − Prev Work ${formatMoney(prevWe, selCur)} = Distributable <strong class="mono">${formatMoney(dist, selCur)}</strong>
        </div>
        <div class="mono" style="font-size:0.84rem;">
          Givings (${g}%): <strong style="color:var(--purple);">${formatMoney(res.givings, selCur)}</strong><br/>
          Personal (${p}%): <strong style="color:var(--accent);">${formatMoney(res.personal, selCur)}</strong><br/>
          Investments (${rem}%): <strong style="color:var(--amber);">${formatMoney(res.investments, selCur)}</strong>
        </div>
      `;
    };
    updateModalPreview();
    ['#mm-id', '#mm-cur', '#mm-net', '#mm-gpct', '#mm-ppct'].forEach((sel) => {
      card.querySelector(sel).oninput = updateModalPreview;
    });

    card.querySelector('#mm-cancel').onclick = closeModal;
    card.querySelector('#mm-save').onclick = async () => {
      const id = (existing || isPrompt) ? initId : card.querySelector('#mm-id').value;
      const selCur = card.querySelector('#mm-cur').value || initCur;
      const netIncome = Number(card.querySelector('#mm-net').value) || 0;
      const givingsPct = Math.max(0, Number(card.querySelector('#mm-gpct').value) || 0);
      const personalPct = Math.max(0, Number(card.querySelector('#mm-ppct').value) || 0);
      const investmentsPct = Math.round((100 - givingsPct - personalPct) * 100) / 100;
      if (!id) return;
      if (investmentsPct < 0) return showToast('Givings % + Personal % cannot exceed 100%.');
      const rec = { id, currency: selCur, netIncome, givingsPct, personalPct, investmentsPct, note: formatMonthLabel(id) };
      await saveMonth(rec);
      await markMonthConfirmed(id);
      const idx = state.months.findIndex((m) => m.id === id);
      if (idx >= 0) state.months[idx] = rec;
      else state.months.push(rec);
      state.activeMonthId = id;
      recompute();
      render();
      maybeAutoSync('push');
      closeModal();
    };
  });
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function render() {
  renderMonthSelector();
  updateSyncPill();

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const activeMatch = state.activeView === 'lending' ? 'ledger' : state.activeView;
    tab.classList.toggle('active', tab.dataset.view === activeMatch);
  });

  const main = document.getElementById('main-content');
  const s = summaries.get(state.activeMonthId) || [...summaries.values()][0];
  if (!s) {
    main.innerHTML = '<div class="empty-state">No month data found.</div>';
    return;
  }

  if (state.activeView === 'quick') renderQuickView(main, s);
  else if (state.activeView === 'ledger') renderLedgerView(main, s);
  else if (state.activeView === 'lending') renderLendingDetailsView(main, s);
  else if (state.activeView === 'insights') renderInsightsView(main, s);
  else renderSettingsView(main, s);
}

async function init() {
  const loaded = await loadAppState();
  Object.assign(state, loaded);
  recompute();
  render();

  document.getElementById('month-select').onchange = (e) => {
    state.activeMonthId = e.target.value;
    render();
  };

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.onclick = () => {
      state.activeView = tab.dataset.view;
      render();
    };
  });

  window.addEventListener('online', () => { updateSyncPill(); maybeAutoSync('auto'); });
  window.addEventListener('offline', updateSyncPill);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    const btn = document.getElementById('btn-install');
    btn.classList.remove('hidden');
    btn.onclick = async () => {
      btn.classList.add('hidden');
      e.prompt();
      await e.userChoice;
      state.deferredInstallPrompt = null;
    };
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  maybeAutoSync('auto');
  await checkMonthlySetupPrompt();
}

init();
