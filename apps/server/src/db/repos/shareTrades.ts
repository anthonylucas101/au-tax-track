import { db } from '../index.js';

export interface ShareTrade {
  id: number;
  security_id: number;
  fy_id: number;
  trade_date: string;
  settlement_date: string | null;
  side: 'buy' | 'sell';
  units: number;
  price_cents: number;
  brokerage_cents: number;
  gst_cents: number;
  currency: string;
  aud_fx_rate: number | null;
  external_id: string | null;
  is_opening: number;
  notes: string | null;
}

export interface ShareTradeWithSecurity extends ShareTrade {
  ticker: string;
  security_name: string | null;
  exchange: string | null;
}

export interface ShareTradeInput {
  security_id: number;
  fy_id: number;
  trade_date: string;
  settlement_date: string | null;
  side: 'buy' | 'sell';
  units: number;
  price_cents: number;
  brokerage_cents: number;
  gst_cents: number;
  currency: string;
  aud_fx_rate: number | null;
  external_id: string | null;
  is_opening: number;
  notes: string | null;
}

const insertStmt = db.prepare(
  `INSERT INTO share_trades (
      security_id, fy_id, trade_date, settlement_date, side, units,
      price_cents, brokerage_cents, gst_cents, currency, aud_fx_rate,
      external_id, is_opening, notes
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const findByIdStmt = db.prepare<[number], ShareTrade>(
  `SELECT id, security_id, fy_id, trade_date, settlement_date, side, units,
          price_cents, brokerage_cents, gst_cents, currency, aud_fx_rate,
          external_id, is_opening, notes
     FROM share_trades WHERE id = ?`,
);

const findByExternalStmt = db.prepare<[string], ShareTrade>(
  `SELECT id, security_id, fy_id, trade_date, settlement_date, side, units,
          price_cents, brokerage_cents, gst_cents, currency, aud_fx_rate,
          external_id, is_opening, notes
     FROM share_trades WHERE external_id = ?`,
);

const SELECT_WITH_SEC = `
  SELECT t.id, t.security_id, t.fy_id, t.trade_date, t.settlement_date, t.side,
         t.units, t.price_cents, t.brokerage_cents, t.gst_cents, t.currency,
         t.aud_fx_rate, t.external_id, t.is_opening, t.notes,
         s.ticker, s.name AS security_name, s.exchange
    FROM share_trades t
    JOIN securities s ON s.id = t.security_id`;

const listByFyStmt = db.prepare<[number], ShareTradeWithSecurity>(
  `${SELECT_WITH_SEC} WHERE t.fy_id = ? ORDER BY t.trade_date ASC, t.id ASC`,
);

const listAllStmt = db.prepare<[], ShareTradeWithSecurity>(
  `${SELECT_WITH_SEC} ORDER BY t.trade_date ASC, t.id ASC`,
);

const deleteStmt = db.prepare(`DELETE FROM share_trades WHERE id = ?`);

export const shareTradesRepo = {
  insert(input: ShareTradeInput): ShareTrade {
    const result = insertStmt.run(
      input.security_id,
      input.fy_id,
      input.trade_date,
      input.settlement_date,
      input.side,
      input.units,
      input.price_cents,
      input.brokerage_cents,
      input.gst_cents,
      input.currency,
      input.aud_fx_rate,
      input.external_id,
      input.is_opening,
      input.notes,
    );
    const row = findByIdStmt.get(Number(result.lastInsertRowid));
    if (!row) throw new Error('Insert returned no row');
    return row;
  },
  findByExternalId(externalId: string): ShareTrade | undefined {
    return findByExternalStmt.get(externalId);
  },
  listByFy(fyId: number): ShareTradeWithSecurity[] {
    return listByFyStmt.all(fyId);
  },
  listAll(): ShareTradeWithSecurity[] {
    return listAllStmt.all();
  },
  delete(id: number): boolean {
    return deleteStmt.run(id).changes > 0;
  },
};