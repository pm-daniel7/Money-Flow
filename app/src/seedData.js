// Fictional portfolio demo dataset for MoneyFlow (public showcase only).
// Personal financial history lives exclusively in local IndexedDB + private Google Sheets sync.

export const SEED_MONTHS = [
  { id: '2026-08', currency: 'NGN', netIncome: 380000, givingsPct: 25, personalPct: 10, investmentsPct: 65, note: 'August 2026' },
  { id: '2026-09', currency: 'NGN', netIncome: 420000, givingsPct: 25, personalPct: 10, investmentsPct: 65, note: 'September 2026' },
  { id: '2026-10', currency: 'NGN', netIncome: 450000, givingsPct: 30, personalPct: 5, investmentsPct: 65, note: 'October 2026' },
  { id: '2026-11', currency: 'NGN', netIncome: 450000, givingsPct: 30, personalPct: 5, investmentsPct: 65, note: 'November 2026' }
];

export const SEED_LENDING = [
  {
    id: 'demo_lend_1',
    person: 'Alex',
    currency: 'NGN',
    amount: 20000,
    direction: 'lent',
    date: '2026-10-12',
    note: 'Short-term float'
  },
  {
    id: 'demo_lend_2',
    person: 'Alex',
    currency: 'NGN',
    amount: 8000,
    direction: 'repaid',
    date: '2026-11-04',
    note: 'Partial repayment'
  }
];

export const SEED_TRANSACTIONS = [
  // August 2026
  { id: 'demo_tx_1', monthId: '2026-08', currency: 'NGN', date: '2026-08-03', bucket: 'work', description: 'Mobile Data & Fiber', amount: 18000, paymentMethod: 'transfer', tag: '', source: 'demo' },
  { id: 'demo_tx_2', monthId: '2026-08', currency: 'NGN', date: '2026-08-05', bucket: 'work', description: 'Commute Fuel', amount: 12000, paymentMethod: 'cash', tag: '', source: 'demo' },
  { id: 'demo_tx_3', monthId: '2026-08', currency: 'NGN', date: '2026-08-07', bucket: 'personal', description: 'Groceries & Produce', amount: 14500, paymentMethod: 'card', tag: '', source: 'demo' },
  { id: 'demo_tx_4', monthId: '2026-08', currency: 'NGN', date: '2026-08-10', bucket: 'personal', description: 'Coffee & Lunch', amount: 4200, paymentMethod: 'cash', tag: '', source: 'demo' },
  { id: 'demo_tx_5', monthId: '2026-08', currency: 'NGN', date: '2026-08-12', bucket: 'givings', description: 'Household Foodstuffs', amount: 42000, paymentMethod: 'transfer', tag: 'home', source: 'demo' },
  { id: 'demo_tx_6', monthId: '2026-08', currency: 'NGN', date: '2026-08-16', bucket: 'givings', description: 'Community Tithe', amount: 25000, paymentMethod: 'transfer', tag: 'church', source: 'demo' },
  { id: 'demo_tx_7', monthId: '2026-08', currency: 'NGN', date: '2026-08-20', bucket: 'givings', description: 'Family Support', amount: 18000, paymentMethod: 'transfer', tag: 'family', source: 'demo' },
  { id: 'demo_tx_8', monthId: '2026-08', currency: 'NGN', date: '2026-08-24', bucket: 'investments', description: 'Treasury Bills Allocation', amount: 180000, paymentMethod: 'transfer', tag: '', source: 'demo' },

  // September 2026
  { id: 'demo_tx_9', monthId: '2026-09', currency: 'NGN', date: '2026-09-02', bucket: 'work', description: 'Mobile Data & Fiber', amount: 18000, paymentMethod: 'transfer', tag: '', source: 'demo' },
  { id: 'demo_tx_10', monthId: '2026-09', currency: 'NGN', date: '2026-09-06', bucket: 'work', description: 'Client Visit Transit', amount: 9500, paymentMethod: 'cash', tag: '', source: 'demo' },
  { id: 'demo_tx_11', monthId: '2026-09', currency: 'NGN', date: '2026-09-08', bucket: 'personal', description: 'Bread & Breakfast', amount: 3500, paymentMethod: 'cash', tag: '', source: 'demo' },
  { id: 'demo_tx_12', monthId: '2026-09', currency: 'NGN', date: '2026-09-12', bucket: 'personal', description: 'Pharmacy & Toiletries', amount: 11200, paymentMethod: 'card', tag: '', source: 'demo' },
  { id: 'demo_tx_13', monthId: '2026-09', currency: 'NGN', date: '2026-09-14', bucket: 'givings', description: 'Home Utilities & Food', amount: 46000, paymentMethod: 'transfer', tag: 'home', source: 'demo' },
  { id: 'demo_tx_14', monthId: '2026-09', currency: 'NGN', date: '2026-09-18', bucket: 'givings', description: 'Birthday Gift', amount: 15000, paymentMethod: 'transfer', tag: 'gifts', source: 'demo' },
  { id: 'demo_tx_15', monthId: '2026-09', currency: 'NGN', date: '2026-09-22', bucket: 'givings', description: 'Community Tithe', amount: 25000, paymentMethod: 'transfer', tag: 'church', source: 'demo' },
  { id: 'demo_tx_16', monthId: '2026-09', currency: 'NGN', date: '2026-09-26', bucket: 'investments', description: 'Tech Course & Books', amount: 65000, paymentMethod: 'card', tag: '', source: 'demo' },

  // October 2026
  { id: 'demo_tx_17', monthId: '2026-10', currency: 'NGN', date: '2026-10-03', bucket: 'work', description: 'Mobile Data & Fiber', amount: 20000, paymentMethod: 'transfer', tag: '', source: 'demo' },
  { id: 'demo_tx_18', monthId: '2026-10', currency: 'NGN', date: '2026-10-07', bucket: 'work', description: 'Fuel', amount: 15000, paymentMethod: 'transfer', tag: '', source: 'demo' },
  { id: 'demo_tx_19', monthId: '2026-10', currency: 'NGN', date: '2026-10-09', bucket: 'personal', description: 'Weekly Snacks', amount: 4800, paymentMethod: 'cash', tag: '', source: 'demo' },
  { id: 'demo_tx_20', monthId: '2026-10', currency: 'NGN', date: '2026-10-14', bucket: 'personal', description: 'Haircut & Grooming', amount: 6500, paymentMethod: 'cash', tag: '', source: 'demo' },
  { id: 'demo_tx_21', monthId: '2026-10', currency: 'NGN', date: '2026-10-16', bucket: 'givings', description: 'Family Stipend', amount: 30000, paymentMethod: 'transfer', tag: 'family', source: 'demo' },
  { id: 'demo_tx_22', monthId: '2026-10', currency: 'NGN', date: '2026-10-20', bucket: 'givings', description: 'Household Supplies', amount: 38000, paymentMethod: 'transfer', tag: 'home', source: 'demo' },
  { id: 'demo_tx_23', monthId: '2026-10', currency: 'NGN', date: '2026-10-24', bucket: 'givings', description: 'Youth Outreach', amount: 22000, paymentMethod: 'transfer', tag: 'church', source: 'demo' },
  { id: 'demo_tx_24', monthId: '2026-10', currency: 'NGN', date: '2026-10-28', bucket: 'investments', description: 'Index Fund Deposit', amount: 200000, paymentMethod: 'transfer', tag: '', source: 'demo' },

  // November 2026
  { id: 'demo_tx_25', monthId: '2026-11', currency: 'NGN', date: '2026-11-02', bucket: 'work', description: 'Mobile Data & Fiber', amount: 20000, paymentMethod: 'transfer', tag: '', source: 'demo' },
  { id: 'demo_tx_26', monthId: '2026-11-05', bucket: 'personal', date: '2026-11-05', description: 'Lunch', amount: 2500, paymentMethod: 'cash', tag: '', source: 'demo' },
  { id: 'demo_tx_27', monthId: '2026-11-08', bucket: 'givings', date: '2026-11-08', description: 'Household Groceries', amount: 32000, paymentMethod: 'transfer', tag: 'home', source: 'demo' },
  { id: 'demo_tx_28', monthId: '2026-11-11', bucket: 'personal', date: '2026-11-11', description: 'Bread & Eggs', amount: 1800, paymentMethod: 'cash', tag: '', source: 'demo' },
  { id: 'demo_tx_29', monthId: '2026-11-15', bucket: 'givings', date: '2026-11-15', description: 'Community Tithe', amount: 25000, paymentMethod: 'transfer', tag: 'church', source: 'demo' },
  { id: 'demo_tx_30', monthId: '2026-11-19', bucket: 'investments', date: '2026-11-19', description: 'Emergency Reserve', amount: 120000, paymentMethod: 'transfer', tag: '', source: 'demo' }
];
