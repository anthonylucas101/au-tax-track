import { Hono } from 'hono';
import { shareTradesRepo, type ShareTradeWithSecurity } from '../db/repos/shareTrades.js';
import { convertToAud } from '../lib/money.js';

export const holdingsRoute = new Hono();

interface Holding {
  security_id: number;
  ticker: string;
  security_name: string | null;
  exchange: string | null;
  units: number;
  cost_base_aud_cents: number;   // average AUD cost base for currently-held units (FIFO)
  buy_count: number;
  sell_count: number;
}

interface Parcel {
  units: number;
  cost_base_per_unit_aud: number;
}

function audCostBasePerUnit(t: ShareTradeWithSecurity): number {
  const totalAddOns = t.brokerage_cents + t.gst_cents;
  const perUnitAddOn = totalAddOns / Math.max(t.units, 1e-9);
  const localPerUnit = t.price_cents + perUnitAddOn;
  if (t.currency === 'AUD') return localPerUnit;
  return convertToAud(Math.round(localPerUnit), t.aud_fx_rate, t.currency);
}

holdingsRoute.get('/', (c) => {
  const trades = [...shareTradesRepo.listAll()].sort((a, b) => {
    if (a.trade_date === b.trade_date) return a.id - b.id;
    return a.trade_date < b.trade_date ? -1 : 1;
  });

  interface State {
    parcels: Parcel[];
    info: { ticker: string; name: string | null; exchange: string | null };
    buys: number;
    sells: number;
  }
  const map = new Map<number, State>();
  for (const t of trades) {
    let s = map.get(t.security_id);
    if (!s) {
      s = {
        parcels: [],
        info: { ticker: t.ticker, name: t.security_name, exchange: t.exchange },
        buys: 0,
        sells: 0,
      };
      map.set(t.security_id, s);
    }
    if (t.side === 'buy' || t.is_opening) {
      s.parcels.push({ units: t.units, cost_base_per_unit_aud: audCostBasePerUnit(t) });
      s.buys += t.is_opening ? 0 : 1;
    } else {
      let remaining = t.units;
      while (remaining > 0 && s.parcels.length > 0) {
        const p = s.parcels[0];
        if (!p) break;
        const take = Math.min(p.units, remaining);
        p.units -= take;
        remaining -= take;
        if (p.units <= 1e-9) s.parcels.shift();
      }
      s.sells += 1;
    }
  }

  const holdings: Holding[] = [];
  for (const [security_id, s] of map.entries()) {
    const units = s.parcels.reduce((acc, p) => acc + p.units, 0);
    const costBase = s.parcels.reduce((acc, p) => acc + p.cost_base_per_unit_aud * p.units, 0);
    if (units < 1e-9 && s.buys === 0 && s.sells === 0) continue;
    holdings.push({
      security_id,
      ticker: s.info.ticker,
      security_name: s.info.name,
      exchange: s.info.exchange,
      units,
      cost_base_aud_cents: Math.round(costBase),
      buy_count: s.buys,
      sell_count: s.sells,
    });
  }
  holdings.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return c.json(holdings);
});