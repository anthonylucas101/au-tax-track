import { Hono } from 'hono';
import * as XLSX from 'xlsx';
import { buildTaxEstimate, type TaxEstimateResult } from '../services/taxEstimate.js';
import { payslipsRepo } from '../db/repos/payslips.js';
import { dividendsRepo } from '../db/repos/dividends.js';
import { computeCgtForFy, type CgtResult } from '../services/cgt.js';
import { propertiesRepo } from '../db/repos/properties.js';
import { rentalTransactionsRepo } from '../db/repos/rentalTransactions.js';
import { computeDepreciationForFy } from '../services/depreciation.js';
import { convertToAud } from '../lib/money.js';
import { CATEGORY_LABELS } from '../lib/rentalCategories.js';

export const exportRoute = new Hono();

// ─── helpers ──────────────────────────────────────────────────────────────────

function c2d(cents: number): number {
  return cents / 100;
}

function fmtD(cents: number): string {
  const n = Math.abs(cents) / 100;
  const formatted = n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `($${formatted})` : `$${formatted}`;
}

function parseFyId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// ─── Excel export ──────────────────────────────────────────────────────────────

exportRoute.get('/accountant', (c) => {
  const fyId = parseFyId(c.req.query('fyId'));
  if (fyId === null) return c.json({ error: 'fyId is required' }, 400);
  const safeId: number = fyId;

  let est: TaxEstimateResult;
  try {
    est = buildTaxEstimate(fyId);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to build estimate' }, 500);
  }

  const payslips = payslipsRepo.listByFy(fyId);
  const dividends = dividendsRepo.listByFy(fyId);

  let cgtResult: CgtResult | null = null;
  try {
    cgtResult = computeCgtForFy(fyId);
  } catch { /* ignore */ }

  const properties = propertiesRepo.findAll();

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  {
    const dt = est.dividend_totals;
    const cgt = est.cgt;
    const rows: (string | number)[][] = [
      ['Generated:', new Date().toISOString()],
      ['Financial Year:', est.fy.label],
      ['Taxpayer:', ''],
      ['', ''],
      ['INCOME', ''],
      ['Salary & wages (gross):', c2d(est.gross_cents)],
      ['Total tax withheld (PAYG):', c2d(est.tax_withheld_cents)],
      ['Australian dividends (gross):', c2d(dt.au_total_cents + dt.franking_credits_cents)],
      ['  of which franked:', c2d(dt.franked_cents)],
      ['  of which unfranked:', c2d(dt.unfranked_cents)],
      ['  franking credits:', c2d(dt.franking_credits_cents)],
      ['Foreign dividends (AUD):', c2d(dt.foreign_total_cents)],
      ['  foreign tax withheld (AUD):', c2d(dt.withholding_tax_cents)],
      ['Net capital gains (taxable):', c2d(cgt.discounted_net_gain_cents)],
      ['Net rental income/(loss):', c2d(est.rental.total_net_cents)],
      ['TOTAL TAXABLE INCOME:', c2d(est.taxable_income_cents)],
      ['', ''],
      ['TAX', ''],
      ['Income tax:', c2d(est.income_tax_cents)],
      ['Medicare levy (2%):', c2d(est.medicare_levy_cents)],
      ['Less: LITO:', c2d(-est.lito_cents)],
      ['Less: Franking credits:', c2d(-est.franking_credits_cents)],
      ['Less: FITO:', c2d(-est.fito_cents)],
      ['ESTIMATED TAX PAYABLE:', c2d(est.estimated_tax_payable_cents)],
      ['PAYG withheld:', c2d(est.tax_withheld_cents)],
      ['ESTIMATED REFUND/(BILL):', c2d(est.refund_or_bill_cents)],
      ['', ''],
      ['Figures are estimates only. Verify all amounts before lodging. Depreciation and cost base adjustments may require professional review.', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 40 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Summary');
  }

  // ── Sheet 2: Salary & PAYG ────────────────────────────────────────────────
  {
    const header = ['Pay Date', 'Employer', 'Gross ($)', 'Tax Withheld ($)', 'Super ($)', 'Allowances ($)', 'Notes'];
    const dataRows = payslips.map((p) => [
      p.pay_date,
      p.employer_name,
      c2d(p.gross_cents),
      c2d(p.tax_withheld_cents),
      c2d(p.super_cents),
      c2d(p.allowances_cents),
      p.notes ?? '',
    ]);
    const totals = ['TOTALS', '',
      c2d(est.gross_cents),
      c2d(est.tax_withheld_cents),
      c2d(est.super_cents),
      c2d(est.allowances_cents),
      '',
    ];
    const rows = [header, ...dataRows, totals];
    if (payslips.length === 0) rows.push(['No payslips recorded for this FY', '', '', '', '', '', '']);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Salary & PAYG');
  }

  // ── Sheet 3: Dividends ────────────────────────────────────────────────────
  {
    const header = ['Payment Date', 'Ticker', 'Name', 'Type', 'Currency', 'Unfranked ($)', 'Franked ($)', 'Franking Credit ($)', 'Withholding Tax ($)', 'AUD/FX Rate', 'Notes'];
    const auDivs = dividends.filter((d) => d.currency === 'AUD');
    const foreignDivs = dividends.filter((d) => d.currency !== 'AUD');

    const toRow = (d: (typeof dividends)[0]) => [
      d.payment_date,
      d.ticker,
      d.security_name ?? '',
      d.dividend_type ?? '',
      d.currency,
      c2d(d.unfranked_cents),
      c2d(d.franked_cents),
      c2d(d.franking_credits_cents),
      c2d(d.withholding_tax_cents),
      d.aud_fx_rate ?? 1,
      d.notes ?? '',
    ];

    const sumField = (arr: typeof dividends, field: 'unfranked_cents' | 'franked_cents' | 'franking_credits_cents' | 'withholding_tax_cents') =>
      arr.reduce((s, d) => s + d[field], 0);

    const auTotalsRow: (string | number)[] | null = auDivs.length > 0
      ? ['AU TOTALS', '', '', '', '',
          c2d(sumField(auDivs, 'unfranked_cents')),
          c2d(sumField(auDivs, 'franked_cents')),
          c2d(sumField(auDivs, 'franking_credits_cents')),
          '', '', '']
      : null;
    const foreignTotalsRow: (string | number)[] | null = foreignDivs.length > 0
      ? ['FOREIGN TOTALS', '', '', '', '',
          c2d(foreignDivs.reduce((s, d) => s + convertToAud(d.unfranked_cents, d.aud_fx_rate ?? 1, d.currency), 0)),
          c2d(foreignDivs.reduce((s, d) => s + convertToAud(d.franked_cents, d.aud_fx_rate ?? 1, d.currency), 0)),
          '',
          c2d(sumField(foreignDivs, 'withholding_tax_cents')),
          '', '']
      : null;
    const grandTotalRow: (string | number)[] = ['GRAND TOTAL', '', '', '', '',
      c2d(est.dividend_totals.unfranked_cents),
      c2d(est.dividend_totals.franked_cents),
      c2d(est.dividend_totals.franking_credits_cents),
      c2d(est.dividend_totals.withholding_tax_cents),
      '', ''];

    const rows: (string | number)[][] = [
      header,
      ...(dividends.length === 0
        ? [['No dividends recorded for this FY', '', '', '', '', '', '', '', '', '', '']]
        : dividends.map(toRow)),
    ];
    rows.push([]);
    if (auTotalsRow) rows.push(auTotalsRow);
    if (foreignTotalsRow) rows.push(foreignTotalsRow);
    rows.push(grandTotalRow);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Dividends');
  }

  // ── Sheet 4: Capital Gains ─────────────────────────────────────────────────
  {
    const header = ['Sell Date', 'Ticker', 'Units', 'Proceeds AUD ($)', 'Cost Base AUD ($)', 'Gross Gain/Loss ($)', 'Held (days)', 'Discount eligible', 'Discounted gain ($)'];
    const events = cgtResult?.events ?? [];
    const orphans = cgtResult?.orphans ?? [];
    const cgt = est.cgt;

    const eventRows: (string | number)[][] = events.map((e) => {
      const discountedGain = e.discount_eligible && e.gain_aud_cents > 0
        ? Math.round(e.gain_aud_cents * 0.5)
        : Math.max(0, e.gain_aud_cents);
      return [
        e.sell_date,
        e.ticker,
        e.units,
        c2d(e.proceeds_aud_cents),
        c2d(e.cost_base_aud_cents),
        c2d(e.gain_aud_cents),
        e.held_days,
        e.discount_eligible ? 'Yes' : 'No',
        c2d(discountedGain),
      ];
    });

    const summaryRows: (string | number)[][] = [
      ['Total capital gains:', c2d(cgt.total_gain_cents)],
      ['Total capital losses:', c2d(-cgt.total_loss_cents)],
      ['Net capital gain (pre-disc):', c2d(cgt.net_gain_cents)],
      ['CGT discount applied (50%):', c2d(-(cgt.net_gain_cents - cgt.discounted_net_gain_cents))],
      ['Net taxable capital gain:', c2d(cgt.discounted_net_gain_cents)],
      ['Capital loss carry-forward:', c2d(cgt.loss_carryforward_cents)],
    ];

    const rows: (string | number)[][] = [
      header,
      ...(events.length === 0 ? [['No CGT events recorded for this FY', '', '', '', '', '', '', '', '']] : eventRows),
      [],
      ['Section B — Summary', ''],
      ...summaryRows,
    ];

    if (orphans.length > 0) {
      rows.push([]);
      rows.push(['WARNING: The following sells have no matching buy parcel — cost base unknown. Consult your accountant.']);
      rows.push(['Sell Date', 'Ticker', 'Units unmatched', 'Reason']);
      for (const o of orphans) {
        rows.push([o.sell_date, o.ticker, o.units_unmatched, o.reason]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Capital Gains');
  }

  // ── Sheet 5: Rental Property ───────────────────────────────────────────────
  {
    const allRows: (string | number)[][] = [];

    for (const prop of properties) {
      const totals = rentalTransactionsRepo.totalsByPropertyAndFy(prop.id, fyId);
      let depTotal = 0;
      let div43: { deduction_cents: number }[] = [];
      try {
        const dep = computeDepreciationForFy(prop.id, fyId, prop.sold_date);
        depTotal = dep.total_cents;
        div43 = dep.div43;
      } catch { /* ignore */ }

      const net_cents = totals.income_cents - totals.expense_cents - depTotal;
      const adj_net_cents = Math.round(net_cents * (prop.ownership_percent / 100));

      allRows.push([`Property: ${prop.address}`, `Ownership: ${prop.ownership_percent}%`]);
      if (prop.acquired_date) {
        allRows.push([`Acquired: ${prop.acquired_date}`, `Acquisition cost: ${prop.acquisition_cost_cents != null ? fmtD(prop.acquisition_cost_cents) : 'N/A'}`]);
      }

      allRows.push(['Category', 'Amount ($)']);
      allRows.push(['INCOME', '']);
      for (const [cat, amt] of Object.entries(totals.by_category)) {
        if ((amt ?? 0) === 0) continue;
        const label = CATEGORY_LABELS[cat] ?? cat;
        if (['rent', 'bond_forfeited', 'other_income'].includes(cat)) {
          allRows.push([label, c2d(amt ?? 0)]);
        }
      }
      allRows.push(['Total income:', c2d(totals.income_cents)]);

      allRows.push(['EXPENSES', '']);
      for (const [cat, amt] of Object.entries(totals.by_category)) {
        if ((amt ?? 0) === 0) continue;
        const label = CATEGORY_LABELS[cat] ?? cat;
        if (!['rent', 'bond_forfeited', 'other_income'].includes(cat)) {
          allRows.push([label, c2d(amt ?? 0)]);
        }
      }
      allRows.push(['Depreciation (Div 40 + 43):', c2d(depTotal)]);
      allRows.push(['Total expenses:', c2d(totals.expense_cents + depTotal)]);

      allRows.push(['Net rental income/(loss):', c2d(net_cents)]);
      if (prop.ownership_percent < 100) {
        allRows.push([`Your share (${prop.ownership_percent}%):`, c2d(adj_net_cents)]);
      }
      void div43; // used for div43Total below if needed
      allRows.push([]);
    }

    if (properties.length === 0) {
      allRows.push(['No rental properties recorded.', '']);
    }

    const ws = XLSX.utils.aoa_to_sheet(allRows);
    ws['!cols'] = [{ wch: 36 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Rental Property');
  }

  // ── Sheet 6: Tax Calculation ───────────────────────────────────────────────
  {
    const rows: (string | number)[][] = [
      ['Label', 'Amount ($)'],
      ...est.lines.map((l) => [l.label, c2d(l.amount_cents)]),
      [],
      ['Bracket breakdown', ''],
      ['From ($)', 'To ($)', 'Marginal rate', 'Taxable in bracket ($)', 'Tax in bracket ($)', 'Applied'],
      ...est.bracket_breakdown.map((b) => [
        c2d(b.threshold_from_cents),
        b.threshold_to_cents != null ? c2d(b.threshold_to_cents) : 'No limit',
        `${(b.marginal_rate * 100).toFixed(2)}%`,
        c2d(b.taxable_in_bracket_cents),
        c2d(b.tax_in_bracket_cents),
        b.applied ? 'Yes' : 'No',
      ]),
      [],
      ['Figures are estimates only. Verify all amounts before lodging. Depreciation and cost base adjustments may require professional review.'],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 40 }, { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Tax Calculation');
  }

  const xlsxBuf = new Uint8Array(Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array).buffer) as unknown as Uint8Array<ArrayBuffer>;
  const fyLabel = est.fy.label.replace('/', '-');

  return c.body(xlsxBuf, 200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="tax-return-FY${fyLabel}.xlsx"`,
  });
});

// ─── myTax HTML export ─────────────────────────────────────────────────────────

exportRoute.get('/mytax', (c) => {
  const fyId = parseFyId(c.req.query('fyId'));
  if (fyId === null) return c.json({ error: 'fyId is required' }, 400);
  const safeId: number = fyId;

  let est: TaxEstimateResult;
  try {
    est = buildTaxEstimate(fyId);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to build estimate' }, 500);
  }

  const dividends = dividendsRepo.listByFy(fyId);
  const payslips = payslipsRepo.listByFy(fyId);

  let cgtResult: CgtResult | null = null;
  try {
    cgtResult = computeCgtForFy(fyId);
  } catch { /* ignore */ }

  const properties = propertiesRepo.findAll();
  const dt = est.dividend_totals;
  const fyLabel = est.fy.label;
  const generated = new Date().toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Group payslips by employer
  const byEmployer = new Map<string, typeof payslips>();
  for (const p of payslips) {
    const key = p.employer_name;
    const existing = byEmployer.get(key);
    if (existing) existing.push(p);
    else byEmployer.set(key, [p]);
  }

  const auDivs = dividends.filter((d) => d.currency === 'AUD');
  const foreignDivs = dividends.filter((d) => d.currency !== 'AUD');

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function salarySection(): string {
    if (payslips.length === 0) return `<section><h2>Section 1 — Salary or wages</h2><p class="none">No salary records for this FY.</p></section>`;
    let html = `<section><h2>Section 1 — Salary or wages <span class="ref">(myTax: Income &#8594; Salary or wages)</span></h2>`;
    for (const [employer, slips] of byEmployer) {
      const gross = slips.reduce((s, p) => s + p.gross_cents, 0);
      const withheld = slips.reduce((s, p) => s + p.tax_withheld_cents, 0);
      html += `<div class="employer-block">
        <h3>${esc(employer)}</h3>
        <table><tbody>
          <tr><td>Gross income <span class="ref">(Item 1, Label D)</span></td><td class="amt">${fmtD(gross)}</td></tr>
          <tr><td>Tax withheld <span class="ref">(Item 1, Label E)</span></td><td class="amt">${fmtD(withheld)}</td></tr>
        </tbody></table>
        ${slips.length > 1 ? `<p class="note">${slips.length} payslips totalled above.</p>` : ''}
      </div>`;
    }
    html += `</section>`;
    return html;
  }

  function dividendSection(): string {
    if (dividends.length === 0) {
      return `<section><h2>Section 2 — Australian dividends</h2><p class="none">No dividends recorded for this FY.</p></section>`;
    }
    let html = `<section><h2>Section 2 — Australian dividends <span class="ref">(myTax: Income &#8594; Dividends)</span></h2>
      <div class="info-box">The ATO pre-fills dividends from registry data. Compare against this list — add any missing ones, correct any wrong amounts.</div>`;

    if (auDivs.length > 0) {
      html += `<table><thead><tr><th>Ticker</th><th>Payment Date</th><th>Type</th><th>Unfranked</th><th>Franked</th><th>Franking Credit</th></tr></thead><tbody>`;
      for (const d of auDivs) {
        html += `<tr><td>${esc(d.ticker)}</td><td>${esc(d.payment_date)}</td><td>${esc(d.dividend_type ?? '')}</td><td class="amt">${fmtD(d.unfranked_cents)}</td><td class="amt">${fmtD(d.franked_cents)}</td><td class="amt">${fmtD(d.franking_credits_cents)}</td></tr>`;
      }
      html += `</tbody></table>`;
    } else {
      html += `<p class="none">No Australian dividends recorded.</p>`;
    }

    html += `<div class="totals-box"><strong>TOTALS to enter in myTax:</strong><table><tbody>
      <tr><td>Item 8D — Unfranked dividend amount</td><td class="amt">${fmtD(dt.unfranked_cents)}</td></tr>
      <tr><td>Item 8E — Franked dividend amount</td><td class="amt">${fmtD(dt.franked_cents)}</td></tr>
      <tr><td>Item 8F — Franking credit amount</td><td class="amt">${fmtD(dt.franking_credits_cents)}</td></tr>
    </tbody></table></div></section>`;
    return html;
  }

  function foreignSection(): string {
    if (foreignDivs.length === 0) {
      return `<section><h2>Section 3 — Foreign income</h2><p class="none">No foreign dividends recorded for this FY.</p></section>`;
    }
    let html = `<section><h2>Section 3 — Foreign income <span class="ref">(myTax: Income &#8594; Foreign income &#8594; Dividends)</span></h2>
      <div class="info-box">Enter the AUD equivalent of each foreign dividend. The withholding tax you paid is claimable as a Foreign Income Tax Offset (FITO) at the end.</div>
      <table><thead><tr><th>Ticker</th><th>Payment Date</th><th>Total (foreign)</th><th>Currency</th><th>AUD/FX</th><th>Total (AUD)</th><th>WHT (AUD)</th></tr></thead><tbody>`;
    for (const d of foreignDivs) {
      const totalForeign = d.unfranked_cents + d.franked_cents;
      const fxRate = d.aud_fx_rate ?? 1;
      const totalAud = convertToAud(totalForeign, fxRate, d.currency);
      const whtAud = d.withholding_tax_cents;
      html += `<tr><td>${esc(d.ticker)}</td><td>${esc(d.payment_date)}</td><td class="amt">${fmtD(totalForeign)}</td><td>${esc(d.currency)}</td><td>${fxRate.toFixed(4)}</td><td class="amt">${fmtD(totalAud)}</td><td class="amt">${fmtD(whtAud)}</td></tr>`;
    }
    html += `</tbody></table>
    <div class="totals-box"><strong>TOTALS:</strong><table><tbody>
      <tr><td>Item 20E — Foreign income (AUD)</td><td class="amt">${fmtD(dt.foreign_total_cents)}</td></tr>
      <tr><td>Item 20F — Foreign tax paid/withheld (AUD)</td><td class="amt">${fmtD(dt.withholding_tax_cents)}</td></tr>
    </tbody></table></div></section>`;
    return html;
  }

  function rentalSection(): string {
    if (properties.length === 0) {
      return `<section><h2>Section 4 — Rental property</h2><p class="none">No rental properties recorded for this FY.</p></section>`;
    }
    let html = `<section><h2>Section 4 — Rental property <span class="ref">(myTax: Income &#8594; Rent)</span></h2>`;

    for (const prop of properties) {
      const totals = rentalTransactionsRepo.totalsByPropertyAndFy(prop.id, safeId);
      let depTotal = 0;
      let div43: { deduction_cents: number }[] = [];
      try {
        const dep = computeDepreciationForFy(prop.id, safeId, prop.sold_date);
        depTotal = dep.total_cents;
        div43 = dep.div43;
      } catch { /* ignore */ }

      const div43Total = div43.reduce((s, x) => s + x.deduction_cents, 0);
      const net_cents = totals.income_cents - totals.expense_cents - depTotal;
      const adj_net_cents = Math.round(net_cents * (prop.ownership_percent / 100));
      const isNegGeared = adj_net_cents < 0;
      const bc = totals.by_category;

      html += `<div class="property-block">
        <h3>${esc(prop.address)} <span class="ref">Ownership: ${prop.ownership_percent}%</span></h3>
        <div class="mytax-box">
          <table><tbody>
            <tr><td>Gross rent (13L)</td><td class="amt">${fmtD(bc['rent'] ?? 0)}</td></tr>
            <tr><td>Interest on borrowed funds (13M)</td><td class="amt">${fmtD(bc['interest'] ?? 0)}</td></tr>
            <tr><td>Capital works Div 43 (13N)</td><td class="amt">${fmtD(div43Total)}</td></tr>
            <tr><td>Land tax (13O)</td><td class="amt">${fmtD(bc['land_tax'] ?? 0)}</td></tr>
            <tr><td>Council rates (13P)</td><td class="amt">${fmtD(bc['council_rates'] ?? 0)}</td></tr>
            <tr><td>Water rates (13Q)</td><td class="amt">${fmtD(bc['water_rates'] ?? 0)}</td></tr>
            <tr><td>Insurance premiums (13R)</td><td class="amt">${fmtD(bc['insurance'] ?? 0)}</td></tr>
            <tr><td>Agent fees &amp; commissions (13S)</td><td class="amt">${fmtD(bc['agent_fees'] ?? 0)}</td></tr>
            <tr><td>Repairs &amp; maintenance (13T)</td><td class="amt">${fmtD(bc['repairs_maintenance'] ?? 0)}</td></tr>
            <tr><td>Other deductions (13U)</td><td class="amt">${fmtD((bc['advertising'] ?? 0) + (bc['pest_control'] ?? 0) + (bc['gardening_cleaning'] ?? 0) + (bc['accounting'] ?? 0) + (bc['body_corporate'] ?? 0) + (bc['other_expense'] ?? 0))}</td></tr>
            <tr class="total-row"><td>Net rent (calculated by ATO)</td><td class="amt">${fmtD(net_cents)}</td></tr>
          </tbody></table>
        </div>
        <p class="info-box">Ownership %: If you own ${prop.ownership_percent}% of the property, myTax automatically apportions your share when you enter the ownership percentage.</p>
        <p class="info-box">'Other deductions (13U)' includes: gardening/cleaning, pest control, accounting fees, body corporate, advertising, and any other deductible expenses.</p>
        ${isNegGeared ? `<div class="warning-box">This property is negatively geared — the net loss of ${fmtD(adj_net_cents)} reduces your taxable income.</div>` : ''}
      </div>`;
    }

    html += `</section>`;
    return html;
  }

  function cgtSection(): string {
    const events = cgtResult?.events ?? [];
    const orphans = cgtResult?.orphans ?? [];
    const cgt = est.cgt;

    if (events.length === 0 && orphans.length === 0) {
      return `<section><h2>Section 5 — Capital gains</h2><p class="none">No CGT events recorded for this FY.</p></section>`;
    }

    let html = `<section><h2>Section 5 — Capital gains <span class="ref">(myTax: Income &#8594; Capital gains)</span></h2>
      <div class="info-box">
        <strong>Steps in myTax:</strong><ol>
          <li>Click "Add" next to Capital gains</li>
          <li>Select "You had a capital gain or loss"</li>
          <li>Select "Discount method" (for assets held &gt;12 months)</li>
          <li>Enter amounts below</li>
        </ol>
      </div>
      <div class="totals-box"><table><tbody>
        <tr><td>Total capital gains (all assets) <span class="ref">&#8592; Item 18A</span></td><td class="amt">${fmtD(cgt.total_gain_cents)}</td></tr>
        <tr><td>Capital losses applied</td><td class="amt">${fmtD(-cgt.total_loss_cents)}</td></tr>
        <tr><td>Net capital gain (post-discount) <span class="ref">&#8592; Item 18H</span></td><td class="amt">${fmtD(cgt.discounted_net_gain_cents)}</td></tr>
      </tbody></table></div>`;

    if (events.length > 0) {
      html += `<h3>CGT events detail</h3>
        <table><thead><tr><th>Sell Date</th><th>Ticker</th><th>Units</th><th>Proceeds (AUD)</th><th>Cost Base (AUD)</th><th>Gain/Loss</th><th>Days held</th><th>Discount</th></tr></thead><tbody>`;
      for (const e of events) {
        html += `<tr><td>${esc(e.sell_date)}</td><td>${esc(e.ticker)}</td><td>${e.units}</td><td class="amt">${fmtD(e.proceeds_aud_cents)}</td><td class="amt">${fmtD(e.cost_base_aud_cents)}</td><td class="amt">${fmtD(e.gain_aud_cents)}</td><td>${e.held_days}</td><td>${e.discount_eligible ? 'Yes (50%)' : 'No'}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    if (orphans.length > 0) {
      html += `<div class="warning-box"><strong>Warning:</strong> The following sells have no matching buy parcel — cost base unknown. Consult your accountant.<ul>`;
      for (const o of orphans) {
        html += `<li>${esc(o.ticker)} sold ${esc(o.sell_date)} &#8212; ${o.units_unmatched} unmatched units</li>`;
      }
      html += `</ul></div>`;
    }

    html += `</section>`;
    return html;
  }

  function offsetsSection(): string {
    return `<section><h2>Section 6 — Tax offsets</h2>
      <h3>Franking credits <span class="ref">(myTax: Offsets &#8594; Franking credits from dividends or trust distributions)</span></h3>
      <div class="info-box">Franking credits are a refundable tax offset — they reduce your tax bill and any excess is refunded. myTax may pre-fill this from your dividend data.</div>
      <div class="totals-box"><table><tbody>
        <tr><td>Total franking credits <span class="ref">&#8592; Item T9</span></td><td class="amt">${fmtD(est.franking_credits_cents)}</td></tr>
      </tbody></table></div>
      <h3>Foreign Income Tax Offset <span class="ref">(myTax: Offsets &#8594; Foreign income tax offset)</span></h3>
      <div class="info-box">FITO offsets the foreign withholding tax you already paid against your AU tax. The offset is capped at the AU tax that would apply to that foreign income.</div>
      <div class="totals-box"><table><tbody>
        <tr><td>Foreign tax paid (AUD) <span class="ref">&#8592; enter at Item T12</span></td><td class="amt">${fmtD(est.fito_cents)}</td></tr>
      </tbody></table></div>
    </section>`;
  }

  function taxOutcomeSection(): string {
    let html = `<section><h2>Section 7 — Estimated tax outcome</h2>
      <table><thead><tr><th>Item</th><th>Amount</th><th>Notes</th></tr></thead><tbody>`;
    for (const line of est.lines) {
      html += `<tr><td>${esc(line.label)}</td><td class="amt">${fmtD(line.amount_cents)}</td><td class="formula">${esc(line.formula)}</td></tr>`;
    }
    html += `</tbody></table>
      <p class="disclaimer">This estimate is calculated by AU Tax Tracker and may differ from the ATO's calculation due to rounding, pre-filled data adjustments, and offsets not modelled here (HELP/HECS, private health insurance, etc.).</p>
    </section>`;
    return html;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AU Tax Tracker &#8212; myTax Guide FY ${esc(fyLabel)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #1a1a1a; background: #fff; max-width: 800px; margin: 0 auto; padding: 24px 20px 60px; }
h1 { font-size: 22px; margin-bottom: 4px; }
.subtitle { color: #555; font-size: 13px; margin-bottom: 20px; }
h2 { font-size: 16px; border-bottom: 2px solid #1a1a1a; padding-bottom: 4px; margin: 28px 0 12px; }
h3 { font-size: 14px; margin: 16px 0 8px; color: #333; }
section { margin-bottom: 12px; }
.ref { font-size: 12px; font-weight: normal; color: #666; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
th, td { text-align: left; padding: 5px 8px; border: 1px solid #ddd; }
th { background: #f4f4f4; font-weight: 600; }
tr:nth-child(even) td { background: #fafafa; }
.total-row td { font-weight: 700; background: #f0f0f0; }
.amt { text-align: right; font-variant-numeric: tabular-nums; }
.formula { font-size: 11px; color: #666; }
.info-box { background: #e8f4fd; border-left: 4px solid #2196f3; padding: 10px 14px; margin: 10px 0; border-radius: 2px; font-size: 13px; }
.info-box ol, .info-box ul { margin: 6px 0 0 18px; }
.warning-box { background: #fff3cd; border-left: 4px solid #f5a623; padding: 10px 14px; margin: 10px 0; border-radius: 2px; font-size: 13px; }
.warning-box ul { margin: 6px 0 0 18px; }
.totals-box { background: #f8f8f8; border: 1px solid #ddd; padding: 12px; margin: 12px 0; border-radius: 4px; }
.totals-box table { margin: 8px 0 0; }
.employer-block, .property-block { margin: 12px 0; padding: 12px; border: 1px solid #e5e5e5; border-radius: 4px; }
.mytax-box { border: 1px solid #ccc; border-radius: 4px; padding: 4px 0; margin: 10px 0; }
.mytax-box table { margin: 0; }
.note { font-size: 12px; color: #666; margin-top: 6px; }
.none { color: #888; font-style: italic; padding: 8px 0; }
.disclaimer { font-size: 12px; color: #666; margin-top: 14px; font-style: italic; }
.global-warning { background: #fff3cd; border: 1px solid #f5a623; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; }
.global-warning strong { display: block; margin-bottom: 6px; }
@media print {
  body { max-width: 100%; padding: 0; font-size: 12px; }
  h2 { page-break-before: auto; }
  section { page-break-inside: avoid; }
  .no-print { display: none; }
}
</style>
</head>
<body>
<h1>AU Tax Tracker &#8212; myTax Guide</h1>
<p class="subtitle">FY ${esc(fyLabel)} &nbsp;|&nbsp; Generated ${esc(generated)}</p>

<div class="global-warning">
  <strong>&#9888;&#65039; Important</strong>
  This guide is generated from your AU Tax Tracker data and is for reference only.
  Verify all amounts before lodging. The ATO may have pre-filled some fields from
  employer, bank, and broker data &#8212; cross-check against pre-fill before overriding.
</div>

${salarySection()}
${dividendSection()}
${foreignSection()}
${rentalSection()}
${cgtSection()}
${offsetsSection()}
${taxOutcomeSection()}
</body>
</html>`;

  const fyLabelSafe = fyLabel.replace('/', '-');
  return c.body(Buffer.from(html, 'utf-8'), 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `attachment; filename="mytax-guide-FY${fyLabelSafe}.html"`,
  });
});




