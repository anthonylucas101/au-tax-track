// 2026-27 Budget reform — Negative Gearing & CGT changes.
// Announced 7:30pm AEST 12 May 2026; commences 1 Jul 2027.
// Source: "Negative Gearing and Capital Gains Tax Reform" Budget 2026-27 explainer.

import { cpiIndexRepo } from '../db/repos/cpiIndex.js';

// ─── Key dates & rates ────────────────────────────────────────────────────────

export const REFORM_ANNOUNCEMENT_DATE = '2026-05-12'; // grandfathering cut-off
export const REFORM_COMMENCEMENT_DATE = '2027-07-01'; // new rules start
export const CGT_MIN_TAX_RATE = 0.30;                 // 30% minimum tax on real capital gains
export const COMMENCEMENT_QUARTER = '2027-Q3';        // CPI quarter for 1 Jul 2027 (transitional base)

// ─── Negative gearing classification ─────────────────────────────────────────

// grandfathered   — held at announcement (incl. unsettled contracts); losses always offset general income
// transitional_window — acquired 13 May 2026–30 Jun 2027; NG allowed thru FY 2026-27 only
// restricted      — acquired on/after 1 Jul 2027; losses never offset general income
// new_build       — eligible new build regardless of purchase date; NG and CGT-method choice always available
export type NgStatus = 'grandfathered' | 'transitional_window' | 'restricted' | 'new_build';

// Classify a property's NG status.
// contract_date should be set when a binding contract predates the settlement (acquired_date);
// the earlier of the two dates determines grandfathering.
export function classifyNgStatus(opts: {
  is_new_build: boolean | number;
  acquired_date: string | null;
  contract_date?: string | null;
}): NgStatus {
  if (opts.is_new_build) return 'new_build';
  const effectiveDate = opts.contract_date ?? opts.acquired_date;
  if (!effectiveDate || effectiveDate <= REFORM_ANNOUNCEMENT_DATE) return 'grandfathered';
  if (effectiveDate < REFORM_COMMENCEMENT_DATE) return 'transitional_window';
  return 'restricted';
}

// Returns true when a property's rental loss can offset general income (salary, etc.) for the given FY.
// fyStartDate is the FY start in ISO format, e.g. '2026-07-01'.
export function ngOffsetAllowedForFy(status: NgStatus, fyStartDate: string): boolean {
  if (status === 'grandfathered' || status === 'new_build') return true;
  // transitional_window: allowed only while still in FY 2026-27 (starts before commencement)
  if (status === 'transitional_window') return fyStartDate < REFORM_COMMENCEMENT_DATE;
  return false;
}

// ─── CPI indexation helpers ───────────────────────────────────────────────────

// Convert an ISO date to 'YYYY-QN' quarter key.
// Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec.
export function cpiQuarterKey(isoDate: string): string {
  const month = parseInt(isoDate.slice(5, 7), 10);
  const year = parseInt(isoDate.slice(0, 4), 10);
  const q = Math.ceil(month / 3);
  return `${year}-Q${q}`;
}

// Compute the CPI indexation factor: cpi(disposalDate) / cpi(acquisitionDate).
// Throws if either quarter is not present in cpi_index — add the quarter first.
export function cpiFactor(acquisitionDate: string, disposalDate: string): number {
  const acqQ = cpiQuarterKey(acquisitionDate);
  const dispQ = cpiQuarterKey(disposalDate);
  const acqRec = cpiIndexRepo.get(acqQ);
  const dispRec = cpiIndexRepo.get(dispQ);
  if (!acqRec) throw new Error(`CPI data missing for acquisition quarter ${acqQ} — add it to cpi_index`);
  if (!dispRec) throw new Error(`CPI data missing for disposal quarter ${dispQ} — add it to cpi_index`);
  return dispRec.index_value / acqRec.index_value;
}

// Indexed cost base: costBaseCents × cpiFactor(acquisitionDate, disposalDate), rounded to cents.
export function indexedCostBase(costBaseCents: number, acquisitionDate: string, disposalDate: string): number {
  return Math.round(costBaseCents * cpiFactor(acquisitionDate, disposalDate));
}

// ─── CGT regime classification ────────────────────────────────────────────────

// Determine which CGT calculation regime applies to an asset at disposal.
// 'legacy'  — acquired & disposed both before commencement; 50% discount applies as today.
// 'split'   — acquired before, disposed after commencement; split pre/post-commencement gain.
// 'new'     — acquired on/after commencement; fully indexed, no 50% discount, min-tax applies.
export type CgtRegime = 'legacy' | 'split' | 'new';

export function classifyCgtRegime(acquiredDate: string, disposalDate: string): CgtRegime {
  const acquiredAfter = acquiredDate >= REFORM_COMMENCEMENT_DATE;
  const disposedAfter = disposalDate >= REFORM_COMMENCEMENT_DATE;
  if (acquiredAfter) return 'new';
  if (disposedAfter) return 'split';
  return 'legacy';
}

// ─── Apportionment formula ────────────────────────────────────────────────────

// ATO apportionment formula: estimate the asset value at 1 Jul 2027 by assuming linear compound
// growth from cost base to disposal proceeds across the full holding period.
// value@cutover = costBase × (proceeds/costBase) ^ (yearsToCommencement / totalYears)
// Returns null if inputs are degenerate (zero cost, negative gain, etc.).
export function apportionValueAtCommencement(
  costBaseCents: number,
  proceedsCents: number,
  acquiredDate: string,
  disposalDate: string,
): number | null {
  if (costBaseCents <= 0 || proceedsCents <= 0) return null;
  const totalMs = Date.parse(disposalDate) - Date.parse(acquiredDate);
  const toCommencementMs = Date.parse(REFORM_COMMENCEMENT_DATE) - Date.parse(acquiredDate);
  if (totalMs <= 0 || toCommencementMs <= 0 || toCommencementMs >= totalMs) return null;
  const fraction = toCommencementMs / totalMs;
  const ratio = proceedsCents / costBaseCents;
  return Math.round(costBaseCents * Math.pow(ratio, fraction));
}
