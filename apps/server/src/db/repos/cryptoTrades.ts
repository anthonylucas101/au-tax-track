import { db } from '../index.js';

export interface CryptoTrade {
  id: number;
  asset_id: number;
  fy_id: number;
  trade_date: string;
  side: 'buy' | 'sell';
  units: number;
  aud_value_cents: number;
  fee_cents: number;
  notes: string | null;
  external_id: string | null;
  symbol: string;
}

const listAllStmt = db.prepare<[], CryptoTrade>(
  `SELECT ct.id, ct.asset_id, ct.fy_id, ct.trade_date, ct.side,
          ct.units, ct.aud_value_cents, ct.fee_cents, ct.notes, ct.external_id,
          ca.symbol
   FROM crypto_trades ct
   JOIN crypto_assets ca ON ca.id = ct.asset_id
   ORDER BY ct.trade_date ASC, ct.id ASC`,
);

const listByFyStmt = db.prepare<[number], CryptoTrade>(
  `SELECT ct.id, ct.asset_id, ct.fy_id, ct.trade_date, ct.side,
          ct.units, ct.aud_value_cents, ct.fee_cents, ct.notes, ct.external_id,
          ca.symbol
   FROM crypto_trades ct
   JOIN crypto_assets ca ON ca.id = ct.asset_id
   WHERE ct.fy_id = ?
   ORDER BY ct.trade_date ASC, ct.id ASC`,
);

const findByExternalIdStmt = db.prepare<[string], { id: number }>(
  `SELECT id FROM crypto_trades WHERE external_id = ?`,
);

const insertStmt = db.prepare(
  `INSERT INTO crypto_trades (asset_id, fy_id, trade_date, side, units, aud_value_cents, fee_cents, notes, external_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const deleteStmt = db.prepare<[number], void>(
  `DELETE FROM crypto_trades WHERE id = ?`,
);

export const cryptoTradesRepo = {
  listAll(): CryptoTrade[] {
    return listAllStmt.all();
  },

  listByFy(fyId: number): CryptoTrade[] {
    return listByFyStmt.all(fyId);
  },

  findByExternalId(externalId: string): { id: number } | undefined {
    return findByExternalIdStmt.get(externalId) ?? undefined;
  },

  insert(input: {
    asset_id: number;
    fy_id: number;
    trade_date: string;
    side: 'buy' | 'sell';
    units: number;
    aud_value_cents: number;
    fee_cents: number;
    notes: string | null;
    external_id: string | null;
  }): number {
    const info = insertStmt.run(
      input.asset_id, input.fy_id, input.trade_date,
      input.side, input.units, input.aud_value_cents,
      input.fee_cents, input.notes, input.external_id,
    );
    return info.lastInsertRowid as number;
  },

  delete(id: number): void {
    deleteStmt.run(id);
  },
};
