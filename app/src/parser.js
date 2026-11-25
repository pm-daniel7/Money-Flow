/**
 * NairaFlow Zero-Cost Local Smart Parser
 * Parses:
 *  1) Fast shorthand: "200 egg", "6k fuel work", "mum 5000 transfer #family"
 *  2) Nigerian Bank / Fintech SMS & Email Alerts (OPay, PalmPay, Kuda, GTBank, Access, Zenith, UBA, Moniepoint, etc.)
 *  3) Bank statement CSV files
 */

const WORK_KEYWORDS = [
  'fuel', 'data', 'airtel odu', 'mtn', 'glo', 'engine oil', 'gen. plug', 'gen plug',
  'work meet', 'product tour', 'wpd', 'office', 'client', 'hosting', 'domain'
];

const PERSONAL_KEYWORDS = [
  'egg', 'eggs', 'bread', 'buscuit', 'biscuit', 'superbite', 'gala', 'snack', 'snacks',
  'tfare', 't-fare', 'transport', 'sunday tfare', 'sunday snack', 'airtime', 'barbing',
  'hair cut', 'haircut', 'breakfast', 'lunch', 'dinner', 'fufu', 'iyan', 'akara',
  'malt', 'coke', 'peanuts', 'peanut', 'cornflakes', 'tea', 'milk', 'milo',
  'paracetamol', 'malaria', 'inhaler', 'deworming', 'drug', 'drugs', 'medication',
  'screenguard', 'handkerchief', 'hankerchief', 'perfume', 'hypo', 'fish', 'bole'
];

const INVEST_KEYWORDS = [
  'laptop', 'book', 'books', 'course', 'coaching', 'conference', 'guide', 'table', 'chair',
  'repair', 'painting', 'powerbank', 'charger', 'shoe', 'wedding', 'pre-marriage',
  'sensodyne', 'facial', 'hair product', 'savings', 'piggyvest', 'cowrywise', 'investment', 'stock', 'tbill'
];

const GIVING_KEYWORDS = [
  'mum', 'mama', 'mummy', 'dad', 'daddy', 'family', 'sister', 'brother',
  'pastor', 'church', 'tithe', 'offering', 'retreat', 'alms', 'giving', 'give', 'dash',
  'foodstuff', 'foodstuffs', 'nepa', 'light', 'detergent', 'soap', 'gas', 'pepper',
  'stew', 'spag', 'spaghetti', 'soup', 'home', 'house', 'birthday', 'donation', 'gift'
];

export function inferGivingsTag(description) {
  const d = (description || '').toLowerCase();
  if (/#church\b/.test(d) || /(church|tithe|offering|retreat|pastor|prayer|choir|minister|outreach)/.test(d)) {
    return 'church';
  }
  if (/#home\b/.test(d) || /(foodstuff|soap|detergent|nepa|light|gas|pepper|egusi|spag|soup|home|house|stew|oil|bulb|security|grocer)/.test(d)) {
    return 'home';
  }
  if (/#family\b/.test(d) || /(mum|mama|mummy|dad|daddy|sister|brother|family|stipend)/.test(d)) {
    return 'family';
  }
  return 'gifts';
}

export function predictBucketAndTag(description, customRules = []) {
  const d = (description || '').toLowerCase();

  for (const rule of customRules) {
    if (rule.keyword && d.includes(rule.keyword.toLowerCase())) {
      return {
        bucket: rule.bucket,
        tag: rule.bucket === 'givings' ? (rule.tag || inferGivingsTag(d)) : ''
      };
    }
  }

  if (WORK_KEYWORDS.some((k) => d.includes(k))) return { bucket: 'work', tag: '' };
  if (INVEST_KEYWORDS.some((k) => d.includes(k))) return { bucket: 'investments', tag: '' };
  if (GIVING_KEYWORDS.some((k) => d.includes(k))) {
    return { bucket: 'givings', tag: inferGivingsTag(d) };
  }
  if (PERSONAL_KEYWORDS.some((k) => d.includes(k))) return { bucket: 'personal', tag: '' };

  return { bucket: 'personal', tag: '' };
}

function parseAmountToken(raw) {
  const cleaned = raw.toLowerCase().replace(/[,₦$£€\s]/g, '').replace(/^(ngn|usd|gbp|eur|n)(?=[\d])/, '');
  const m = cleaned.match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
  if (!m) return null;
  let val = parseFloat(m[1]);
  if (m[2] === 'k') val *= 1000;
  if (m[2] === 'm') val *= 1000000;
  return Number.isFinite(val) && val > 0 ? Math.round(val * 100) / 100 : null;
}

export function looksLikeBankAlert(text) {
  const t = (text || '').trim();
  if (t.length < 24) return false;
  return /(amt|amount|ngn|usd|gbp|eur|[$£€₦]|acct|account|bal|avail|debit|dr\b|transfer|pos|opay|palmpay|kuda|gtbank|zenith|access|uba|moniepoint|desc|remarks)/i.test(t)
    && /\d[\d,]*(?:\.\d{1,2})?/.test(t);
}

/**
 * Parses a single bank/fintech SMS or email alert (NGN, USD, GBP, EUR).
 */
export function parseBankAlert(text, customRules = []) {
  const raw = (text || '').trim();
  if (!raw) return null;

  const isCredit = /\b(cr\b|credit|credited|received|inflow|deposit)\b/i.test(raw)
    && !/\b(dr\b|debit|debited|transfer to|paid|withdrawn)\b/i.test(raw);

  const amtPatterns = [
    /(?:amt|amount)\s*[:\-]?\s*(?:ngn|usd|gbp|eur|naira|[$£€₦]|n)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:ngn|usd|gbp|eur|[$£€₦])\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\bN([\d,]+(?:\.\d{1,2})?)\b/,
    /debited\s+(?:with\s+)?(?:ngn|usd|gbp|eur|[$£€₦]|n)?\s*([\d,]+(?:\.\d{1,2})?)/i
  ];

  let amount = null;
  for (const pat of amtPatterns) {
    const m = raw.match(pat);
    if (m) {
      const parsed = parseFloat(m[1].replace(/,/g, ''));
      if (parsed > 0) {
        amount = parsed;
        break;
      }
    }
  }
  if (!amount) return null;

  // Date extraction: YYYY-MM-DD, DD/MM/YYYY, DD-MMM-YYYY
  let date = new Date().toISOString().slice(0, 10);
  const isoM = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const dmyM = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  const dMonY = raw.match(/\b(\d{1,2})[\-\s](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\-\s,]+(20\d{2})\b/i);

  if (isoM) {
    date = isoM[1];
  } else if (dmyM) {
    date = `${dmyM[3]}-${dmyM[2].padStart(2, '0')}-${dmyM[1].padStart(2, '0')}`;
  } else if (dMonY) {
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const mm = months[dMonY[2].slice(0, 3).toLowerCase()];
    if (mm) date = `${dMonY[3]}-${mm}-${dMonY[1].padStart(2, '0')}`;
  }

  // Extract description / beneficiary
  let description = '';
  const descMatch = raw.match(/(?:desc|description|remarks|narration|details|to|beneficiary)\s*[:\-]\s*([^\n|;]+)/i)
    || raw.match(/transfer to\s+([A-Za-z0-9\s.&'-]{3,40})/i)
    || raw.match(/pos\s+(?:at\s+)?([A-Za-z0-9\s.&'-]{3,40})/i);

  if (descMatch) {
    description = descMatch[1]
      .replace(/\b(avail|bal|balance|ref|date|time)\b.*$/i, '')
      .trim()
      .slice(0, 60);
  }
  if (!description) {
    description = raw.replace(/\s+/g, ' ').slice(0, 48);
  }

  const predicted = predictBucketAndTag(description, customRules);
  return {
    amount,
    date,
    description,
    bucket: predicted.bucket,
    tag: predicted.tag,
    paymentMethod: /\bpos\b/i.test(raw) ? 'card' : 'transfer',
    isCredit,
    source: 'alert'
  };
}

/**
 * Parses multiple bank alerts pasted together (separated by blank lines or repeated alert markers).
 */
export function parseBatchAlerts(blob, customRules = []) {
  const chunks = (blob || '')
    .split(/\n\s*\n+|(?=^Acct:|^Debit Alert|^Transaction Alert|^NGN\s)/gim)
    .map((c) => c.trim())
    .filter((c) => c.length > 10);

  const items = [];
  for (const chunk of chunks) {
    const parsed = parseBankAlert(chunk, customRules);
    if (parsed && !parsed.isCredit) items.push(parsed);
  }
  return items;
}

/**
 * Parses fast shorthand like:
 *  "200 egg" | "egg 200" | "6k fuel work" | "mum 5k trf #family" | "bread 500 cash"
 */
export function parseQuickInput(input, customRules = []) {
  const text = (input || '').trim();
  if (!text) return null;

  if (looksLikeBankAlert(text)) {
    const alert = parseBankAlert(text, customRules);
    if (alert) return alert;
  }

  const tokens = text.split(/\s+/);
  let amount = null;
  let explicitBucket = null;
  let explicitTag = null;
  let paymentMethod = null;
  const descTokens = [];

  for (const tok of tokens) {
    const low = tok.toLowerCase();

    if (amount === null) {
      const maybeAmt = parseAmountToken(tok);
      if (maybeAmt !== null) {
        amount = maybeAmt;
        continue;
      }
    }

    if (/^(work|we)$/i.test(low)) { explicitBucket = 'work'; continue; }
    if (/^(personal|pers|self)$/i.test(low)) { explicitBucket = 'personal'; continue; }
    if (/^(giving|givings|give)$/i.test(low)) { explicitBucket = 'givings'; continue; }
    if (/^(invest|investments|inv|save)$/i.test(low)) { explicitBucket = 'investments'; continue; }

    if (/^(cash)$/i.test(low)) { paymentMethod = 'cash'; continue; }
    if (/^(trf|transfer|opay|bank)$/i.test(low)) { paymentMethod = 'transfer'; continue; }
    if (/^(card|pos)$/i.test(low)) { paymentMethod = 'card'; continue; }

    if (/^#(family|home|church|gifts)$/i.test(low)) {
      explicitTag = low.slice(1);
      if (!explicitBucket) explicitBucket = 'givings';
      continue;
    }

    descTokens.push(tok);
  }

  if (amount === null) return null;

  const description = descTokens.join(' ').trim() || 'Quick Expense';
  const predicted = predictBucketAndTag(description, customRules);
  const bucket = explicitBucket || predicted.bucket;
  const tag = bucket === 'givings' ? (explicitTag || predicted.tag || inferGivingsTag(description)) : '';

  return {
    amount,
    date: new Date().toISOString().slice(0, 10),
    description,
    bucket,
    tag,
    paymentMethod: paymentMethod || (amount >= 5000 ? 'transfer' : 'cash'),
    source: 'manual'
  };
}

/**
 * Parses one OR multiple expenses from the Quick Log box:
 *  - Comma-separated: "200 egg, 500 bread, 6k fuel work"
 *  - Semicolon / pipe / newline separated
 *  - One or multiple pasted bank/OPay SMS alerts
 */
export function parseQuickBatch(input, customRules = []) {
  const text = (input || '').trim();
  if (!text) return [];

  if (looksLikeBankAlert(text)) {
    const batch = parseBatchAlerts(text, customRules);
    if (batch.length > 0) return batch;
    const single = parseBankAlert(text, customRules);
    return single && !single.isCredit ? [single] : [];
  }

  const parts = text
    .split(/(?:\r?\n|[;|]|(?<!\d),|,(?!\d{3}\b))/)
    .map((p) => p.trim())
    .filter(Boolean);

  const results = [];
  for (const part of parts) {
    const parsed = parseQuickInput(part, customRules);
    if (parsed) results.push(parsed);
  }
  return results;
}

/**
 * RFC-4180 CSV parser + auto-mapper for Nigerian bank statements.
 */
export function parseCsvStatement(csvText, customRules = []) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(cell.trim()); cell = ''; }
      else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        if (ch === '\r') i++;
        row.push(cell.trim());
        if (row.some((c) => c !== '')) rows.push(row);
        row = []; cell = '';
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c !== '')) rows.push(row);
  }
  if (rows.length < 2) return [];

  const headerIdx = rows.findIndex((r) =>
    r.some((c) => /date/i.test(c)) && r.some((c) => /(desc|narration|remark|detail|amount|debit)/i.test(c))
  );
  const startIdx = headerIdx >= 0 ? headerIdx : 0;
  const headers = rows[startIdx].map((h) => h.toLowerCase());

  const dateCol = headers.findIndex((h) => /date/.test(h));
  const descCol = headers.findIndex((h) => /(narration|desc|remark|detail|particular)/.test(h));
  const debitCol = headers.findIndex((h) => /(debit|outflow|withdrawal)/.test(h));
  const amtCol = headers.findIndex((h) => /amount/.test(h));

  const parsed = [];
  for (let i = startIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const rawAmt = debitCol >= 0 ? r[debitCol] : (amtCol >= 0 ? r[amtCol] : '');
    if (!rawAmt) continue;
    const cleanAmt = parseFloat(rawAmt.replace(/[₦$£€,A-Za-z\s]/g, ''));
    if (!Number.isFinite(cleanAmt) || cleanAmt <= 0) continue;

    // Skip positive credits if using single Amount column with CR marker
    if (debitCol < 0 && /\bcr\b/i.test(rawAmt)) continue;

    const rawDesc = (descCol >= 0 ? r[descCol] : r.join(' ')) || 'Bank Transfer';
    const rawDate = dateCol >= 0 ? r[dateCol] : '';
    let date = new Date().toISOString().slice(0, 10);
    const isoM = rawDate.match(/(20\d{2}-\d{2}-\d{2})/);
    const dmyM = rawDate.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})/);
    if (isoM) date = isoM[1];
    else if (dmyM) date = `${dmyM[3]}-${dmyM[2].padStart(2, '0')}-${dmyM[1].padStart(2, '0')}`;

    const pred = predictBucketAndTag(rawDesc, customRules);
    parsed.push({
      date,
      description: rawDesc.slice(0, 64),
      amount: Math.round(cleanAmt * 100) / 100,
      bucket: pred.bucket,
      tag: pred.tag,
      paymentMethod: 'transfer',
      source: 'csv'
    });
  }
  return parsed;
}
