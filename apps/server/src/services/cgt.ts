// CGT (Capital Gains Tax) engine: FIFO parcels, with the AU 50% discount.
//
// AU rules implemented:
//   * Parcels acquired via buy or as opening balance feed FIFO into the queue.
//   * On sell, parcels are consumed in date order until quantity is met.
//   * Eligible discount when (sell_date - acquired_date) >= 365 days (held > 12mo).
//   * Capital losses can offset capital gains (any order). We optimise: apply
//     losses to non-discounted (ineligible) gains first, then discounted, so
//     the user maxes out the 50% reduction.
//   * If losses exceed gains, net gain is 0 and the remainder is reported as
//     loss_carryforward_cents (not yet persisted; user can carry it manually).
//
// FX: trade row.aud_fx_rate is AUD-per-foreign (around 1.5 for AUD/USD on Stake).
//   AUD = foreign * rate. AUD-only trades have currency=AUD, rate ignored.

import { shareTradesRepo, type ShareTradeWithSecurity } from '../db/repos/shareTrades.js';
import { financialYearsRepo, type FinancialYear } from '../db/repos/financialYears.js';
import { convertToAud } from '../lib/money.js';

const ONE_DAY_MS = 86_400_000;
const TWELVE_MONTHS_DAYS = 365;

export interface CgtParcel {
  units: number;
  cost_base_per_unit_aud_cents: number; // float-safe: stored as float cents
  acquired_date: string;
  source_trade_id: number;
}

export interface CgtEvent {
  sell_trade_id: number;
  ticker: string;
  security_name: string | null;
  sell_date: string;
  acquired_date: string;
  units: number;
  proceeds_aud_cents: number;
  cost_base_aud_cents: number;
  gain_aud_cents: number;
  held_days: number;
  discount_eligible: boolean;
}

export interface OrphanSell {
  sell_trade_id: number;
  ticker: string;
  sell_date: string;
  units_unmatched: number;
  reason: string;
}

export interface CgtResult {
  fy: FinancialYear;
  events: CgtEvent[];
  totalGainCents: number;        // sum of positive gains in events (AUD)
  totalLossCents: number;        // sum of |negative gains| in events (AUD, positive)
  netGainCents: number;          // gains - losses (>= 0); if negative, set to 0 and use loss_carryforward
  discountedNetGainCents: number; // final taxable amount after 50% discount with loss optimisation
  loss_carryforward_cents: number;
  orphans: OrphanSell[];
}

function diffDays(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`Invalid date diff ${aIso} ${bIso}`);
  return Math.round((b - a) / ONE_DAY_MS);
}

function tradeAudCostBasePerUnit(trade: ShareTradeWithSecurity): number {
  // Cost base in AUD cents per unit:
  //   foreign_per_unit = price_cents + (brokerage+gst)/units
  //   aud_per_unit = foreign_per_unit * fxRate    (rate is AUD/foreign)
  //   AUD trades: rate=1 implicit.
  const totalAddOns = trade.brokerage_cents + trade.gst_cents;
  const perUnitAddOn = totalAddOns / Math.max(trade.units, 1e-9);
  const localPerUnit = trade.price_cents + perUnitAddOn;
  if (trade.currency === 'AUD') return localPerUnit;
  if (trade.aud_fx_rate == null) {
    throw new Error(`Trade ${trade.id} (${trade.ticker}) is ${trade.currency} but has no fx rate`);
  }
  return localPerUnit * trade.aud_fx_rate;
}

function tradeProceedsPerUnitAud(trade: ShareTradeWithSecurity): number {
  // For sells, proceeds are price minus apportioned brokerage (fees reduce proceeds).
  const totalAddOns = trade.brokerage_cents + trade.gst_cents;
  const perUnitAddOn = totalAddOns / Math.max(trade.units, 1e-9);
  const localPerUnit = trade.price_cents - perUnitAddOn;
  if (trade.currency === 'AUD') return localPerUnit;
  if (trade.aud_fx_rate == null) {
    throw new Error(`Trade ${trade.id} (${trade.ticker}) is ${trade.currency} but has no fx rate`);
  }
  return localPerUnit * trade.aud_fx_rate;
}

interface PerSecurityState {
  parcels: CgtParcel[];
}

export function computeCgtForFy(fyId: number): CgtResult {
  const fy = financialYearsRepo.findById(fyId);
  if (!fy) throw new Error(`Financial year ${fyId} not found`);

  // All trades, sorted by date for deterministic FIFO ordering.
  const trades = [...shareTradesRepo.listAll()].sort((a, b) => {
    if (a.trade_date === b.trade_date) return a.id - b.id;
    return a.trade_date < b.trade_date ? -1 : 1;
  });

  const bySecurity = new Map<number, PerSecurityState>();
  const events: CgtEvent[] = [];
  const orphans: OrphanSell[] = [];

  for (const t of trades) {
    let state = bySecurity.get(t.security_id);
    if (!state) {
      state = { parcels: [] };
      bySecurity.set(t.security_id, state);
    }

    if (t.side === 'buy' || t.is_opening) {
      const cb = tradeAudCostBasePerUnit(t);
      state.parcels.push({
        units: t.units,
        cost_base_per_unit_aud_cents: cb,
        acquired_date: t.trade_date,
        source_trade_id: t.id,
      });
      continue;
    }

    // Sell: consume FIFO.
    let remaining = t.units;
    const proceedsPerUnit = tradeProceedsPerUnitAud(t);

    while (remaining > 0 && state.parcels.length > 0) {
      const parcel = state.parcels[0];
      if (!parcel) break;
      const consumed = Math.min(parcel.units, remaining);
      const proceeds = proceedsPerUnit * consumed;
      const costBase = parcel.cost_base_per_unit_aud_cents * consumed;
      const gain = proceeds - costBase;
      const heldDays = diffDays(parcel.acquired_date, t.trade_date);
      const eligible = heldDays >= TWELVE_MONTHS_DAYS;

      events.push({
        sell_trade_id: t.id,
        ticker: t.ticker,
        security_name: t.security_name,
        sell_date: t.trade_date,
        acquired_date: parcel.acquired_date,
        units: consumed,
        proceeds_aud_cents: Math.round(proceeds),
        cost_base_aud_cents: Math.round(costBase),
        gain_aud_cents: Math.round(gain),
        held_days: heldDays,
        discount_eligible: eligible,
      });

      parcel.units -= consumed;
      remaining -= consumed;
      if (parcel.units <= 1e-9) state.parcels.shift();
    }

    if (remaining > 1e-6) {
      orphans.push({
        sell_trade_id: t.id,
        ticker: t.ticker,
        sell_date: t.trade_date,
        units_unmatched: remaining,
        reason: `Sold ${remaining} unmatched units of ${t.ticker} on ${t.trade_date} ` +
          `with no prior buy or opening parcel. Add an opening parcel to fix.`,
      });
      console.warn(`[cgt] orphan sell: ${t.ticker} ${t.trade_date} units=${remaining}`);
    }
  }

  // Filter to events whose sell_date is in the requested FY.
  const fyEvents = events.filter((e) => e.sell_date >= fy.start_date && e.sell_date <= fy.end_date);
  const fyOrphans = orphans.filter((o) => o.sell_date >= fy.start_date && o.sell_date <= fy.end_date);

  let gainEligible = 0;
  let gainIneligible = 0;
  let totalLoss = 0;
  let totalGain = 0;
  for (const e of fyEvents) {
    if (e.gain_aud_cents > 0) {
      totalGain += e.gain_aud_cents;
      if (e.discount_eligible) gainEligible += e.gain_aud_cents;
      else gainIneligible += e.gain_aud_cents;
    } else if (e.gain_aud_cents < 0) {
      totalLoss += -e.gain_aud_cents;
    }
  }

  // Apply losses to ineligible first, then eligible. Halve the surviving eligible portion.
  let lossesLeft = totalLoss;
  const ineligibleAfter = Math.max(0, gainIneligible - lossesLeft);
  lossesLeft = Math.max(0, lossesLeft - gainIneligible);
  const eligibleAfter = Math.max(0, gainEligible - lossesLeft);
  lossesLeft = Math.max(0, lossesLeft - gainEligible);
  const lossCarryforward = lossesLeft;

  const netGain = ineligibleAfter + eligibleAfter;
  const discountedNetGain = ineligibleAfter + Math.round(eligibleAfter * 0.5);

  return {
    fy,
    events: fyEvents,
    totalGainCents: totalGain,
    totalLossCents: totalLoss,
    netGainCents: netGain,
    discountedNetGainCents: discountedNetGain,
    loss_carryforward_cents: lossCarryforward,
    orphans: fyOrphans,
  };
}