import { payslipsRepo } from '../db/repos/payslips.js';
import { taxConfigRepo, type TaxBracket, type TaxConfig } from '../db/repos/taxConfig.js';
import { financialYearsRepo, type FinancialYear } from '../db/repos/financialYears.js';
import { dividendsRepo, type DividendWithSecurity } from '../db/repos/dividends.js';
import { propertiesRepo } from '../db/repos/properties.js';
import { rentalTransactionsRepo } from '../db/repos/rentalTransactions.js';
import { deductionsRepo } from '../db/repos/deductions.js';
import { convertToAud } from '../lib/money.js';
import { computeCgtForFy, type CgtResult } from './cgt.js';
import { computeDepreciationForFy } from './depreciation.js';
import {
  CGT_MIN_TAX_RATE,
  REFORM_COMMENCEMENT_DATE,
  classifyNgStatus,
  ngOffsetAllowedForFy,
  type NgStatus,
} from '../lib/budgetReform2027.js';
import { residentialLossCfRepo } from '../db/repos/residentialLossCf.js';

// ATO HECS/HELP compulsory repayment rates.
// Repayment = rate × full repayment income (not just excess above threshold).
// Source: ATO 2024-25 individual tax return instructions. Verify 2025-26 against ATO.
const HECS_TIERS: { from_cents: number; rate: number }[] = [
  { from_cents:   5_443_500, rate: 0.010 },
  { from_cents:   6_285_000, rate: 0.020 },
  { from_cents:   6_619_300, rate: 0.025 },
  { from_cents:   7_220_800, rate: 0.030 },
  { from_cents:   7_762_000, rate: 0.035 },
  { from_cents:   8_394_600, rate: 0.040 },
  { from_cents:   8_852_500, rate: 0.045 },
  { from_cents:   9_486_900, rate: 0.050 },
  { from_cents:   9_999_700, rate: 0.055 },
  { from_cents:  10_899_700, rate: 0.060 },
  { from_cents:  11_600_800, rate: 0.065 },
  { from_cents:  12_461_200, rate: 0.070 },
  { from_cents:  13_374_100, rate: 0.075 },
  { from_cents:  14_330_700, rate: 0.080 },
  { from_cents:  15_480_100, rate: 0.085 },
  { from_cents:  16_577_000, rate: 0.090 },
  { from_cents:  17_707_300, rate: 0.095 },
  { from_cents:  18_997_500, rate: 0.100 },
];

// MLS thresholds 2024-25 (singles). Apply same for 2025-26 — verify against ATO before lodging.
// MLS replaces the low-income Medicare reduction for simplicity; shade-in applied at each tier.
const MLS_TIERS = [
  { threshold_cents:  9_300_000, rate: 0.010 }, // $93,000
  { threshold_cents: 10_800_000, rate: 0.0125 }, // $108,000
  { threshold_cents: 14_400_000, rate: 0.015 },  // $144,000
] as const;

function computeMls(taxableIncomeCents: number, hasPhiCover: boolean): number {
  if (hasPhiCover || taxableIncomeCents <= 0) return 0;
  let rate = 0;
  let threshold = 0;
  for (const tier of MLS_TIERS) {
    if (taxableIncomeCents > tier.threshold_cents) {
      rate = tier.rate;
      threshold = tier.threshold_cents;
    }
  }
  if (rate === 0) return 0;
  // Shade-in: MLS ≤ 10% × (income − base threshold) to avoid cliff at threshold boundary
  const normal = Math.round(taxableIncomeCents * rate);
  const shadeIn = Math.round((taxableIncomeCents - threshold) * 0.1);
  return Math.min(normal, shadeIn);
}

// Division 293: extra 15% tax on concessional super when income + super > $250k.
// Applies to the lower of (a) concessional super and (b) amount above the $250k threshold.
const DIV293_THRESHOLD_CENTS = 25_000_000; // $250,000

function computeDiv293(taxableIncomeCents: number, concessionalSuperCents: number): number {
  if (concessionalSuperCents <= 0) return 0;
  const div293Income = taxableIncomeCents + concessionalSuperCents;
  if (div293Income <= DIV293_THRESHOLD_CENTS) return 0;
  const excessCents = div293Income - DIV293_THRESHOLD_CENTS;
  const chargeableCents = Math.min(concessionalSuperCents, excessCents);
  return Math.round(chargeableCents * 0.15);
}

function computeHecsRepayment(repaymentIncomeCents: number): number {
  if (repaymentIncomeCents <= 0) return 0;
  let rate = 0;
  for (let i = HECS_TIERS.length - 1; i >= 0; i--) {
    if (repaymentIncomeCents >= (HECS_TIERS[i]?.from_cents ?? 0)) {
      rate = HECS_TIERS[i]?.rate ?? 0;
      break;
    }
  }
  return Math.round(repaymentIncomeCents * rate);
}

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
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  ownership_adjusted_net_cents: number;
  ng_status: NgStatus;
}

export interface RentalBlock {
  properties: RentalPropertySummary[];
  // Amount that flows into taxable income (general net + quarantined positive after carry-forward).
  total_net_cents: number;
  // Net from grandfathered / new-build properties (can be negative → reduces taxable income).
  general_offset_net_cents: number;
  // Raw net from restricted / transitional properties (can be negative → quarantined, not in taxable).
  quarantined_net_cents: number;
  // Prior accumulated carry-forward applied to reduce quarantined positive income this FY.
  carry_forward_applied_cents: number;
  // Accumulated carry-forward remaining after this FY (persisted for next FY).
  new_carry_forward_cents: number;
  // false for FY ≤ 2026-27 (all losses still offset general income).
  reform_applies: boolean;
}

export interface TaxEstimateResult {
  fy: FinancialYear;
  payslip_count: number;
  gross_cents: number;
  allowances_cents: number;
  tax_withheld_cents: number;
  super_cents: number;
  total_deductions_cents: number;
  taxable_income_cents: number;
  income_tax_cents: number;
  medicare_levy_cents: number;
  lito_cents: number;
  franking_credits_cents: number;
  fito_cents: number;
  hecs_repayment_cents: number;
  has_hecs: boolean;
  mls_cents: number;
  div293_cents: number;
  cgt_min_tax_cents: number;
  has_phi: boolean;
  received_income_support: boolean;
  dividend_totals: DividendTotalsAud;
  cgt: {
    total_gain_cents: number;
    total_loss_cents: number;
    net_gain_cents: number;
    discounted_net_gain_cents: number;
    new_regime_net_gain_cents: number;
    min_tax_real_gain_cents: number;
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

function computeRentalBlock(fyId: number, fy: FinancialYear): RentalBlock {
  const properties = propertiesRepo.findAll();
  const reformApplies = fy.start_date >= REFORM_COMMENCEMENT_DATE;
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
    const ng_status = classifyNgStatus({
      is_new_build: prop.is_new_build,
      acquired_date: prop.acquired_date,
      contract_date: prop.contract_date,
    });
    summaries.push({
      id: prop.id,
      address: prop.address,
      income_cents: totals.income_cents,
      expense_cents: totals.expense_cents + depreciation_total,
      net_cents,
      ownership_adjusted_net_cents,
      ng_status,
    });
  }

  if (!reformApplies) {
    const total_net_cents = summaries.reduce((s, p) => s + p.ownership_adjusted_net_cents, 0);
    return {
      properties: summaries,
      total_net_cents,
      general_offset_net_cents: total_net_cents,
      quarantined_net_cents: 0,
      carry_forward_applied_cents: 0,
      new_carry_forward_cents: 0,
      reform_applies: false,
    };
  }

  // Reform applies from FY 2027-28 onwards.
  // Split properties: unrestricted (can offset general income) vs quarantined.
  let generalNet = 0;
  let quarantinedNet = 0;
  for (const p of summaries) {
    if (ngOffsetAllowedForFy(p.ng_status, fy.start_date)) {
      generalNet += p.ownership_adjusted_net_cents;
    } else {
      quarantinedNet += p.ownership_adjusted_net_cents;
    }
  }

  // Apply prior carry-forward to quarantined positive income.
  const priorCf = residentialLossCfRepo.getPriorFyAmount(fy.start_date);
  let quarantinedTaxable: number;
  let cfApplied: number;
  let newCf: number;

  if (quarantinedNet >= 0) {
    // Positive quarantined income: use carry-forward to offset it first.
    cfApplied = Math.min(priorCf, quarantinedNet);
    quarantinedTaxable = quarantinedNet - cfApplied;
    newCf = priorCf - cfApplied;
  } else {
    // Quarantined loss: does NOT reduce general taxable income; accumulate.
    cfApplied = 0;
    quarantinedTaxable = 0;
    newCf = priorCf + (-quarantinedNet);
  }

  // Persist carry-forward for next FY's use (idempotent upsert).
  residentialLossCfRepo.save(fyId, newCf);

  const total_net_cents = generalNet + quarantinedTaxable;
  return {
    properties: summaries,
    total_net_cents,
    general_offset_net_cents: generalNet,
    quarantined_net_cents: quarantinedNet,
    carry_forward_applied_cents: cfApplied,
    new_carry_forward_cents: newCf,
    reform_applies: true,
  };
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
      new_regime_net_gain_cents: 0,
      min_tax_real_gain_cents: 0,
      loss_carryforward_cents: 0,
      orphans: [],
    };
  }

  const rental = computeRentalBlock(fyId, fy);
  const totalDeductionsCents = deductionsRepo.totalByFy(fyId);
  const taxSettings = deductionsRepo.getTaxSettings(fyId);
  const {
    has_hecs: hasHecs,
    has_phi: hasPhi,
    salary_sacrifice_super_cents: salarySacrificeSuper,
    received_income_support: hasReceivedIncomeSupport,
  } = taxSettings;

  // Taxable income:
  //   salary + allowances
  //   + AU dividends grossed up: unfranked + franked + franking credit
  //   + foreign dividends (already in AUD via FX)
  //   + discounted net capital gain
  //   + rental net (negative = negative gearing, reduces taxable income)
  //   − work-related and other deductions
  // CGT taxable income: legacy discounted gains + new-regime real (CPI-indexed) gains.
  // For FY ≤ 2026-27, new_regime_net_gain_cents is always 0 (no sales after 1 Jul 2027).
  const cgtTaxableGainCents = cgt.discountedNetGainCents + cgt.new_regime_net_gain_cents;

  const taxableIncomeCents = Math.max(
    0,
    totals.gross_cents +
    totals.allowances_cents +
    divTotals.unfranked_cents +
    divTotals.franked_cents +
    divTotals.franking_credits_cents +
    cgtTaxableGainCents +
    rental.total_net_cents -
    totalDeductionsCents,
  );

  const { taxCents: incomeTaxCents, breakdown } = computeIncomeTax(taxableIncomeCents, brackets);

  const medicareCents = Math.round(taxableIncomeCents * config.medicare_levy_rate);
  const mlsCents = computeMls(taxableIncomeCents, hasPhi);
  const litoCents = computeLito(taxableIncomeCents, config);
  const fitoCents = divTotals.withholding_tax_cents;
  const hecsRepaymentCents = hasHecs ? computeHecsRepayment(taxableIncomeCents) : 0;

  // Concessional super = employer SGC from payslips + any salary sacrifice entered
  const concessionalSuperCents = totals.super_cents + salarySacrificeSuper;
  const div293Cents = computeDiv293(taxableIncomeCents, concessionalSuperCents);

  // 2026-27 Budget Reform: 30% minimum tax on new-regime real capital gains (from 1 Jul 2027).
  // Compares income-tax-only (Medicare levy excluded per the Jack cameo) on the gain against 30%.
  // Exempt when: no new-regime gain, OR taxpayer received a means-tested income support payment.
  // Note: tax offsets (e.g. LITO) may further reduce this in practice — simplified here.
  const cgtMinTaxCents = (() => {
    const realGain = cgt.min_tax_real_gain_cents;
    if (realGain <= 0 || hasReceivedIncomeSupport) return 0;
    const taxableWithoutGain = Math.max(0, taxableIncomeCents - realGain);
    const { taxCents: taxWithoutGain } = computeIncomeTax(taxableWithoutGain, brackets);
    const incrementalTax = incomeTaxCents - taxWithoutGain;
    const minimumTax = Math.round(realGain * CGT_MIN_TAX_RATE);
    return Math.max(0, minimumTax - incrementalTax);
  })();

  const estimatedTaxPayableCents = Math.max(
    0,
    incomeTaxCents + medicareCents + mlsCents - litoCents - divTotals.franking_credits_cents - fitoCents,
  );
  const refundOrBillCents = totals.tax_withheld_cents - estimatedTaxPayableCents - hecsRepaymentCents - div293Cents - cgtMinTaxCents;

  const n = rental.properties.length;
  const rentalMainLine: TaxEstimateLine = rental.total_net_cents < 0
    ? {
        label: 'Negative gearing offset',
        amount_cents: rental.total_net_cents,
        formula: `Net rental loss across ${n} propert${n === 1 ? 'y' : 'ies'} (reduces taxable income)`,
      }
    : {
        label: 'Net rental income (all properties)',
        amount_cents: rental.total_net_cents,
        formula: `Net rental income across ${n} propert${n === 1 ? 'y' : 'ies'} (adds to taxable income)`,
      };
  // Reform-specific informational lines (amount_cents = 0; already reflected in total_net_cents above).
  const rentalReformLines: TaxEstimateLine[] = rental.reform_applies ? [
    ...(rental.quarantined_net_cents < 0 ? [{
      label: 'Restricted rental loss quarantined (carry-forward)',
      amount_cents: 0,
      formula:
        `Loss of ${fmtAud(-rental.quarantined_net_cents)} from restricted/transitional properties ` +
        `is quarantined — does not offset salary/wages. ` +
        `Accumulated carry-forward now ${fmtAud(rental.new_carry_forward_cents)} (applied against future residential-property income).`,
    }] : []),
    ...(rental.carry_forward_applied_cents > 0 ? [{
      label: 'Prior rental loss carry-forward applied',
      amount_cents: 0,
      formula:
        `${fmtAud(rental.carry_forward_applied_cents)} of prior accumulated losses applied against ` +
        `restricted-property income this FY (already included in net rental line above). ` +
        `Remaining carry-forward: ${fmtAud(rental.new_carry_forward_cents)}.`,
    }] : []),
  ] : [];

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
      label: cgt.new_regime_net_gain_cents > 0
        ? 'Net capital gain (legacy 50% discount)'
        : 'Net capital gain (after 50% discount)',
      amount_cents: cgt.discountedNetGainCents,
      formula:
        `Gross gains ${fmtAud(cgt.totalGainCents)} - losses ${fmtAud(cgt.totalLossCents)}; ` +
        `losses applied to non-discounted gains first, then 50% discount on eligible.`,
    },
    ...(cgt.new_regime_net_gain_cents > 0 ? [{
      label: 'Net capital gain (post-1 Jul 2027, CPI-indexed)',
      amount_cents: cgt.new_regime_net_gain_cents,
      formula:
        `Real gains after CPI indexation on assets acquired/sold under the 2027 reform rules. ` +
        `30% minimum tax applies (see Phase 3).`,
    }] : []),
    rentalMainLine,
    ...rentalReformLines,
    ...(totalDeductionsCents > 0 ? [{
      label: 'Work-related & other deductions',
      amount_cents: -totalDeductionsCents,
      formula: 'D1–D10 deductions reduce taxable income',
    }] : []),
    {
      label: 'Taxable income',
      amount_cents: taxableIncomeCents,
      formula: 'salary + allowances + AU divs + franking credits + foreign divs (AUD) + CGT (legacy discounted + new-regime indexed) + rental net − deductions',
    },
    {
      label: 'Income tax',
      amount_cents: incomeTaxCents,
      formula: 'Resident bracket: base + marginal_rate * (income - threshold_from)',
    },
    {
      label: `Medicare levy (${(config.medicare_levy_rate * 100).toFixed(1)}%)`,
      amount_cents: medicareCents,
      formula: `${config.medicare_levy_rate} × taxable income`,
    },
    ...(mlsCents > 0 ? [{
      label: 'Medicare Levy Surcharge',
      amount_cents: mlsCents,
      formula: `No private hospital cover + income > $93,000 — surcharge rate applied to taxable income`,
    }] : []),
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
    ...(div293Cents > 0 ? [{
      label: 'Division 293 tax (super)',
      amount_cents: div293Cents,
      formula: `15% × min(concessional super ${fmtAud(concessionalSuperCents)}, income+super above $250k) — billed separately by ATO`,
    }] : []),
    ...(cgtMinTaxCents > 0 ? [{
      label: 'CGT minimum tax top-up (30%)',
      amount_cents: cgtMinTaxCents,
      formula:
        `2027 reform: real gain ${fmtAud(cgt.min_tax_real_gain_cents)} × 30% = ` +
        `${fmtAud(Math.round(cgt.min_tax_real_gain_cents * CGT_MIN_TAX_RATE))} minimum; ` +
        `incremental income tax on gain was less than 30%, so top-up applies. ` +
        `Billed separately (like HECS). Exempt if receiving Age Pension / JobSeeker.`,
    }] : []),
    ...(hecsRepaymentCents > 0 ? [{
      label: 'HECS/HELP compulsory repayment',
      amount_cents: hecsRepaymentCents,
      formula: `Repayment income ${fmtAud(taxableIncomeCents)} × applicable rate (ATO 2024-25 schedule)`,
    }] : []),
    {
      label: 'Tax withheld (PAYG)',
      amount_cents: totals.tax_withheld_cents,
      formula: 'Sum of payslip tax withheld',
    },
    {
      label: refundOrBillCents >= 0 ? 'Estimated refund' : 'Estimated balance owing',
      amount_cents: refundOrBillCents,
      formula: `withheld (${fmtAud(totals.tax_withheld_cents)}) - tax payable (${fmtAud(estimatedTaxPayableCents)})${cgtMinTaxCents > 0 ? ` - CGT min tax (${fmtAud(cgtMinTaxCents)})` : ''}${hecsRepaymentCents > 0 ? ` - HECS (${fmtAud(hecsRepaymentCents)})` : ''}`,
    },
  ];

  return {
    fy,
    payslip_count: totals.count,
    gross_cents: totals.gross_cents,
    allowances_cents: totals.allowances_cents,
    tax_withheld_cents: totals.tax_withheld_cents,
    super_cents: totals.super_cents,
    total_deductions_cents: totalDeductionsCents,
    taxable_income_cents: taxableIncomeCents,
    income_tax_cents: incomeTaxCents,
    medicare_levy_cents: medicareCents,
    lito_cents: litoCents,
    franking_credits_cents: divTotals.franking_credits_cents,
    fito_cents: fitoCents,
    hecs_repayment_cents: hecsRepaymentCents,
    has_hecs: hasHecs,
    mls_cents: mlsCents,
    div293_cents: div293Cents,
    cgt_min_tax_cents: cgtMinTaxCents,
    has_phi: hasPhi,
    received_income_support: hasReceivedIncomeSupport,
    dividend_totals: divTotals,
    cgt: {
      total_gain_cents: cgt.totalGainCents,
      total_loss_cents: cgt.totalLossCents,
      net_gain_cents: cgt.netGainCents,
      discounted_net_gain_cents: cgt.discountedNetGainCents,
      new_regime_net_gain_cents: cgt.new_regime_net_gain_cents,
      min_tax_real_gain_cents: cgt.min_tax_real_gain_cents,
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
