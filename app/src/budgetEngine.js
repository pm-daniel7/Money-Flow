/**
 * MoneyFlow Budget Engine
 * Pure calculations for Waterfall Allocations (Percentages),
 * Per-Currency Automatic BBF Carryover, Safe-to-Spend pace, and Lending balances.
 */

export const CURRENCIES = {
  NGN: { code: 'NGN', symbol: '₦', locale: 'en-NG', label: 'Naira (₦)' },
  USD: { code: 'USD', symbol: '$', locale: 'en-US', label: 'US Dollar ($)' },
  GBP: { code: 'GBP', symbol: '£', locale: 'en-GB', label: 'British Pound (£)' },
  EUR: { code: 'EUR', symbol: '€', locale: 'en-IE', label: 'Euro (€)' }
};

export function getCurrencyMeta(code) {
  return CURRENCIES[code] || CURRENCIES.NGN;
}

export const BUCKETS = ['work', 'givings', 'personal', 'investments'];

export const BUCKET_META = {
  work: { label: 'Work Expenses', short: 'Work', color: '#0284c7', deductFirst: true },
  givings: { label: 'Givings', short: 'Givings', color: '#7c3aed', deductFirst: false },
  personal: { label: 'Personal', short: 'Personal', color: '#00b875', deductFirst: false },
  investments: { label: 'Investments', short: 'Invest', color: '#d97706', deductFirst: false }
};

export const GIVINGS_TAGS = [
  { id: 'family', label: 'Family & Parents', color: '#7c3aed' },
  { id: 'home', label: 'Home & Bills', color: '#0284c7' },
  { id: 'church', label: 'Church & Ministry', color: '#00b875' },
  { id: 'gifts', label: 'Gifts & Others', color: '#ea580c' }
];

export const DEFAULT_RULES = {
  currency: 'NGN',
  personalPct: 5,
  givingsPct: 30,
  investmentsPct: 65,
  overspendMode: 'bbf', // 'bbf' | 'reset'
  deductPrevWork: true
};

export const DEFAULT_CHIPS = [
  { id: 'c1', label: 'Egg', amount: 200, bucket: 'personal', paymentMethod: 'cash', tag: '' },
  { id: 'c2', label: 'Bread', amount: 500, bucket: 'personal', paymentMethod: 'cash', tag: '' },
  { id: 'c3', label: 'Buscuit', amount: 200, bucket: 'personal', paymentMethod: 'cash', tag: '' },
  { id: 'c4', label: 'Superbite', amount: 400, bucket: 'personal', paymentMethod: 'cash', tag: '' },
  { id: 'c5', label: 'Tfare', amount: 400, bucket: 'personal', paymentMethod: 'cash', tag: '' },
  { id: 'c6', label: 'Airtime', amount: 1000, bucket: 'personal', paymentMethod: 'transfer', tag: '' },
  { id: 'c7', label: 'Fuel 3k', description: 'Fuel', amount: 3000, bucket: 'work', paymentMethod: 'cash', tag: '' },
  { id: 'c8', label: 'Fuel 6k', description: 'Fuel', amount: 6000, bucket: 'work', paymentMethod: 'transfer', tag: '' },
  { id: 'c9', label: 'Data', amount: 7500, bucket: 'work', paymentMethod: 'transfer', tag: '' },
  { id: 'c10', label: 'Eazy', amount: 5000, bucket: 'givings', paymentMethod: 'transfer', tag: 'family' }
];

export function formatMoney(amount, currency = 'NGN', opts = {}) {
  const meta = getCurrencyMeta(currency);
  const num = Number(amount) || 0;
  const sign = num < 0 ? '-' : (opts.plus && num > 0 ? '+' : '');
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString(meta.locale, {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });
  return `${sign}${meta.symbol}${formatted}`;
}

export function formatNaira(amount, opts = {}) {
  return formatMoney(amount, 'NGN', opts);
}

export function prevMonthId(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function nextMonthId(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function formatMonthLabel(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Computes bucket allocations for a given distributable income using
 * pure percentages (personalPct + givingsPct + investmentsPct = 100%).
 */
export function allocateFromDistributable(distributable, rules = DEFAULT_RULES) {
  const avail = Math.max(0, Number(distributable) || 0);
  const pPct = Math.max(0, Math.min(100, Number(rules.personalPct ?? 5)));
  const gPct = Math.max(0, Math.min(100 - pPct, Number(rules.givingsPct ?? 30)));
  const iPct = Math.max(0, 100 - pPct - gPct);

  const personal = Math.round(avail * (pPct / 100));
  const givings = Math.round(avail * (gPct / 100));
  const investments = Math.max(0, avail - personal - givings);

  return {
    distributable: avail,
    personal,
    givings,
    investments,
    pct: { personal: pPct, givings: gPct, investments: iPct }
  };
}

/**
 * Computes full multi-month ledger chain in chronological order so BBF
 * carries over automatically without manual sign-flipping.
 */
export function computeAllMonths(months, transactions, rules = DEFAULT_RULES) {
  const sortedMonths = [...months].sort((a, b) => a.id.localeCompare(b.id));
  const txByMonth = new Map();
  for (const tx of transactions) {
    if (!txByMonth.has(tx.monthId)) txByMonth.set(tx.monthId, []);
    txByMonth.get(tx.monthId).push(tx);
  }

  const results = new Map();
  const lastByCurrency = new Map();

  for (const m of sortedMonths) {
    const monthCurrency = m.currency || 'NGN';
    const list = txByMonth.get(m.id) || [];
    const spent = { work: 0, givings: 0, personal: 0, investments: 0 };
    const givingsByTag = { family: 0, home: 0, church: 0, gifts: 0 };

    for (const tx of list) {
      const amt = Number(tx.amount) || 0;
      if (spent[tx.bucket] !== undefined) spent[tx.bucket] += amt;
      if (tx.bucket === 'givings') {
        const tag = givingsByTag[tx.tag] !== undefined ? tx.tag : 'gifts';
        givingsByTag[tag] += amt;
      }
    }

    const prevId = prevMonthId(m.id);
    const prevById = results.get(prevId);
    const prevSameCur = lastByCurrency.get(monthCurrency);
    const prevWorkSpent = (rules.deductPrevWork !== false && prevById && prevById.currency === monthCurrency)
      ? prevById.spent.work
      : 0;

    const netIncome = Number(m.netIncome) || 0;
    const isBaselineOnly = netIncome <= 0 && m.id === '2026-02';
    const monthRules = {
      personalPct: m.personalPct ?? rules.personalPct ?? 5,
      givingsPct: m.givingsPct ?? rules.givingsPct ?? 30
    };
    const distributable = isBaselineOnly ? 0 : Math.max(0, netIncome - prevWorkSpent);
    const alloc = isBaselineOnly
      ? { distributable: 0, personal: 0, givings: 0, investments: 0, pct: { personal: monthRules.personalPct, givings: monthRules.givingsPct, investments: Math.max(0, 100 - monthRules.personalPct - monthRules.givingsPct) } }
      : allocateFromDistributable(distributable, monthRules);

    const useBbf = rules.overspendMode !== 'reset' && !isBaselineOnly && prevSameCur && !prevSameCur.isBaselineOnly;
    const bbf = {
      personal: useBbf ? prevSameCur.balance.personal : 0,
      givings: useBbf ? prevSameCur.balance.givings : 0,
      investments: useBbf ? prevSameCur.balance.investments : 0
    };

    if (m.bbfOverride) {
      if (m.bbfOverride.personal !== undefined) bbf.personal = Number(m.bbfOverride.personal);
      if (m.bbfOverride.givings !== undefined) bbf.givings = Number(m.bbfOverride.givings);
      if (m.bbfOverride.investments !== undefined) bbf.investments = Number(m.bbfOverride.investments);
    }

    const available = {
      personal: alloc.personal + bbf.personal,
      givings: alloc.givings + bbf.givings,
      investments: alloc.investments + bbf.investments
    };

    const balance = {
      personal: available.personal - spent.personal,
      givings: available.givings - spent.givings,
      investments: available.investments - spent.investments
    };

    const totalNonWorkSpent = spent.personal + spent.givings + spent.investments;

    const summary = {
      id: m.id,
      label: formatMonthLabel(m.id),
      currency: monthCurrency,
      netIncome,
      note: m.note || '',
      isBaselineOnly,
      prevWorkSpent,
      distributable,
      alloc,
      pct: alloc.pct,
      bbf,
      available,
      spent,
      balance,
      givingsByTag,
      totalNonWorkSpent,
      txCount: list.length,
      transactions: list
    };

    results.set(m.id, summary);
    if (!isBaselineOnly) lastByCurrency.set(monthCurrency, summary);
  }

  return results;
}

export function getDaysRemainingInMonth(monthId, today = new Date()) {
  const [y, m] = monthId.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const curId = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  if (monthId < curId) return 0;
  if (monthId > curId) return daysInMonth;
  return Math.max(1, daysInMonth - today.getDate() + 1);
}

export function computeLendingSummary(lendingEntries, currencyFilter = null) {
  const byPersonCur = new Map();
  let totalLent = 0;
  let totalRepaid = 0;

  for (const row of lendingEntries) {
    const cur = row.currency || 'NGN';
    if (currencyFilter && cur !== currencyFilter) continue;
    const person = (row.person || 'Unknown').trim();
    const key = `${person.toLowerCase()}__${cur}`;
    if (!byPersonCur.has(key)) {
      byPersonCur.set(key, { person, currency: cur, lent: 0, repaid: 0, netOwed: 0, entries: [] });
    }
    const rec = byPersonCur.get(key);
    const amt = Number(row.amount) || 0;
    if (row.direction === 'repaid') {
      rec.repaid += amt;
      totalRepaid += amt;
    } else {
      rec.lent += amt;
      totalLent += amt;
    }
    rec.netOwed = rec.lent - rec.repaid;
    rec.entries.push(row);
  }

  return {
    people: [...byPersonCur.values()].sort((a, b) => b.netOwed - a.netOwed),
    totalLent,
    totalRepaid,
    totalNetOwed: totalLent - totalRepaid
  };
}

/**
 * Computes lending carry-forward for a specific month (YYYY-MM) and currency.
 * Unpaid debt before `monthId` automatically carries into every month of that currency until repaid.
 */
export function computeLendingForMonth(lendingEntries, monthId, currency = 'NGN') {
  let carriedUnpaid = 0;
  let lentThisMonth = 0;
  let repaidThisMonth = 0;

  for (const row of lendingEntries) {
    if ((row.currency || 'NGN') !== currency) continue;
    const mId = (row.date || '').slice(0, 7);
    const amt = Number(row.amount) || 0;
    if (!mId || mId > monthId) continue;

    if (mId < monthId) {
      carriedUnpaid += row.direction === 'repaid' ? -amt : amt;
    } else if (mId === monthId) {
      if (row.direction === 'repaid') repaidThisMonth += amt;
      else lentThisMonth += amt;
    }
  }

  const endingOwed = carriedUnpaid + lentThisMonth - repaidThisMonth;
  return { carriedUnpaid, lentThisMonth, repaidThisMonth, endingOwed, currency };
}

/**
 * Computes top frequent expense suggestions from actual transaction history.
 * Returns most-used items with their most common amount, method, tag, and bucket counts.
 */
export function computeFrequentSuggestions(transactions, limit = 12) {
  const groups = new Map();

  for (const t of transactions) {
    const raw = (t.description || '').trim();
    if (!raw || raw === '-' || raw.toLowerCase() === 'quick expense') continue;
    const key = raw.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        labelCounts: new Map(),
        amountCounts: new Map(),
        bucketCounts: { personal: 0, givings: 0, work: 0, investments: 0 },
        methodCounts: new Map(),
        tagCounts: new Map(),
        count: 0
      });
    }
    const g = groups.get(key);
    g.count++;
    g.labelCounts.set(raw, (g.labelCounts.get(raw) || 0) + 1);
    const amt = Number(t.amount) || 0;
    if (amt > 0) g.amountCounts.set(amt, (g.amountCounts.get(amt) || 0) + 1);
    if (g.bucketCounts[t.bucket] !== undefined) g.bucketCounts[t.bucket]++;
    const pm = t.paymentMethod || 'cash';
    g.methodCounts.set(pm, (g.methodCounts.get(pm) || 0) + 1);
    if (t.bucket === 'givings' && t.tag) {
      g.tagCounts.set(t.tag, (g.tagCounts.get(t.tag) || 0) + 1);
    }
  }

  const pickTop = (map, fallback) => {
    let best = fallback;
    let bestC = -1;
    for (const [k, c] of map.entries()) {
      if (c > bestC) { best = k; bestC = c; }
    }
    return best;
  };

  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((g) => {
      let recBucket = 'personal';
      let recC = -1;
      for (const [b, c] of Object.entries(g.bucketCounts)) {
        if (c > recC) { recBucket = b; recC = c; }
      }
      return {
        key: g.key,
        label: pickTop(g.labelCounts, g.key),
        amount: pickTop(g.amountCounts, 0),
        count: g.count,
        bucketCounts: g.bucketCounts,
        recommendedBucket: recBucket,
        paymentMethod: pickTop(g.methodCounts, 'cash'),
        tag: pickTop(g.tagCounts, 'gifts')
      };
    });
}
