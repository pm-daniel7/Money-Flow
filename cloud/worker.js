/**
 * NairaFlow Zero-Cost Sync API (Cloudflare Workers + D1)
 * Supports offline-first multi-device item-level merge via updated_at + soft deletes.
 *
 * Secret required in Cloudflare: `SYNC_KEY` (set via `wrangler secret put SYNC_KEY`)
 */

function corsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Key',
    'Content-Type': 'application/json'
  };
}

function unauthorized(origin) {
  return new Response(JSON.stringify({ error: 'Invalid or missing X-Sync-Key' }), {
    status: 401,
    headers: corsHeaders(origin)
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const syncKey = request.headers.get('X-Sync-Key') || '';
    if (!env.SYNC_KEY || syncKey !== env.SYNC_KEY) {
      return unauthorized(origin);
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'nairaflow-sync' }), {
        headers: corsHeaders(origin)
      });
    }

    if (request.method === 'POST' && url.pathname === '/sync') {
      const body = await request.json();
      const db = env.DB;

      // Upsert months
      for (const m of body.months || []) {
        await db.prepare(`
          INSERT INTO months (id, net_income, personal_pct, givings_pct, investments_pct, note, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
          ON CONFLICT(id) DO UPDATE SET
            net_income = CASE WHEN excluded.updated_at >= months.updated_at THEN excluded.net_income ELSE months.net_income END,
            personal_pct = CASE WHEN excluded.updated_at >= months.updated_at THEN excluded.personal_pct ELSE months.personal_pct END,
            givings_pct = CASE WHEN excluded.updated_at >= months.updated_at THEN excluded.givings_pct ELSE months.givings_pct END,
            investments_pct = CASE WHEN excluded.updated_at >= months.updated_at THEN excluded.investments_pct ELSE months.investments_pct END,
            note = CASE WHEN excluded.updated_at >= months.updated_at THEN excluded.note ELSE months.note END,
            updated_at = CASE WHEN excluded.updated_at >= months.updated_at THEN excluded.updated_at ELSE months.updated_at END
        `).bind(
          m.id,
          Number(m.netIncome) || 0,
          m.personalPct ?? null,
          m.givingsPct ?? null,
          m.investmentsPct ?? null,
          m.note || '',
          m.updatedAt || new Date().toISOString()
        ).run();
      }

      // Upsert transactions (with tombstone support)
      for (const t of body.transactions || []) {
        await db.prepare(`
          INSERT INTO transactions (id, month_id, date, bucket, description, amount, payment_method, tag, source, deleted, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
          ON CONFLICT(id) DO UPDATE SET
            month_id = CASE WHEN excluded.updated_at >= transactions.updated_at THEN excluded.month_id ELSE transactions.month_id END,
            date = CASE WHEN excluded.updated_at >= transactions.updated_at THEN excluded.date ELSE transactions.date END,
            bucket = CASE WHEN excluded.updated_at >= transactions.updated_at THEN excluded.bucket ELSE transactions.bucket END,
            description = CASE WHEN excluded.updated_at >= transactions.updated_at THEN excluded.description ELSE transactions.description END,
            amount = CASE WHEN excluded.updated_at >= transactions.updated_at THEN excluded.amount ELSE transactions.amount END,
            payment_method = CASE WHEN excluded.updated_at >= transactions.updated_at THEN excluded.payment_method ELSE transactions.payment_method END,
            tag = CASE WHEN excluded.updated_at >= transactions.updated_at THEN excluded.tag ELSE transactions.tag END,
            source = CASE WHEN excluded.updated_at >= transactions.updated_at THEN excluded.source ELSE transactions.source END,
            deleted = CASE WHEN excluded.updated_at >= transactions.updated_at THEN excluded.deleted ELSE transactions.deleted END,
            updated_at = CASE WHEN excluded.updated_at >= transactions.updated_at THEN excluded.updated_at ELSE transactions.updated_at END
        `).bind(
          t.id, t.monthId, t.date, t.bucket, t.description, Number(t.amount) || 0,
          t.paymentMethod || 'cash', t.tag || '', t.source || 'manual', t.deleted ? 1 : 0,
          t.updatedAt || new Date().toISOString()
        ).run();
      }

      // Upsert lending
      for (const l of body.lending || []) {
        await db.prepare(`
          INSERT INTO lending (id, person, amount, direction, date, note, deleted, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
          ON CONFLICT(id) DO UPDATE SET
            person = CASE WHEN excluded.updated_at >= lending.updated_at THEN excluded.person ELSE lending.person END,
            amount = CASE WHEN excluded.updated_at >= lending.updated_at THEN excluded.amount ELSE lending.amount END,
            direction = CASE WHEN excluded.updated_at >= lending.updated_at THEN excluded.direction ELSE lending.direction END,
            date = CASE WHEN excluded.updated_at >= lending.updated_at THEN excluded.date ELSE lending.date END,
            note = CASE WHEN excluded.updated_at >= lending.updated_at THEN excluded.note ELSE lending.note END,
            deleted = CASE WHEN excluded.updated_at >= lending.updated_at THEN excluded.deleted ELSE lending.deleted END,
            updated_at = CASE WHEN excluded.updated_at >= lending.updated_at THEN excluded.updated_at ELSE lending.updated_at END
        `).bind(
          l.id, l.person, Number(l.amount) || 0, l.direction, l.date, l.note || '',
          l.deleted ? 1 : 0, l.updatedAt || new Date().toISOString()
        ).run();
      }

      // Upsert settings keys
      for (const [key, entry] of Object.entries(body.settings || {})) {
        await db.prepare(`
          INSERT INTO kv_settings (key, value, updated_at)
          VALUES (?1, ?2, ?3)
          ON CONFLICT(key) DO UPDATE SET
            value = CASE WHEN excluded.updated_at >= kv_settings.updated_at THEN excluded.value ELSE kv_settings.value END,
            updated_at = CASE WHEN excluded.updated_at >= kv_settings.updated_at THEN excluded.updated_at ELSE kv_settings.updated_at END
        `).bind(key, JSON.stringify(entry.value), entry.updatedAt || new Date().toISOString()).run();
      }

      const [monthsRes, txRes, lendRes, kvRes] = await Promise.all([
        db.prepare('SELECT id, net_income AS netIncome, personal_pct AS personalPct, givings_pct AS givingsPct, investments_pct AS investmentsPct, note, updated_at AS updatedAt FROM months').all(),
        db.prepare('SELECT id, month_id AS monthId, date, bucket, description, amount, payment_method AS paymentMethod, tag, source, deleted, updated_at AS updatedAt FROM transactions').all(),
        db.prepare('SELECT id, person, amount, direction, date, note, deleted, updated_at AS updatedAt FROM lending').all(),
        db.prepare('SELECT key, value, updated_at AS updatedAt FROM kv_settings').all()
      ]);

      const settings = {};
      for (const row of kvRes.results || []) {
        try { settings[row.key] = { value: JSON.parse(row.value), updatedAt: row.updatedAt }; } catch {}
      }

      return new Response(JSON.stringify({
        ok: true,
        syncedAt: new Date().toISOString(),
        months: monthsRes.results || [],
        transactions: (txRes.results || []).map((r) => ({ ...r, deleted: Boolean(r.deleted) })),
        lending: (lendRes.results || []).map((r) => ({ ...r, deleted: Boolean(r.deleted) })),
        settings
      }), { headers: corsHeaders(origin) });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: corsHeaders(origin)
    });
  }
};
