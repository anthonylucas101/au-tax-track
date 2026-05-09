import { depreciationAssetsRepo, type DepreciationAsset } from '../db/repos/depreciationAssets.js';
import { buildingAllowancesRepo, type BuildingAllowance } from '../db/repos/buildingAllowances.js';
import { financialYearsRepo, type FinancialYear } from '../db/repos/financialYears.js';

export interface Div40Item {
  asset_id: number;
  description: string;
  method: string;
  deduction_cents: number;
}

export interface Div43Item {
  allowance_id: number;
  description: string;
  deduction_cents: number;
}

export interface DepreciationResult {
  div40: Div40Item[];
  div43: Div43Item[];
  total_cents: number;
}

/** Days between two ISO date strings (exclusive of start, inclusive of end would be same). */
function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const diff = end - start;
  if (diff <= 0) return 0;
  return Math.floor(diff / 86_400_000);
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

function computePrimeCostDeduction(
  asset: DepreciationAsset,
  fy: FinancialYear,
  soldDate: string | null,
): number {
  const usableEnd = soldDate ? minDate(fy.end_date, soldDate) : fy.end_date;
  const rangeStart = maxDate(asset.start_date, fy.start_date);
  const daysHeld = daysBetween(rangeStart, usableEnd);
  if (daysHeld <= 0) return 0;

  const fyDays = daysBetween(fy.start_date, fy.end_date);
  const annual = (asset.cost_cents * (fyDays / 365)) / asset.effective_life_years;
  const prorated = annual * (daysHeld / fyDays);
  return Math.round(prorated);
}

/**
 * For DV method: accumulate opening book value by replaying DV deductions for all prior FYs.
 * Returns the total prior deductions so opening book value = cost - priorDeductions.
 */
function priorDvDeductions(
  asset: DepreciationAsset,
  currentFyStart: string,
  allFys: FinancialYear[],
): number {
  let bookValue = asset.cost_cents;
  const dvRate = 2 / asset.effective_life_years;
  for (const fy of allFys) {
    if (fy.end_date >= currentFyStart) continue;
    const rangeStart = maxDate(asset.start_date, fy.start_date);
    const daysHeld = daysBetween(rangeStart, fy.end_date);
    if (daysHeld <= 0) continue;
    const fyDays = daysBetween(fy.start_date, fy.end_date);
    const annual = bookValue * (fyDays / 365) * dvRate;
    const prorated = Math.round(annual * (daysHeld / fyDays));
    bookValue = Math.max(0, bookValue - prorated);
  }
  return asset.cost_cents - bookValue;
}

function computeDvDeduction(
  asset: DepreciationAsset,
  fy: FinancialYear,
  soldDate: string | null,
  priorDeductions: number,
): number {
  const usableEnd = soldDate ? minDate(fy.end_date, soldDate) : fy.end_date;
  const rangeStart = maxDate(asset.start_date, fy.start_date);
  const daysHeld = daysBetween(rangeStart, usableEnd);
  if (daysHeld <= 0) return 0;

  const openingBookValue = Math.max(0, asset.cost_cents - priorDeductions);
  if (openingBookValue <= 0) return 0;

  const fyDays = daysBetween(fy.start_date, fy.end_date);
  const dvRate = 2 / asset.effective_life_years;
  const annual = openingBookValue * (fyDays / 365) * dvRate;
  const prorated = annual * (daysHeld / fyDays);
  return Math.round(prorated);
}

function computeBuildingDeduction(
  allowance: BuildingAllowance,
  fy: FinancialYear,
  soldDate: string | null,
): number {
  const usableEnd = soldDate ? minDate(fy.end_date, soldDate) : fy.end_date;
  const rangeStart = maxDate(allowance.completion_date, fy.start_date);
  const daysAvailable = daysBetween(rangeStart, usableEnd);
  if (daysAvailable <= 0) return 0;
  const annual = allowance.construction_cost_cents * allowance.rate * (daysAvailable / 365);
  return Math.round(annual);
}

export function computeDepreciationForFy(
  propertyId: number,
  fyId: number,
  soldDate?: string | null,
): DepreciationResult {
  const fy = financialYearsRepo.findById(fyId);
  if (!fy) throw new Error(`Financial year ${fyId} not found`);

  const allFys = financialYearsRepo.list();
  const assets = depreciationAssetsRepo.listAllForProperty(propertyId);
  const allowances = buildingAllowancesRepo.listAllForProperty(propertyId);
  const effectiveSoldDate = soldDate ?? null;

  const div40: Div40Item[] = assets.map((asset) => {
    let deduction_cents: number;
    if (asset.method === 'prime_cost') {
      deduction_cents = computePrimeCostDeduction(asset, fy, effectiveSoldDate);
    } else {
      const prior = priorDvDeductions(asset, fy.start_date, allFys);
      deduction_cents = computeDvDeduction(asset, fy, effectiveSoldDate, prior);
    }
    return { asset_id: asset.id, description: asset.description, method: asset.method, deduction_cents };
  });

  const div43: Div43Item[] = allowances.map((allowance) => ({
    allowance_id: allowance.id,
    description: allowance.description,
    deduction_cents: computeBuildingDeduction(allowance, fy, effectiveSoldDate),
  }));

  const total_cents =
    div40.reduce((s, x) => s + x.deduction_cents, 0) +
    div43.reduce((s, x) => s + x.deduction_cents, 0);

  return { div40, div43, total_cents };
}
