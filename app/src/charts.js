/**
 * Lightweight zero-dependency SVG charts for offline-first PWA rendering.
 */
import { formatMoney, getCurrencyMeta, GIVINGS_TAGS } from './budgetEngine.js';

export function renderMonthlyTrendSvg(monthSummaries, currency = 'NGN') {
  const sym = getCurrencyMeta(currency).symbol;
  const months = monthSummaries
    .filter((m) => !m.isBaselineOnly && (m.currency || 'NGN') === currency)
    .slice(-8);
  if (months.length === 0) {
    return `<div class="empty-state">No monthly data in ${currency} yet.</div>`;
  }

  const width = 680;
  const height = 240;
  const padL = 56;
  const padR = 16;
  const padT = 18;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxVal = Math.max(
    100,
    ...months.map((m) => Math.max(m.netIncome, m.spent.work + m.totalNonWorkSpent))
  );

  const step = plotW / months.length;
  const barW = Math.min(26, step * 0.32);

  const gridLines = [0.25, 0.5, 0.75, 1].map((frac) => {
    const y = padT + plotH * (1 - frac);
    const val = maxVal * frac;
    const label = val >= 1000 ? `${sym}${Math.round(val / 1000)}k` : `${sym}${Math.round(val)}`;
    return `
      <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--chart-grid)" stroke-dasharray="3 3"/>
      <text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="var(--chart-axis)" font-size="10">${label}</text>
    `;
  }).join('');

  const bars = months.map((m, idx) => {
    const cx = padL + idx * step + step / 2;
    const netH = (m.netIncome / maxVal) * plotH;
    const gH = (m.spent.givings / maxVal) * plotH;
    const pH = (m.spent.personal / maxVal) * plotH;
    const iH = (m.spent.investments / maxVal) * plotH;
    const wH = (m.spent.work / maxVal) * plotH;

    const yNet = padT + plotH - netH;
    let curY = padT + plotH;
    const stackSeg = (h, color) => {
      curY -= h;
      return `<rect x="${cx + 2}" y="${curY}" width="${barW}" height="${Math.max(0, h)}" rx="2" fill="${color}"/>`;
    };

    const totalSpend = m.spent.work + m.totalNonWorkSpent;
    return `
      <g>
        <title>${m.label}: Net ${formatMoney(m.netIncome, currency)} | Total Spend ${formatMoney(totalSpend, currency)}</title>
        <rect x="${cx - barW - 2}" y="${yNet}" width="${barW}" height="${Math.max(0, netH)}" rx="3" fill="rgba(2,132,199,0.16)" stroke="#0284c7" stroke-width="1"/>
        ${stackSeg(pH, '#00b875')}
        ${stackSeg(gH, '#7c3aed')}
        ${stackSeg(iH, '#d97706')}
        ${stackSeg(wH, '#0284c7')}
        <text x="${cx}" y="${height - 10}" text-anchor="middle" fill="var(--chart-label)" font-size="11">${m.label.split(' ')[0]}</text>
      </g>
    `;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="trend-svg" role="img" aria-label="Monthly Income vs Spending">
      ${gridLines}
      <line x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" stroke="var(--border-strong)"/>
      ${bars}
    </svg>
  `;
}

export function renderGivingsTagBreakdown(givingsByTag, currency = 'NGN') {
  const total = Object.values(givingsByTag).reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return '<div class="empty-state">No Givings logged in this month yet.</div>';
  }
  return GIVINGS_TAGS.map((t) => {
    const val = givingsByTag[t.id] || 0;
    const pct = Math.round((val / total) * 100);
    return `
      <div class="tag-bar-row">
        <div class="tag-bar-head">
          <span><span class="dot" style="background:${t.color}"></span>${t.label}</span>
          <span class="mono">${formatMoney(val, currency)} <small class="muted">(${pct}%)</small></span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%;background:${t.color}"></div>
        </div>
      </div>
    `;
  }).join('');
}
