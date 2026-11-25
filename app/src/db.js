/**
 * MoneyFlow Local-First Persistence (IndexedDB) + Multi-Device Sync
 * - Works 100% offline via IndexedDB (moneyflow_db, with automatic migration from nairaflow_db)
 * - JSON / CSV Export & Import for instant manual backup
 * - Optional Google Sheets Live Sync
 */

import { computeAllMonths, DEFAULT_CHIPS, DEFAULT_RULES } from './budgetEngine.js';
import { SEED_LENDING, SEED_MONTHS, SEED_TRANSACTIONS } from './seedData.js';

const DB_NAME = 'moneyflow_db';
const LEGACY_DB_NAME = 'nairaflow_db';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('months')) db.createObjectStore('months', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('transactions')) {
        const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('monthId', 'monthId', { unique: false });
      }
      if (!db.objectStoreNames.contains('lending')) db.createObjectStore('lending', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function putItem(storeName, item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteItem(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function replaceStore(storeName, items) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getKv(key, fallback = null) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
    req.onerror = () => reject(req.error);
  });
}

export async function setKv(key, value) {
  return putItem('kv', { key, value });
}

async function readLegacyDatabase() {
  if (typeof indexedDB.databases === 'function') {
    try {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === LEGACY_DB_NAME)) return null;
    } catch {
      // Fallback below
    }
  }
  return new Promise((resolve) => {
    let createdNew = false;
    let req;
    try {
      req = indexedDB.open(LEGACY_DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      createdNew = true;
      try { req.transaction?.abort(); } catch {}
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const legacyDb = req.result;
      if (createdNew) {
        legacyDb.close();
        try { indexedDB.deleteDatabase(LEGACY_DB_NAME); } catch {}
        resolve(null);
        return;
      }
      const stores = ['months', 'transactions', 'lending', 'kv'].filter((s) =>
        legacyDb.objectStoreNames.contains(s)
      );
      if (stores.length === 0) {
        legacyDb.close();
        resolve(null);
        return;
      }
      const data = { months: [], transactions: [], lending: [], kv: [] };
      const tx = legacyDb.transaction(stores, 'readonly');
      for (const s of stores) {
        const r = tx.objectStore(s).getAll();
        r.onsuccess = () => { data[s] = r.result || []; };
      }
      tx.oncomplete = () => {
        legacyDb.close();
        resolve(data);
      };
      tx.onerror = () => {
        legacyDb.close();
        resolve(null);
      };
    };
  });
}

async function migrateFromLegacyDb() {
  const alreadyMigrated = await getKv('migrated_nairaflow_v1', false);
  if (alreadyMigrated) return false;
  const legacy = await readLegacyDatabase();
  if (!legacy) return false;

  const hasRecords = legacy.months.length > 0 || legacy.transactions.length > 0 || legacy.lending.length > 0;
  if (hasRecords) {
    if (legacy.months.length > 0) await replaceStore('months', legacy.months);
    if (legacy.transactions.length > 0) await replaceStore('transactions', legacy.transactions);
    if (legacy.lending.length > 0) await replaceStore('lending', legacy.lending);
  }
  for (const entry of legacy.kv) {
    if (entry && entry.key) await putItem('kv', entry);
  }
  if (!hasRecords) {
    await replaceStore('months', SEED_MONTHS);
    await replaceStore('transactions', SEED_TRANSACTIONS);
    await replaceStore('lending', SEED_LENDING);
  }
  await setKv('migrated_nairaflow_v1', true);
  await setKv('is_demo_seed', false);
  await setKv('seeded_v1', true);
  try {
    await new Promise((res) => {
      const delReq = indexedDB.deleteDatabase(LEGACY_DB_NAME);
      delReq.onsuccess = () => res();
      delReq.onerror = () => res();
      delReq.onblocked = () => res();
      setTimeout(res, 400);
    });
  } catch {}
  return true;
}

export async function ensureSeeded() {
  const seeded = await getKv('seeded_v1', false);
  if (seeded) return false;
  const migrated = await migrateFromLegacyDb();
  if (migrated) return true;
  await replaceStore('months', SEED_MONTHS);
  await replaceStore('transactions', SEED_TRANSACTIONS);
  await replaceStore('lending', SEED_LENDING);
  await setKv('rules', DEFAULT_RULES);
  await setKv('chips', DEFAULT_CHIPS);
  await setKv('customRules', []);
  await setKv('updatedAt', new Date().toISOString());
  await setKv('migrated_nairaflow_v1', true);
  await setKv('is_demo_seed', true);
  await setKv('seeded_v1', true);
  return true;
}

export async function loadDemoSeed() {
  await replaceStore('months', SEED_MONTHS);
  await replaceStore('transactions', SEED_TRANSACTIONS);
  await replaceStore('lending', SEED_LENDING);
  await setKv('rules', DEFAULT_RULES);
  await setKv('chips', DEFAULT_CHIPS);
  await setKv('is_demo_seed', true);
  await setKv('seeded_v1', true);
  await setKv('updatedAt', new Date().toISOString());
}

export const reseedFromExcel = loadDemoSeed;

export async function loadAppState() {
  await ensureSeeded();
  const [months, allTx, allLending, rules, chips, customRules, syncConfig, updatedAt] = await Promise.all([
    getAll('months'),
    getAll('transactions'),
    getAll('lending'),
    getKv('rules', DEFAULT_RULES),
    getKv('chips', DEFAULT_CHIPS),
    getKv('customRules', []),
    getKv('syncConfig', { provider: 'none', sheetUrl: '', sheetKey: '', workerUrl: '', syncKey: '', gistId: '', token: '', lastSyncAt: null }),
    getKv('updatedAt', null)
  ]);
  return {
    months,
    transactions: allTx.filter((t) => !t.deleted),
    lending: allLending.filter((l) => !l.deleted),
    rules,
    chips,
    customRules,
    syncConfig,
    updatedAt
  };
}

export async function saveMonth(month) {
  const rec = { ...month, updatedAt: new Date().toISOString() };
  await putItem('months', rec);
  await setKv('is_demo_seed', false);
  await setKv('updatedAt', rec.updatedAt);
}

export async function saveTransaction(tx) {
  const rec = { ...tx, deleted: false, updatedAt: new Date().toISOString() };
  await putItem('transactions', rec);
  await setKv('is_demo_seed', false);
  await setKv('updatedAt', rec.updatedAt);
}

export async function deleteTransaction(id) {
  const all = await getAll('transactions');
  const existing = all.find((t) => t.id === id);
  const now = new Date().toISOString();
  if (existing) {
    await putItem('transactions', { ...existing, deleted: true, updatedAt: now });
  } else {
    await deleteItem('transactions', id);
  }
  await setKv('is_demo_seed', false);
  await setKv('updatedAt', now);
}

export async function saveLending(entry) {
  const rec = { ...entry, deleted: false, updatedAt: new Date().toISOString() };
  await putItem('lending', rec);
  await setKv('is_demo_seed', false);
  await setKv('updatedAt', rec.updatedAt);
}

export async function deleteLending(id) {
  const all = await getAll('lending');
  const existing = all.find((l) => l.id === id);
  const now = new Date().toISOString();
  if (existing) {
    await putItem('lending', { ...existing, deleted: true, updatedAt: now });
  } else {
    await deleteItem('lending', id);
  }
  await setKv('is_demo_seed', false);
  await setKv('updatedAt', now);
}

export async function saveSettings({ rules, chips, customRules }) {
  const now = new Date().toISOString();
  if (rules) { await setKv('rules', rules); await setKv('rules_updatedAt', now); }
  if (chips) { await setKv('chips', chips); await setKv('chips_updatedAt', now); }
  if (customRules) { await setKv('customRules', customRules); await setKv('customRules_updatedAt', now); }
  await setKv('is_demo_seed', false);
  await setKv('updatedAt', now);
}

export async function saveSyncConfig(syncConfig) {
  await setKv('syncConfig', syncConfig);
}

function mergeById(localItems = [], remoteItems = []) {
  const map = new Map();
  for (const item of [...remoteItems, ...localItems]) {
    if (!item || !item.id) continue;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      continue;
    }
    const tNew = Date.parse(item.updatedAt || 0) || 0;
    const tPrev = Date.parse(prev.updatedAt || 0) || 0;
    if (tNew >= tPrev) map.set(item.id, item);
  }
  return [...map.values()];
}

async function buildSyncSnapshot() {
  const [months, transactions, lending, rules, chips, customRules, updatedAt, rAt, cAt, crAt] = await Promise.all([
    getAll('months'),
    getAll('transactions'),
    getAll('lending'),
    getKv('rules', DEFAULT_RULES),
    getKv('chips', DEFAULT_CHIPS),
    getKv('customRules', []),
    getKv('updatedAt', new Date().toISOString()),
    getKv('rules_updatedAt', '2026-01-01T00:00:00.000Z'),
    getKv('chips_updatedAt', '2026-01-01T00:00:00.000Z'),
    getKv('customRules_updatedAt', '2026-01-01T00:00:00.000Z')
  ]);
  return {
    app: 'MoneyFlow',
    version: 2,
    updatedAt: updatedAt || new Date().toISOString(),
    months,
    transactions,
    lending,
    rules,
    chips,
    customRules,
    rules_updatedAt: rAt,
    chips_updatedAt: cAt,
    customRules_updatedAt: crAt
  };
}

async function applyRemoteSnapshot(snapshot) {
  await replaceStore('months', snapshot.months || []);
  await replaceStore('transactions', snapshot.transactions || []);
  await replaceStore('lending', snapshot.lending || []);
  if (snapshot.rules) {
    await setKv('rules', snapshot.rules);
    await setKv('rules_updatedAt', snapshot.rules_updatedAt || snapshot.updatedAt || new Date().toISOString());
  }
  if (snapshot.chips) {
    await setKv('chips', snapshot.chips);
    await setKv('chips_updatedAt', snapshot.chips_updatedAt || snapshot.updatedAt || new Date().toISOString());
  }
  if (snapshot.customRules) {
    await setKv('customRules', snapshot.customRules);
    await setKv('customRules_updatedAt', snapshot.customRules_updatedAt || snapshot.updatedAt || new Date().toISOString());
  }
  await setKv('updatedAt', snapshot.updatedAt || new Date().toISOString());
  await setKv('is_demo_seed', false);
  await setKv('seeded_v1', true);
}

/**
 * Two-Way Google Sheets Sync via a Google Apps Script Web App deployed inside the user's Sheet.
 * Modes:
 * - 'pull': Downloads the `_MoneyFlowSync` snapshot from Google Sheets into IndexedDB.
 * - 'push': Uploads current local state + Naira-converted Overview/Transactions/Lending sheets.
 * - 'sync': Pulls remote state, item-merges by updatedAt (skipping untouched demo seed data), and pushes back.
 */
export async function syncWithGoogleSheets(config, summariesList = [], mode = 'sync') {
  const sheetUrl = (config?.sheetUrl || '').trim();
  const sheetKey = (config?.sheetKey || '').trim();
  if (!sheetUrl || !sheetKey) {
    throw new Error('Enter both your Google Apps Script Web App URL and Sync Key.');
  }

  const postToSheet = async (body) => {
    const res = await fetch(sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ syncKey: sheetKey, ...body })
    });
    if (!res.ok) {
      throw new Error(`Google Sheets sync failed (${res.status}). Check Web App URL.`);
    }
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || 'Google Sheets rejected sync.');
    }
    return data;
  };

  let reloaded = false;
  let finalAction = 'pushed';

  if (mode === 'pull' || mode === 'sync') {
    const pullRes = await postToSheet({ action: 'pull' });
    const remote = pullRes.snapshot;

    if (mode === 'pull') {
      if (!remote || !Array.isArray(remote.months)) {
        throw new Error('No MoneyFlow sync snapshot found in this Google Sheet yet. Click Sync Now first.');
      }
      await applyRemoteSnapshot(remote);
      const updatedCfg = { ...config, provider: 'gsheets', sheetUrl, sheetKey, lastSyncAt: remote.updatedAt || new Date().toISOString() };
      await saveSyncConfig(updatedCfg);
      return { action: 'pulled', reloaded: true, config: updatedCfg };
    }

    if (remote && Array.isArray(remote.months)) {
      const isDemoSeed = await getKv('is_demo_seed', false);
      if (isDemoSeed) {
        await applyRemoteSnapshot(remote);
        const updatedCfg = { ...config, provider: 'gsheets', sheetUrl, sheetKey, lastSyncAt: remote.updatedAt || new Date().toISOString() };
        await saveSyncConfig(updatedCfg);
        return { action: 'pulled', reloaded: true, config: updatedCfg };
      }

      const local = await buildSyncSnapshot();
      const mergedMonths = mergeById(local.months, remote.months);
      const mergedTx = mergeById(local.transactions, remote.transactions);
      const mergedLending = mergeById(local.lending, remote.lending);

      const pickNewer = (lVal, lAt, rVal, rAt) =>
        (Date.parse(rAt || 0) || 0) > (Date.parse(lAt || 0) || 0) && rVal !== undefined
          ? { val: rVal, at: rAt }
          : { val: lVal, at: lAt };

      const mRules = pickNewer(local.rules, local.rules_updatedAt, remote.rules, remote.rules_updatedAt);
      const mChips = pickNewer(local.chips, local.chips_updatedAt, remote.chips, remote.chips_updatedAt);
      const mCustom = pickNewer(local.customRules, local.customRules_updatedAt, remote.customRules, remote.customRules_updatedAt);

      const mergedSnapshot = {
        app: 'MoneyFlow',
        version: 2,
        updatedAt: new Date().toISOString(),
        months: mergedMonths,
        transactions: mergedTx,
        lending: mergedLending,
        rules: mRules.val,
        chips: mChips.val,
        customRules: mCustom.val,
        rules_updatedAt: mRules.at,
        chips_updatedAt: mChips.at,
        customRules_updatedAt: mCustom.at
      };
      await applyRemoteSnapshot(mergedSnapshot);
      reloaded = true;
      finalAction = 'merged';
    }
  }

  const snapshot = await buildSyncSnapshot();
  const activeTx = (snapshot.transactions || []).filter((t) => !t.deleted);
  const activeLending = (snapshot.lending || []).filter((l) => !l.deleted);
  const freshSummaries = summariesList && summariesList.length && !reloaded
    ? summariesList
    : [...computeAllMonths(snapshot.months, activeTx, snapshot.rules).values()];

  const pushRes = await postToSheet({
    action: 'push',
    updatedAt: snapshot.updatedAt,
    summaries: freshSummaries,
    transactions: activeTx,
    lending: activeLending,
    snapshot
  });

  const updatedCfg = { ...config, provider: 'gsheets', sheetUrl, sheetKey, lastSyncAt: pushRes.updatedAt || new Date().toISOString() };
  await saveSyncConfig(updatedCfg);
  return { action: finalAction, reloaded, config: updatedCfg };
}

/**
 * ₦0 Multi-Device Item-Level Merge Sync via Cloudflare Worker + D1
 * Merges offline edits from any phone/laptop without overwriting each other.
 */
export async function syncWithCloudflareWorker(config) {
  const workerUrl = (config?.workerUrl || '').trim().replace(/\/+$/, '');
  const syncKey = (config?.syncKey || '').trim();
  if (!workerUrl || !syncKey) {
    throw new Error('Enter both your Cloudflare Worker URL and Sync Key.');
  }

  const [months, transactions, lending, rules, chips, customRules, rAt, cAt, crAt] = await Promise.all([
    getAll('months'),
    getAll('transactions'),
    getAll('lending'),
    getKv('rules', DEFAULT_RULES),
    getKv('chips', DEFAULT_CHIPS),
    getKv('customRules', []),
    getKv('rules_updatedAt', '2026-01-01T00:00:00.000Z'),
    getKv('chips_updatedAt', '2026-01-01T00:00:00.000Z'),
    getKv('customRules_updatedAt', '2026-01-01T00:00:00.000Z')
  ]);

  const res = await fetch(`${workerUrl}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sync-Key': syncKey },
    body: JSON.stringify({
      months,
      transactions,
      lending,
      settings: {
        rules: { value: rules, updatedAt: rAt },
        chips: { value: chips, updatedAt: cAt },
        customRules: { value: customRules, updatedAt: crAt }
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Cloudflare Sync failed (${res.status}): ${errText || 'Check URL and Sync Key.'}`);
  }

  const merged = await res.json();
  if (Array.isArray(merged.months)) await replaceStore('months', merged.months);
  if (Array.isArray(merged.transactions)) await replaceStore('transactions', merged.transactions);
  if (Array.isArray(merged.lending)) await replaceStore('lending', merged.lending);
  if (merged.settings?.rules?.value) await setKv('rules', merged.settings.rules.value);
  if (merged.settings?.chips?.value) await setKv('chips', merged.settings.chips.value);
  if (merged.settings?.customRules?.value) await setKv('customRules', merged.settings.customRules.value);
  await setKv('updatedAt', merged.syncedAt || new Date().toISOString());

  const updatedCfg = { ...config, provider: 'cloudflare', workerUrl, syncKey, lastSyncAt: merged.syncedAt || new Date().toISOString() };
  await saveSyncConfig(updatedCfg);
  return { action: 'merged', config: updatedCfg };
}

export async function exportBackupPayload() {
  const state = await loadAppState();
  return {
    app: 'MoneyFlow',
    version: 1,
    exportedAt: new Date().toISOString(),
    updatedAt: state.updatedAt || new Date().toISOString(),
    months: state.months,
    transactions: state.transactions,
    lending: state.lending,
    rules: state.rules,
    chips: state.chips,
    customRules: state.customRules
  };
}

export async function importBackupPayload(payload) {
  if (!payload || !Array.isArray(payload.months) || !Array.isArray(payload.transactions)) {
    throw new Error('Invalid MoneyFlow backup file.');
  }
  await replaceStore('months', payload.months);
  await replaceStore('transactions', payload.transactions);
  await replaceStore('lending', payload.lending || []);
  if (payload.rules) await setKv('rules', payload.rules);
  if (payload.chips) await setKv('chips', payload.chips);
  if (payload.customRules) await setKv('customRules', payload.customRules);
  await setKv('is_demo_seed', false);
  await setKv('updatedAt', payload.updatedAt || new Date().toISOString());
  await setKv('seeded_v1', true);
}

/**
 * ₦0 Multi-Device Sync via a Private GitHub Gist
 * Stores a single `nairaflow-data.json` file in the user's private Gist.
 */
export async function syncWithGitHubGist(config, direction = 'auto') {
  const token = (config?.token || '').trim();
  let gistId = (config?.gistId || '').trim();
  if (!token) throw new Error('Enter your GitHub Personal Access Token (gist scope).');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };

  const localPayload = await exportBackupPayload();

  // Create new private Gist if gistId is empty
  if (!gistId) {
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: 'NairaFlow Personal Finance Sync (Private)',
        public: false,
        files: { 'nairaflow-data.json': { content: JSON.stringify(localPayload) } }
      })
    });
    if (!res.ok) throw new Error(`GitHub Gist error (${res.status}). Check token permissions.`);
    const created = await res.json();
    const updatedCfg = { gistId: created.id, token, lastSyncAt: new Date().toISOString() };
    await saveSyncConfig(updatedCfg);
    return { action: 'created', config: updatedCfg };
  }

  // Fetch remote Gist
  const getRes = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
  if (!getRes.ok) throw new Error(`Could not fetch Gist (${getRes.status}). Check Gist ID & token.`);
  const gist = await getRes.json();
  const fileObj = gist.files && gist.files['nairaflow-data.json'];

  let remotePayload = null;
  if (fileObj && fileObj.content) {
    try { remotePayload = JSON.parse(fileObj.content); } catch { remotePayload = null; }
  }

  const localTime = Date.parse(localPayload.updatedAt || 0) || 0;
  const remoteTime = remotePayload ? (Date.parse(remotePayload.updatedAt || 0) || 0) : 0;

  const shouldPull = direction === 'pull' || (direction === 'auto' && remotePayload && remoteTime > localTime + 1000);
  if (shouldPull && remotePayload) {
    await importBackupPayload(remotePayload);
    const updatedCfg = { gistId, token, lastSyncAt: new Date().toISOString() };
    await saveSyncConfig(updatedCfg);
    return { action: 'pulled', config: updatedCfg };
  }

  // Push local -> remote
  const patchRes = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      files: { 'nairaflow-data.json': { content: JSON.stringify(localPayload) } }
    })
  });
  if (!patchRes.ok) throw new Error(`GitHub Gist push failed (${patchRes.status}).`);
  const updatedCfg = { gistId, token, lastSyncAt: new Date().toISOString() };
  await saveSyncConfig(updatedCfg);
  return { action: 'pushed', config: updatedCfg };
}

export function exportTransactionsCsv(transactions, months = []) {
  const monthCur = new Map(months.map((m) => [m.id, m.currency || 'NGN']));
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['Date,Month,Currency,Bucket,Description,Amount,Payment Method,Tag,Source'];
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  for (const t of sorted) {
    lines.push([
      esc(t.date),
      esc(t.monthId),
      esc(t.currency || monthCur.get(t.monthId) || 'NGN'),
      esc(t.bucket),
      esc(t.description),
      t.amount,
      esc(t.paymentMethod || 'cash'),
      esc(t.tag || ''),
      esc(t.source || 'manual')
    ].join(','));
  }
  return lines.join('\n');
}
