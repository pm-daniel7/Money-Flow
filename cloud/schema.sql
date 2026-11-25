-- NairaFlow Cloudflare D1 Schema (₦0 Free Tier)
CREATE TABLE IF NOT EXISTS months (
  id TEXT PRIMARY KEY,
  net_income REAL NOT NULL DEFAULT 0,
  personal_pct REAL,
  givings_pct REAL,
  investments_pct REAL,
  note TEXT DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  month_id TEXT NOT NULL,
  date TEXT NOT NULL,
  bucket TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  tag TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lending (
  id TEXT PRIMARY KEY,
  person TEXT NOT NULL,
  amount REAL NOT NULL,
  direction TEXT NOT NULL,
  date TEXT NOT NULL,
  note TEXT DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
