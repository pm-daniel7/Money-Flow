# MoneyFlow — Multi-Currency Personal Finance & Envelope PWA

**MoneyFlow** is a zero-build, offline-first personal finance and envelope-budgeting Progressive Web App (PWA) with natural-language expense logging, multi-currency isolation, automated month-to-month carryover (`BBF`), lending/debt tracking, and **two-way Google Sheets live sync** with automatic official FX conversion to Nigerian Naira (`₦`).

Built with vanilla ES Modules, IndexedDB, custom SVG visualizations, and Google Apps Script—requiring **no bundler, no backend server, and zero hosting cost** (deployable directly via GitHub Pages or Cloudflare Pages).

---

## Key Engineering Highlights

- **Local-First Offline Architecture (`app/src/db.js`, `app/sw.js`):**
  - Persists months, transactions, lending ledgers, and custom parsing rules offline in browser `IndexedDB` (`moneyflow_db`, including seamless legacy database migration).
  - Pre-caches application assets via Service Worker (`moneyflow-v3`) for full offline installability on mobile and desktop.
- **Two-Way Google Sheets Sync + Live FX Conversion (`cloud/google-apps-script.gs`):**
  - Connects to the user's private Google Sheet via a deployed Google Apps Script Web App (`SYNC_KEY`-authenticated `POST` endpoint avoiding CORS preflight issues).
  - **Automatic Naira (`₦`) Reporting:** Fetches live official FX rates (`open.er-api.com/v6/latest/NGN` with `PropertiesService` fallback caching) and logs `Overview`, `Transactions`, and `Lending` tabs in `₦` alongside `Orig Currency`, `Orig Amount`, and `FX Rate (to ₦)` columns plus a timestamped rate banner.
  - **Bidirectional Multi-Device Sync:** Maintains a chunked hidden `_MoneyFlowSync` JSON snapshot (`40,000`-char row chunks to respect Google Sheets' cell limits) so devices can **Sync (Merge)** by `updatedAt` timestamps or **Pull from Sheet** onto any new browser without exposing personal data in GitHub.
- **Isolated Multi-Currency Envelope Engine (`app/src/budgetEngine.js`):**
  - Supports **NGN (`₦`)**, **USD (`$`)**, **GBP (`£`)**, and **EUR (`€`)**.
  - Deducts prior month **Work Expenses** off the top before computing distributable income across per-month percentage splits (`Givings`, `Personal`, `Investments`).
  - Isolates `Auto BBF` (brought-balance-forward), `Investments & Reserves`, and `Lending` strictly per currency so cross-currency months never corrupt prior Naira balances.
- **3-Second Smart Parser (`app/src/parser.js`):**
  - Parses quick natural-language batch inputs (`"200 egg, 6k fuel work, $15 coffee"`), Nigerian bank/OPay debit SMS alerts, and bank CSV statements with learned bucket & tag auto-classification (`#family`, `#home`, `#church`, `#gifts`).
- **Privacy & Interactive Charts (`app/src/charts.js`):**
  - Zero-dependency responsive SVG stacked bar trend charts and Givings breakdowns, plus Privacy Eye toggles for home balances and Investments reserves.

---

## Project Structure

```text
├── app/
│   ├── index.html              # App shell, navigation tabs, modal & toast roots
│   ├── manifest.webmanifest    # PWA manifest
│   ├── sw.js                   # Network-first Service Worker cache
│   ├── icons/icon.svg          # MoneyFlow emerald M + lightning SVG icon
│   ├── styles/main.css         # Light & Dark mode OPay-inspired emerald theme
│   └── src/
│       ├── app.js              # UI state, Log / Transactions / Insights / Settings views
│       ├── budgetEngine.js     # Pure envelope math, BBF carryover, FX formatting
│       ├── parser.js           # Multi-currency NL input, SMS alert & CSV parser
│       ├── charts.js           # Pure SVG trend & tag charts
│       ├── db.js               # IndexedDB persistence, CSV/JSON export & 2-way sync
│       ├── datePicker.js       # Custom inline calendar date field
│       └── seedData.js         # Fictional portfolio demo dataset
├── cloud/
│   └── google-apps-script.gs   # Two-way Google Sheets sync + official FX Naira converter
├── start-app.ps1               # Dependency-free PowerShell local static server
└── start-app.bat               # Windows 1-click launcher
```

---

## Running Locally

Because MoneyFlow uses standard ES modules with zero build step, any static file server works:

```powershell
# Windows (PowerShell — zero dependencies)
.\start-app.ps1
# Opens http://localhost:8765
```

Or using Python / Node if preferred:

```bash
python -m http.server 8765 --directory app
```

---

## Setting Up Your Own Private Google Sheets Sync

Your personal ledger stays completely private inside your browser and your own Google Sheet (never committed to Git):

1. Open your Google Sheet → **Extensions → Apps Script**.
2. Paste the contents of [`cloud/google-apps-script.gs`](cloud/google-apps-script.gs) and change `SYNC_KEY` to your own secret passphrase.
3. Click **Deploy → New deployment → Web app** (*Execute as: Me*, *Who has access: Anyone*).
4. Open **MoneyFlow → Settings → Cloud Sync & Backup**, select **Google Sheets (Live Sync)**, paste your Web App URL and `SYNC_KEY`, and click **Sync Now** (or **Pull from Sheet** when opening MoneyFlow from a new device).

---

## Deploying Publicly as a Portfolio Demo

- **GitHub Pages / Cloudflare Pages:** Point static hosting directly to the `app/` directory with an empty build command.
- Public visitors automatically load the anonymized demo dataset in `app/src/seedData.js`, while your personal records stay isolated in your browser `IndexedDB` and private Google Sheet.
