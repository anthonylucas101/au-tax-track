// Crypto CGT engine — FIFO matching across all crypto_trades.
//
// aud_value_cents semantics:
//   buy  → total AUD paid (including Swyftx fee/spread); this is the cost base
//   sell → net AUD received (after Swyftx fee/spread); this is the proceeds
//
// The 50% CGT discount applies when held ≥ 12 months (same ATO rule as shares).
// The 2026-27 Budget reform (CPI indexation + 30% min tax) will apply to new-regime
// crypto disposals (sold on/after 1 Jul 2027) but is not yet implemented here.

import { cryptoTradesRepo } from '../db/repos/cryptoTrades.js';
import { financialYearsRepo, type FinancialYear } from '../db/repos/financialYears.js';

const ONE_DAY_MS = 86_400_000;
const TWELVE_MONTHS_DAYS = 365;

export interface CryptoCgtEvent {
  sell_trade_id: number;
  symbol: string;
  sell_date: string;
  acquired_date: string;
  units: number;
  proceeds_cents: number;
  cost_base_cents: number;
  gain_cents: number;
  held_days: number;
  discount_eligible: boolean;
}

export interface CryptoCgtOrphan {
  sell_trade_id: number;
  symbol: string;
  sell_date: string;
  units_sold: number;
  units_unmatched: number;
}

export interface CryptoCgtResult {
  fy: FinancialYear;
  events: CryptoCgtEvent[];
  orphans: CryptoCgtOrphan[];
  total_gain_cents: number;
  total_loss_cents: number;
  net_gain_cents: number;
  discounted_net_gain_cents: number;
  loss_carryforward_cents: number;
  event_count: number;
}

interface Parcel {
  trade_id: number;
  acquired_date: string;
  units: number;
  cost_per_unit_cents: number;
}

function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / ONE_DAY_MS);
}

export function computeCryptoCgtForFy(fyId: number): CryptoCgtResult {
  const fy = financialYearsRepo.findById(fyId);
  if (!fy) throw new Error(`Financial year ${fyId} not found`);

  const trades = cryptoTradesRepo.listAll(); // sorted date asc, id asc

  const byAsset = new Map<number, Parcel[]>();
  const allEvents: CryptoCgtEvent[] = [];
  const allOrphans: CryptoCgtOrphan[] = [];

  for (const t of trades) {
    if (!byAsset.has(t.asset_id)) byAsset.set(t.asset_id, []);
    const parcels = byAsset.get(t.asset_id)!;

    if (t.side === 'buy') {
      parcels.push({
        trade_id: t.id,
        acquired_date: t.trade_date,
        units: t.units,
        cost_per_unit_cents: t.aud_value_cents / Math.max(t.units, 1e-9),
      });
      continue;
    }

    // Sell: FIFO consume
    let remaining = t.units;
    const proceedsPerUnit = t.aud_value_cents / Math.max(t.units, 1e-9);

    while (remaining > 0 && parcels.length > 0) {
      const parcel = parcels[0]!;
      const consumed = Math.min(parcel.units, remaining);
      const proceeds = Math.round(proceedsPerUnit * consumed);
      const costBase = Math.round(parcel.cost_per_unit_cents * consumed);
      const gain = proceeds - costBase;
      const heldDays = diffDays(parcel.acquired_date, t.trade_date);

      allEvents.push({
        sell_trade_id: t.id,
        symbol: t.symbol,
        sell_date: t.trade_date,
        acquired_date: parcel.acquired_date,
        units: consumed,
        proceeds_cents: proceeds,
        cost_base_cents: costBase,
        gain_cents: gain,
        held_days: heldDays,
        discount_eligible: heldDays >= TWELVE_MONTHS_DAYS,
      });

      parcel.units -= consumed;
      remaining -= consumed;
      if (parcel.units <= 1e-6) parcels.shift();
    }

    if (remaining > 1e-6) {
      allOrphans.push({
        sell_trade_id: t.id,
        symbol: t.symbol,
        sell_date: t.trade_date,
        units_sold: t.units,
        units_unmatched: remaining,
      });
    }
  }

  const fyEvents = allEvents.filter(
    (e) => e.sell_date >= fy.start_date && e.sell_date <= fy.end_date,
  );
  const fyOrphans = allOrphans.filter(
    (o) => o.sell_date >= fy.start_date && o.sell_date <= fy.end_date,
  );

  let totalGain = 0;
  let totalLoss = 0;
  let eligible = 0;   // gains eligible for 50% discount
  let ineligible = 0; // gains not eligible for discount

  for (const e of fyEvents) {
    if (e.gain_cents > 0) {
      totalGain += e.gain_cents;
      if (e.discount_eligible) eligible += e.gain_cents;
      else ineligible += e.gain_cents;
    } else if (e.gain_cents < 0) {
      totalLoss += -e.gain_cents;
    }
  }

  // Losses: reduce ineligible first, then eligible (same priority as shares)
  const ineligibleAfterLoss = Math.max(0, ineligible - totalLoss);
  const lossAfterIneligible = Math.max(0, totalLoss - ineligible);
  const eligibleAfterLoss = Math.max(0, eligible - lossAfterIneligible);
  const lossCarryforward = Math.max(0, lossAfterIneligible - eligible);

  const netGain = ineligibleAfterLoss + eligibleAfterLoss;
  const discountedNetGain = ineligibleAfterLoss + Math.round(eligibleAfterLoss * 0.5);

  return {
    fy,
    events: fyEvents,
    orphans: fyOrphans,
    total_gain_cents: totalGain,
    total_loss_cents: totalLoss,
    net_gain_cents: netGain,
    discounted_net_gain_cents: discountedNetGain,
    loss_carryforward_cents: lossCarryforward,
    event_count: fyEvents.length,
  };
}
