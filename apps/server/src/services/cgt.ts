// CGT engine: FIFO parcels, three regimes based on the 2026-27 Budget reform.
//
// Regimes (determined by acquired_date and sell_date vs 1 Jul 2027):
//   legacy — both dates before commencement; 50% discount (same as today).
//   split  — acquired before, sold after commencement; pre-slice gets 50% discount,
//             post-slice is CPI-indexed with 30% minimum tax (Phase 3).
//   new    — acquired on/after commencement; CPI-indexed, no discount, 30% minimum tax.
//
// For split events, the value at 1 Jul 2027 is sourced from (in priority order):
//   1. securities.value_at_commencement_cents (user-entered per-unit AUD price).
//   2. ATO apportionment formula: costBase × (proceeds/costBase)^(yearsToCommencement/total).
//   3. Fallback: treat entire gain as legacy (50% discount) and log a warning.
//
// CPI indexation uses cpi_index quarterly data (ABS Cat. 6401.0 All Groups Australia).
// If CPI data is missing for a quarter, indexation is skipped (full nominal gain used)
// and a warning is emitted — add the quarter to cpi_index to enable it.
//
// Loss optimisation: losses reduce non-discounted gains first (legacy ineligible + all
// new-regime nominal), then 50%-eligible gains (legacy + split pre-slice). This maximises
// the value of the 50% discount for the taxpayer.

import { shareTradesRepo, type ShareTradeWithSecurity } from '../db/repos/shareTrades.js';
import { financialYearsRepo, type FinancialYear } from '../db/repos/financialYears.js';
import { convertToAud } from '../lib/money.js';
import {
  classifyCgtRegime,
  type CgtRegime,
  apportionValueAtCommencement,
  REFORM_COMMENCEMENT_DATE,
  COMMENCEMENT_QUARTER,
  cpiQuarterKey,
} from '../lib/budgetReform2027.js';
import { cpiIndexRepo } from '../db/repos/cpiIndex.js';

const ONE_DAY_MS = 86_400_000;
const TWELVE_MONTHS_DAYS = 365;

export interface CgtParcel {
  units: number;
  cost_base_per_unit_aud_cents: number;
  acquired_date: string;
  source_trade_id: number;
  // AUD cents per unit at 1 Jul 2027 (from security override); null = use apportionment
  value_at_commencement_per_unit: number | null;
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
  gain_aud_cents: number;         // total nominal gain (proceeds - cost_base); negative = loss
  held_days: number;
  discount_eligible: boolean;     // held ≥ 12 months (gates both legacy discount and indexation)

  // 2026-27 reform fields
  regime: CgtRegime;

  // Split events only: estimated AUD value of the parcel at 1 Jul 2027.
  value_at_commencement_aud_cents: number;

  // Pre-commencement slice gain (legacy = full gain; split = value@2027 − costBase; new = 0).
  // Eligible for the 50% discount when discount_eligible.
  pre_slice_gain_aud_cents: number;

  // Post-commencement slice: nominal gain (proceeds − value@2027 for split; gain for new; 0 for legacy).
  post_slice_nominal_gain_aud_cents: number;

  // Post-commencement slice: real gain after CPI indexation (≥ 0; 0 if real return ≤ inflation).
  // null when CPI data was unavailable — full nominal used as fallback.
  post_slice_real_gain_aud_cents: number | null;

  // CPI factor applied to the post-slice (null if not indexed or data unavailable).
  cpi_factor: number | null;
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
  totalGainCents: number;
  totalLossCents: number;
  netGainCents: number;
  // Legacy 50%-eligible + ineligible, after losses; same semantics as before for FY ≤ 2026-27.
  discountedNetGainCents: number;
  loss_carryforward_cents: number;
  orphans: OrphanSell[];

  // New-regime (split post-slice + new) real gains after losses and CPI indexation.
  // Added to taxable income in taxEstimate alongside discountedNetGainCents.
  new_regime_net_gain_cents: number;
  // Subset of new_regime_net_gain_cents subject to the 30% minimum tax (Phase 3 uses this).
  min_tax_real_gain_cents: number;
}

function diffDays(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`Invalid date diff ${aIso} ${bIso}`);
  return Math.round((b - a) / ONE_DAY_MS);
}

function tradeAudCostBasePerUnit(trade: ShareTradeWithSecurity): number {
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
  const totalAddOns = trade.brokerage_cents + trade.gst_cents;
  const perUnitAddOn = totalAddOns / Math.max(trade.units, 1e-9);
  const localPerUnit = trade.price_cents - perUnitAddOn;
  if (trade.currency === 'AUD') return localPerUnit;
  if (trade.aud_fx_rate == null) {
    throw new Error(`Trade ${trade.id} (${trade.ticker}) is ${trade.currency} but has no fx rate`);
  }
  return localPerUnit * trade.aud_fx_rate;
}

// Attempt to look up the CPI factor between two dates. Returns null if data is missing.
function tryGetCpiFactor(acqDate: string, dispDate: string): number | null {
  const acqQ = cpiQuarterKey(acqDate);
  const dispQ = cpiQuarterKey(dispDate);
  const acqRec = cpiIndexRepo.get(acqQ);
  const dispRec = cpiIndexRepo.get(dispQ);
  if (!acqRec || !dispRec) {
    const missing = [!acqRec && acqQ, !dispRec && dispQ].filter(Boolean).join(', ');
    console.warn(`[cgt] CPI data missing for quarter(s) ${missing} — skipping indexation for this event`);
    return null;
  }
  return dispRec.index_value / acqRec.index_value;
}

// Compute the post-slice real gain for new/split events.
// Returns the real gain (≥ 0) and the CPI factor used (null if CPI data was unavailable).
function computePostSliceRealGain(
  postSliceNominal: number,
  costBaseForIndexation: number,   // value@2027 for split; original cost_base for new
  indexationBaseDate: string,       // REFORM_COMMENCEMENT_DATE for split; acquired_date for new
  sellDate: string,
  discountEligible: boolean,
): { realGain: number | null; cpiFactor: number | null } {
  if (!discountEligible) {
    // Short-held: full nominal, no indexation
    return { realGain: Math.max(0, postSliceNominal), cpiFactor: null };
  }
  const factor = tryGetCpiFactor(indexationBaseDate, sellDate);
  if (factor === null) {
    // CPI data missing: fall back to full nominal gain (conservative, no inflation relief)
    return { realGain: Math.max(0, postSliceNominal), cpiFactor: null };
  }
  const indexed = Math.round(costBaseForIndexation * factor);
  const realGain = Math.max(0, Math.round(postSliceNominal - (indexed - costBaseForIndexation)));
  return { realGain, cpiFactor: factor };
}

interface PerSecurityState {
  parcels: CgtParcel[];
}

export function computeCgtForFy(fyId: number): CgtResult {
  const fy = financialYearsRepo.findById(fyId);
  if (!fy) throw new Error(`Financial year ${fyId} not found`);

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
        value_at_commencement_per_unit: t.value_at_commencement_cents ?? null,
      });
      continue;
    }

    // Sell: consume FIFO
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
      const discountEligible = heldDays >= TWELVE_MONTHS_DAYS;
      const regime = classifyCgtRegime(parcel.acquired_date, t.trade_date);

      let valueAtCommencement = 0;
      let preSliceGain = 0;
      let postSliceNominal = 0;
      let postSliceReal: number | null = null;
      let cpiFactor: number | null = null;

      if (regime === 'legacy') {
        preSliceGain = Math.round(gain);

      } else if (regime === 'new') {
        postSliceNominal = Math.round(gain);
        if (gain > 0) {
          const r = computePostSliceRealGain(
            postSliceNominal, Math.round(costBase), parcel.acquired_date, t.trade_date, discountEligible,
          );
          postSliceReal = r.realGain;
          cpiFactor = r.cpiFactor;
        } else {
          postSliceReal = 0;
        }

      } else {
        // split: need value@2027 for this parcel
        let vatc: number | null = null;

        // Priority 1: user-entered per-unit price on the security
        if (parcel.value_at_commencement_per_unit !== null) {
          vatc = Math.round(parcel.value_at_commencement_per_unit * consumed);
        }

        // Priority 2: apportionment formula
        if (vatc === null) {
          vatc = apportionValueAtCommencement(
            Math.round(costBase), Math.round(proceeds),
            parcel.acquired_date, t.trade_date,
          );
        }

        // Priority 3: fallback to legacy treatment (full 50% discount)
        if (vatc === null) {
          console.warn(
            `[cgt] Cannot compute value@2027 for parcel ${parcel.source_trade_id} ` +
            `(${t.ticker} ${parcel.acquired_date}→${t.trade_date}); treating as legacy.`,
          );
          vatc = Math.round(proceeds); // treat as if value@2027 == proceeds → post-slice = 0
        }

        valueAtCommencement = vatc;
        preSliceGain = Math.round(vatc - costBase);
        postSliceNominal = Math.round(proceeds - vatc);

        if (postSliceNominal > 0) {
          const r = computePostSliceRealGain(
            postSliceNominal, vatc, REFORM_COMMENCEMENT_DATE, t.trade_date, discountEligible,
          );
          postSliceReal = r.realGain;
          cpiFactor = r.cpiFactor;
        } else {
          postSliceReal = 0;
        }
      }

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
        discount_eligible: discountEligible,
        regime,
        value_at_commencement_aud_cents: valueAtCommencement,
        pre_slice_gain_aud_cents: preSliceGain,
        post_slice_nominal_gain_aud_cents: postSliceNominal,
        post_slice_real_gain_aud_cents: postSliceReal,
        cpi_factor: cpiFactor,
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
        reason:
          `Sold ${remaining} unmatched units of ${t.ticker} on ${t.trade_date} ` +
          `with no prior buy or opening parcel. Add an opening parcel to fix.`,
      });
      console.warn(`[cgt] orphan sell: ${t.ticker} ${t.trade_date} units=${remaining}`);
    }
  }

  // Filter to this FY
  const fyEvents = events.filter((e) => e.sell_date >= fy.start_date && e.sell_date <= fy.end_date);
  const fyOrphans = orphans.filter((o) => o.sell_date >= fy.start_date && o.sell_date <= fy.end_date);

  // ── Aggregate gains into loss-priority buckets ──────────────────────────────
  //
  // Buckets (in loss-reduction priority order, highest to lowest):
  //   ineligible     — non-discounted: legacy short-held + new/split short-held nominal
  //   indexedNominal — new/split long-held nominal (will be CPI-reduced after losses)
  //   indexedReal    — corresponding real gains (CPI already applied per-event)
  //   eligible       — 50%-discounted: legacy long-held + split pre-slice long-held
  //
  // Losses apply to (ineligible + indexedNominal) pool first, then eligible pool.
  // Remaining unabsorbed losses carry forward.

  let ineligible = 0;      // nominal gains, no discount
  let indexedNominal = 0;  // nominal gains, will be indexed
  let indexedReal = 0;     // corresponding real gains (after CPI), ≥ 0
  let eligible = 0;        // nominal gains, 50% discount
  let totalGain = 0;
  let totalLoss = 0;

  for (const e of fyEvents) {
    const g = e.gain_aud_cents;
    if (g > 0) totalGain += g;
    else if (g < 0) totalLoss += -g;

    switch (e.regime) {
      case 'legacy':
        if (g > 0) {
          if (e.discount_eligible) eligible += g;
          else ineligible += g;
        }
        break;

      case 'new':
        if (g > 0) {
          if (e.discount_eligible) {
            indexedNominal += e.post_slice_nominal_gain_aud_cents;
            indexedReal += e.post_slice_real_gain_aud_cents ?? e.post_slice_nominal_gain_aud_cents;
          } else {
            ineligible += g;
          }
        }
        break;

      case 'split':
        if (!e.discount_eligible) {
          // Short-held split: treat total as ineligible
          if (g > 0) ineligible += g;
        } else {
          // Pre-slice contribution
          const pre = e.pre_slice_gain_aud_cents;
          if (pre > 0) eligible += pre;
          else if (pre < 0) totalLoss += -pre; // pre-slice loss treated as capital loss

          // Post-slice contribution
          const postNom = e.post_slice_nominal_gain_aud_cents;
          if (postNom > 0) {
            indexedNominal += postNom;
            indexedReal += e.post_slice_real_gain_aud_cents ?? postNom;
          } else if (postNom < 0) {
            totalLoss += -postNom; // post-slice loss
          }
        }
        break;
    }
  }

  // Apply losses to (ineligible + indexedNominal) first, then eligible
  const nonDiscountedTotal = ineligible + indexedNominal;
  const nonDiscountedAfterLoss = Math.max(0, nonDiscountedTotal - totalLoss);
  let lossesLeft = Math.max(0, totalLoss - nonDiscountedTotal);

  // Proportionally scale the two non-discounted buckets
  const ndRatio = nonDiscountedTotal > 0 ? nonDiscountedAfterLoss / nonDiscountedTotal : 0;
  const ineligibleAfter = Math.round(ineligible * ndRatio);
  const indexedNominalAfter = Math.round(indexedNominal * ndRatio);
  const indexedRealAfter = Math.round(indexedReal * ndRatio);

  // Apply remaining losses to eligible (50%-discount) bucket
  const eligibleAfter = Math.max(0, eligible - lossesLeft);
  const lossCarryforward = Math.max(0, lossesLeft - eligible);

  const netGain = ineligibleAfter + indexedNominalAfter + eligibleAfter;
  const discountedNetGain = ineligibleAfter + Math.round(eligibleAfter * 0.5);
  const newRegimeNetGain = indexedRealAfter;

  return {
    fy,
    events: fyEvents,
    totalGainCents: totalGain,
    totalLossCents: totalLoss,
    netGainCents: netGain,
    discountedNetGainCents: discountedNetGain,
    loss_carryforward_cents: lossCarryforward,
    orphans: fyOrphans,
    new_regime_net_gain_cents: newRegimeNetGain,
    min_tax_real_gain_cents: newRegimeNetGain,
  };
}
