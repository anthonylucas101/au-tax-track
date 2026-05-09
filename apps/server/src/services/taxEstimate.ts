import { payslipsRepo } from '../db/repos/payslips.js';
import { taxConfigRepo, type TaxBracket, type TaxConfig } from '../db/repos/taxConfig.js';
import { financialYearsRepo, type FinancialYear } from '../db/repos/financialYears.js';
import { dividendsRepo, type DividendWithSecurity } from '../db/repos/dividends.js';
import { propertiesRepo } from '../db/repos/properties.js';
import { rentalTransactionsRepo } from '../db/repos/rentalTransactions.js';
import { convertToAud } from '../lib/money.js';
import { computeCgtForFy, type CgtResult } from './cgt.js';
import { computeDepreciationForFy } from './depreciation.js';

export interface TaxEstimateLine {
  label: string;
  amount_cents: number;
  formula: string;
}

export interface BracketBreakdown {
  threshold_from_cents: number;
  threshold_to_cents: number | null;
  base_tax_cents: number;
  marginal_rate: number;
  applied: boolean;
  taxable_in_bracket_cents: number;
  tax_in_bracket_cents: number;
}

export interface DividendTotalsAud {
  unfranked_cents: number;
  franked_cents: number;
  franking_credits_cents: number;
  withholding_tax_cents: number;
  au_total_cents: number;
  foreign_total_cents: number;
}

export interface RentalPropertySummary {
  id: number;
  address: string;
  net_cents: number;
  ownership_adjusted_net_cents: number;
}

export interface RentalBlock {
  properties: RentalPropertySummary[];
  total_net_cents: number;
}

export interface TaxEstimateResult {
  fy: FinancialYear;
  payslip_count: number;
  gross_cents: number;
  allowances_cents: number;
  tax_withheld_cents: number;
  super_cents: number;
  taxable_income_cents: number;
  income_tax_cents: number;
  medicare_levy_cents: number;
  lito_cents: number;
  franking_credits_cents: number;
  fito_cents: number;
  dividend_totals: DividendTotalsAud;
  cgt: {
    total_gain_cents: number;
    total_loss_cents: number;
    net_gain_cents: number;
    discounted_net_gain_cents: number;
    loss_carryforward_cents: number;
    event_count: number;
    orphan_count: number;
  };
  rental: RentalBlock;
  estimated_tax_payable_cents: number;
  refund_or_bill_cents: number;
  bracket_breakdown: BracketBreakdown[];
  lines: TaxEstimateLine[];
  config: TaxConfig;
}

function fmtAud(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function computeIncomeTax(
  taxableCents: number,
  brackets: readonly TaxBracket[],
): { taxCents: number; breakdown: BracketBreakdown[] } {
  if (brackets.length === 0) return { taxCents: 0, breakdown: [] };
  const breakdown: BracketBreakdown[] = brackets.map((b) => ({
    threshold_from_cents: b.threshold_from_cents,
    threshold_to_cents: b.threshold_to_cents,
    base_tax_cents: b.base_tax_cents,
    marginal_rate: b.marginal_rate,
    applied: false,
    taxable_in_bracket_cents: 0,
    tax_in_bracket_cents: 0,
  }));

  if (taxableCents <= 0) return { taxCents: 0, breakdown };

  let appliedBracket: TaxBracket | undefined;
  for (const b of brackets) {
    if (
      taxableCents >= b.threshold_from_cents &&
      (b.threshold_to_cents === null || taxableCents < b.threshold_to_cents)
    ) {
      appliedBracket = b;
      break;
    }
  }
  if (!appliedBracket) appliedBracket = brackets[brackets.length - 1];
  if (!appliedBracket) return { taxCents: 0, breakdown };

  const taxFloat =
    appliedBracket.base_tax_cents +
    appliedBracket.marginal_rate * (taxableCents - appliedBracket.threshold_from_cents);
  const taxCents = Math.round(taxFloat);

  for (const row of breakdown) {
    if (row.threshold_from_cents === appliedBracket.threshold_from_cents) {
      row.applied = true;
      row.taxable_in_bracket_cents = Math.max(0, taxableCents - appliedBracket.threshold_from_cents);
      row.tax_in_bracket_cents = taxCents;
    }
  }

  return { taxCents, breakdown };
}

export function computeLito(taxableCents: number, config: TaxConfig): number {
  if (taxableCents <= 0) return 0;
  if (taxableCents <= config.lito_taper1_threshold_cents) {
    return config.lito_max_cents;
  }
  if (taxableCents <= config.lito_taper2_threshold_cents) {
    const reduction = config.lito_taper1_rate * (taxableCents - config.lito_taper1_threshold_cents);
    return Math.max(0, Math.round(config.lito_max_cents - reduction));
  }
  const taper2Start =
    config.lito_max_cents -
    config.lito_taper1_rate *
      (config.lito_taper2_threshold_cents - config.lito_taper1_threshold_cents);
  const reduction = config.lito_taper2_rate * (taxableCents - config.lito_taper2_threshold_cents);
  return Math.max(0, Math.round(taper2Start - reduction));
}

function aggregateDividendsAud(divs: readonly DividendWithSecurity[]): DividendTotalsAud {
  let unfranked = 0;
  let franked = 0;
  let franking = 0;
  let withholding = 0;
  let auTotal = 0;
  let foreignTotal = 0;

  for (const d of divs) {
    const isAud = d.currency === 'AUD';
    const audUnfranked = isAud
      ? d.unfranked_cents
      : convertToAud(d.unfranked_cents, d.aud_fx_rate, d.currency);
    const audFranked = isAud
      ? d.franked_cents
      : convertToAud(d.franked_cents, d.aud_fx_rate, d.currency);
    const audFranking = isAud
      ? d.franking_credits_cents
      : convertToAud(d.franking_credits_cents, d.aud_fx_rate, d.currency);
    const audWithholding = isAud
      ? d.withholding_tax_cents
      : convertToAud(d.withholding_tax_cents, d.aud_fx_rate, d.currency);

    unfranked += audUnfranked;
    franked += audFranked;
    franking += audFranking;
    withholding += audWithholding;
    if (isAud) auTotal += audUnfranked + audFranked;
    else foreignTotal += audUnfranked + audFranked;
  }
  return {
    unfranked_cents: unfranked,
    franked_cents: franked,
    franking_credits_cents: franking,
    withholding_tax_cents: withholding,
    au_total_cents: auTotal,
    foreign_total_cents: foreignTotal,
  };
}

function computeRentalBlock(fyId: number): RentalBlock {
  const properties = propertiesRepo.findAll();
  const summaries: RentalPropertySummary[] = [];

  for (const prop of properties) {
    const totals = rentalTransactionsRepo.totalsByPropertyAndFy(prop.id, fyId);
    let depreciation_total = 0;
    try {
      const dep = computeDepreciationForFy(prop.id, fyId, prop.sold_date);
      depreciation_total = dep.total_cents;
    } catch {
      // no fy or assets — skip
    }
    const net_cents = totals.income_cents - totals.expense_cents - depreciation_total;
    const ownership_adjusted_net_cents = Math.round(net_cents * (prop.ownership_percent / 100));
    summaries.push({ id: prop.id, address: prop.address, net_cents, ownership_adjusted_net_cents });
  }

  const total_net_cents = summaries.reduce((s, p) => s + p.ownership_adjusted_net_cents, 0);
  return { properties: summaries, total_net_cents };
}

export function buildTaxEstimate(fyId: number): TaxEstimateResult {
  const fy = financialYearsRepo.findById(fyId);
  if (!fy) throw new Error(`Financial year ${fyId} not found`);
  const totals = payslipsRepo.totalsByFy(fyId);
  const brackets = taxConfigRepo.bracketsByFy(fyId);
  const config = taxConfigRepo.configByFy(fyId);
  if (!config) throw new Error(`Tax config missing for FY ${fy.label}`);

  const dividends = dividendsRepo.listByFy(fyId);
  const divTotals = aggregateDividendsAud(dividends);

  let cgt: CgtResult;
  try {
    cgt = computeCgtForFy(fyId);
  } catch (err) {
    console.warn('[tax-estimate] CGT compute failed:', err);
    cgt = {
      fy,
      events: [],
      totalGainCents: 0,
      totalLossCents: 0,
      netGainCents: 0,
      discountedNetGainCents: 0,
      loss_carryforward_cents: 0,
      orphans: [],
    };
  }

  const rental = computeRentalBlock(fyId);

  // Taxable income:
  //   salary + allowances
  //   + AU dividends grossed up: unfranked + franked + franking credit
  //   + foreign dividends (already in AUD via FX)
  //   + discounted net capital gain
  //   + rental net (negative = negative gearing, reduces taxable income)
  const taxableIncomeCents =
    totals.gross_cents +
    totals.allowances_cents +
    divTotals.unfranked_cents +
    divTotals.franked_cents +
    divTotals.franking_credits_cents +
    cgt.discountedNetGainCents +
    rental.total_net_cents;

  const { taxCents: incomeTaxCents, breakdown } = computeIncomeTax(taxableIncomeCents, brackets);

  const medicareCents = Math.round(taxableIncomeCents * config.medicare_levy_rate);
  const litoCents = computeLito(taxableIncomeCents, config);
  const fitoCents = divTotals.withholding_tax_cents;

  const estimatedTaxPayableCents = Math.max(
    0,
    incomeTaxCents + medicareCents - litoCents - divTotals.franking_credits_cents - fitoCents,
  );
  const refundOrBillCents = totals.tax_withheld_cents - estimatedTaxPayableCents;

  const rentalLine: TaxEstimateLine =
    rental.total_net_cents < 0
      ? {
          label: 'Negative gearing offset',
          amount_cents: rental.total_net_cents,
          formula: `Net rental loss across ${rental.properties.length} property/ies (reduces taxable income)`,
        }
      : {
          label: 'Net rental income (all properties)',
          amount_cents: rental.total_net_cents,
          formula: `Net rental income across ${rental.properties.length} property/ies (adds to taxable income)`,
        };

  const lines: TaxEstimateLine[] = [
    {
      label: 'Gross salary',
      amount_cents: totals.gross_cents,
      formula: `Sum of ${totals.count} payslip(s) gross`,
    },
    {
      label: 'Allowances',
      amount_cents: totals.allowances_cents,
      formula: 'Sum of payslip allowances',
    },
    {
      label: 'AU dividends (unfranked + franked)',
      amount_cents: divTotals.au_total_cents,
      formula: 'Sum of AU dividends paid in FY (cash component)',
    },
    {
      label: 'Franking credits (gross-up)',
      amount_cents: divTotals.franking_credits_cents,
      formula: 'Added to assessable income; refundable as offset below',
    },
    {
      label: 'Foreign dividends (AUD-converted)',
      amount_cents: divTotals.foreign_total_cents,
      formula: 'Foreign dividend cash converted via Stake AUD/USD rate',
    },
    {
      label: 'Net capital gain (after 50% discount)',
      amount_cents: cgt.discountedNetGainCents,
      formula:
        `Gross gains ${fmtAud(cgt.totalGainCents)} - losses ${fmtAud(cgt.totalLossCents)}; ` +
        `losses applied to ineligible (<12mo) gains first, then 50% discount on remaining eligible.`,
    },
    rentalLine,
    {
      label: 'Taxable income',
      amount_cents: taxableIncomeCents,
      formula: 'salary + allowances + AU divs + franking credits + foreign divs (AUD) + discounted CGT + rental net',
    },
    {
      label: 'Income tax',
      amount_cents: incomeTaxCents,
      formula: 'Resident bracket: base + marginal_rate * (income - threshold_from)',
    },
    {
      label: `Medicare levy (${(config.medicare_levy_rate * 100).toFixed(1)}%)`,
      amount_cents: medicareCents,
      formula: `${config.medicare_levy_rate} * taxable income (low-income reduction TODO Phase 5)`,
    },
    {
      label: 'LITO offset',
      amount_cents: -litoCents,
      formula: 'Low Income Tax Offset',
    },
    {
      label: 'Franking credit offset (refundable)',
      amount_cents: -divTotals.franking_credits_cents,
      formula: 'Refundable: imputation credits attached to franked dividends',
    },
    {
      label: 'Foreign Income Tax Offset (FITO)',
      amount_cents: -fitoCents,
      formula:
        'Phase 2: full foreign dividend withholding tax (AUD) as offset. ' +
        'TODO: cap at AU tax attributable to foreign income.',
    },
    {
      label: 'Estimated tax payable',
      amount_cents: estimatedTaxPayableCents,
      formula: 'max(0, income_tax + medicare - LITO - franking_credits - FITO)',
    },
    {
      label: 'Tax withheld (PAYG)',
      amount_cents: totals.tax_withheld_cents,
      formula: 'Sum of payslip tax withheld',
    },
    {
      label: refundOrBillCents >= 0 ? 'Estimated refund' : 'Estimated balance owing',
      amount_cents: refundOrBillCents,
      formula: `withheld (${fmtAud(totals.tax_withheld_cents)}) - tax payable (${fmtAud(estimatedTaxPayableCents)})`,
    },
  ];

  return {
    fy,
    payslip_count: totals.count,
    gross_cents: totals.gross_cents,
    allowances_cents: totals.allowances_cents,
    tax_withheld_cents: totals.tax_withheld_cents,
    super_cents: totals.super_cents,
    taxable_income_cents: taxableIncomeCents,
    income_tax_cents: incomeTaxCents,
    medicare_levy_cents: medicareCents,
    lito_cents: litoCents,
    franking_credits_cents: divTotals.franking_credits_cents,
    fito_cents: fitoCents,
    dividend_totals: divTotals,
    cgt: {
      total_gain_cents: cgt.totalGainCents,
      total_loss_cents: cgt.totalLossCents,
      net_gain_cents: cgt.netGainCents,
      discounted_net_gain_cents: cgt.discountedNetGainCents,
      loss_carryforward_cents: cgt.loss_carryforward_cents,
      event_count: cgt.events.length,
      orphan_count: cgt.orphans.length,
    },
    rental,
    estimated_tax_payable_cents: estimatedTaxPayableCents,
    refund_or_bill_cents: refundOrBillCents,
    bracket_breakdown: breakdown,
    lines,
    config,
  };
}
