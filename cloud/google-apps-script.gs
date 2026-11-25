/**
 * MoneyFlow -> Two-Way Google Sheets Sync (Google Apps Script)
 * - Always logs Overview, Transactions, and Lending values in Nigerian Naira (₦)
 *   equivalent using official FX rates, stating original currency, original amount,
 *   and FX rate on every sheet.
 * - Stores full multi-device app snapshot cleanly in a hidden `_MoneyFlowSync` tab
 *   (chunked across rows to support any ledger size) so any device can Push or Pull.
 *
 * Setup inside your Google Sheet:
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Paste this entire file and set SYNC_KEY below to any secret passphrase.
 * 3. Click Deploy -> New deployment -> Type: Web app.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web App URL + your SYNC_KEY into MoneyFlow -> Settings -> Google Sheets (Live Sync).
 */

const SYNC_KEY = 'change-this-to-your-secret-key';
const SYNC_SHEET_NAME = '_MoneyFlowSync';
const CHUNK_SIZE = 40000;

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!SYNC_KEY || payload.syncKey !== SYNC_KEY) {
      return jsonOut({ ok: false, error: 'Unauthorized: invalid syncKey' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = payload.action || 'push';

    if (action === 'pull') {
      const snapshot = readSyncSnapshot(ss);
      return jsonOut({
        ok: true,
        action: snapshot ? 'pulled' : 'empty',
        snapshot: snapshot
      });
    }

    const rateInfo = fetchOfficialNairaRates();
    writeOverviewSheet(ss, payload.summaries || [], rateInfo);
    writeTransactionsSheet(ss, payload.transactions || [], rateInfo);
    writeLendingSheet(ss, payload.lending || [], rateInfo);

    const updatedAt = payload.updatedAt || new Date().toISOString();
    if (payload.snapshot) {
      writeSyncSnapshot(ss, { ...payload.snapshot, updatedAt });
    }

    return jsonOut({ ok: true, action: 'pushed', updatedAt, rates: rateInfo.rates });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function readSyncSnapshot(ss) {
  const sheet = ss.getSheetByName(SYNC_SHEET_NAME);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return null;
  const values = sheet.getRange(1, 1, lastRow, 1).getValues();
  const raw = values.map((r) => String(r[0] || '')).join('');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeSyncSnapshot(ss, snapshot) {
  const sheet = getOrCreateSheet(ss, SYNC_SHEET_NAME);
  if (!sheet.isSheetHidden()) sheet.hideSheet();
  sheet.clearContents();
  const json = JSON.stringify(snapshot);
  const rows = [];
  for (let i = 0; i < json.length; i += CHUNK_SIZE) {
    rows.push([json.slice(i, i + CHUNK_SIZE)]);
  }
  if (rows.length === 0) rows.push(['{}']);
  sheet.getRange(1, 1, rows.length, 1).setValues(rows);
}

/**
 * Fetches official FX rates relative to NGN from open.er-api.com (no key needed)
 * and caches the latest successful lookup in ScriptProperties as fallback.
 */
function fetchOfficialNairaRates() {
  const props = PropertiesService.getScriptProperties();
  const fallback = {
    NGN: 1,
    USD: Number(props.getProperty('RATE_USD_NGN') || 1550),
    GBP: Number(props.getProperty('RATE_GBP_NGN') || 1950),
    EUR: Number(props.getProperty('RATE_EUR_NGN') || 1680)
  };
  let fetchedAt = props.getProperty('RATE_FETCHED_AT') || 'cached fallback';
  let source = 'cached';

  try {
    const resp = UrlFetchApp.fetch('https://open.er-api.com/v6/latest/NGN', { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      const data = JSON.parse(resp.getContentText());
      if (data && data.result === 'success' && data.rates) {
        const rates = { NGN: 1 };
        ['USD', 'GBP', 'EUR'].forEach((code) => {
          const perNgn = Number(data.rates[code]);
          rates[code] = perNgn > 0 ? Math.round((1 / perNgn) * 100) / 100 : fallback[code];
          props.setProperty('RATE_' + code + '_NGN', String(rates[code]));
        });
        fetchedAt = data.time_last_update_utc || new Date().toISOString();
        props.setProperty('RATE_FETCHED_AT', fetchedAt);
        source = 'open.er-api.com';
        return { rates, fetchedAt, source };
      }
    }
  } catch (_) {}

  return { rates: fallback, fetchedAt, source };
}

function getRate(rateInfo, code) {
  const c = (code || 'NGN').toUpperCase();
  return rateInfo.rates[c] || 1;
}

function formatRateBanner(rateInfo) {
  return 'Official FX Rates to ₦ (' + rateInfo.source + ' • ' + rateInfo.fetchedAt + '):  ' +
    '$1 = ₦' + rateInfo.rates.USD.toLocaleString() + '   |   ' +
    '£1 = ₦' + rateInfo.rates.GBP.toLocaleString() + '   |   ' +
    '€1 = ₦' + rateInfo.rates.EUR.toLocaleString();
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function writeOverviewSheet(ss, summaries, rateInfo) {
  const sheet = getOrCreateSheet(ss, 'Overview');
  sheet.clearContents();

  const banner = [formatRateBanner(rateInfo)];
  const headers = [
    'Month', 'Orig Currency', 'FX Rate (to ₦)', 'Orig Net Income',
    'Net Income (₦)', 'Prev Work (₦)', 'Distributable (₦)',
    'Personal %', 'Personal Alloc (₦)', 'Personal Spent (₦)', 'Personal Left (₦)',
    'Givings %', 'Givings Alloc (₦)', 'Givings Spent (₦)', 'Givings Left (₦)',
    'Invest %', 'Invest Alloc (₦)', 'Invest Spent (₦)', 'Invest Left (₦)',
    'Work Spent (₦)'
  ];

  const rows = [
    banner.concat(Array(headers.length - 1).fill('')),
    headers
  ];

  for (const s of summaries) {
    if (s.isBaselineOnly) continue;
    const cur = s.currency || 'NGN';
    const r = getRate(rateInfo, cur);
    rows.push([
      s.id,
      cur,
      r,
      s.netIncome || 0,
      (s.netIncome || 0) * r,
      (s.prevWorkSpent || 0) * r,
      (s.distributable || 0) * r,
      (s.pct && s.pct.personal ? s.pct.personal : 0) / 100,
      (s.alloc && s.alloc.personal ? s.alloc.personal : 0) * r,
      (s.spent && s.spent.personal ? s.spent.personal : 0) * r,
      (s.balance && s.balance.personal ? s.balance.personal : 0) * r,
      (s.pct && s.pct.givings ? s.pct.givings : 0) / 100,
      (s.alloc && s.alloc.givings ? s.alloc.givings : 0) * r,
      (s.spent && s.spent.givings ? s.spent.givings : 0) * r,
      (s.balance && s.balance.givings ? s.balance.givings : 0) * r,
      (s.pct && s.pct.investments ? s.pct.investments : 0) / 100,
      (s.alloc && s.alloc.investments ? s.alloc.investments : 0) * r,
      (s.spent && s.spent.investments ? s.spent.investments : 0) * r,
      (s.balance && s.balance.investments ? s.balance.investments : 0) * r,
      (s.spent && s.spent.work ? s.spent.work : 0) * r
    ]);
  }

  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1).setFontStyle('italic');
  sheet.getRange(2, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(2);

  if (rows.length > 2) {
    const count = rows.length - 2;
    sheet.getRange(3, 3, count, 1).setNumberFormat('#,##0.00');
    sheet.getRange(3, 4, count, 1).setNumberFormat('#,##0.00');
    [5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19, 20].forEach((col) => {
      sheet.getRange(3, col, count, 1).setNumberFormat('₦#,##0.00');
    });
    [8, 12, 16].forEach((col) => {
      sheet.getRange(3, col, count, 1).setNumberFormat('0.0%');
    });
  }
}

function writeTransactionsSheet(ss, transactions, rateInfo) {
  const sheet = getOrCreateSheet(ss, 'Transactions');
  sheet.clearContents();
  const banner = [formatRateBanner(rateInfo)];
  const headers = [
    'Date', 'Month', 'Orig Currency', 'Orig Amount', 'FX Rate (to ₦)', 'Amount (₦)',
    'Bucket', 'Description', 'Method', 'Tag', 'Source'
  ];
  const sorted = [...transactions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const rows = [
    banner.concat(Array(headers.length - 1).fill('')),
    headers
  ];

  for (const t of sorted) {
    const cur = t.currency || 'NGN';
    const r = getRate(rateInfo, cur);
    const orig = Number(t.amount) || 0;
    rows.push([
      t.date || '', t.monthId || '', cur, orig, r, orig * r,
      t.bucket || '', t.description || '', t.paymentMethod || 'cash', t.tag || '', t.source || 'manual'
    ]);
  }

  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1).setFontStyle('italic');
  sheet.getRange(2, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(2);

  if (rows.length > 2) {
    const count = rows.length - 2;
    sheet.getRange(3, 4, count, 2).setNumberFormat('#,##0.00');
    sheet.getRange(3, 6, count, 1).setNumberFormat('₦#,##0.00');
  }
}

function writeLendingSheet(ss, lending, rateInfo) {
  const sheet = getOrCreateSheet(ss, 'Lending');
  sheet.clearContents();
  const banner = [formatRateBanner(rateInfo)];
  const headers = ['Date', 'Person', 'Orig Currency', 'Orig Amount', 'FX Rate (to ₦)', 'Amount (₦)', 'Direction', 'Note'];
  const rows = [
    banner.concat(Array(headers.length - 1).fill('')),
    headers
  ];

  for (const l of lending) {
    const cur = l.currency || 'NGN';
    const r = getRate(rateInfo, cur);
    const orig = Number(l.amount) || 0;
    rows.push([l.date || '', l.person || '', cur, orig, r, orig * r, l.direction || '', l.note || '']);
  }

  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1).setFontStyle('italic');
  sheet.getRange(2, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(2);

  if (rows.length > 2) {
    const count = rows.length - 2;
    sheet.getRange(3, 4, count, 2).setNumberFormat('#,##0.00');
    sheet.getRange(3, 6, count, 1).setNumberFormat('₦#,##0.00');
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
