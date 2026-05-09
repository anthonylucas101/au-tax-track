import { db } from '../index.js';

export interface Security {
  id: number;
  ticker: string;
  name: string | null;
  asset_type: 'share' | 'etf';
  currency: string;
  exchange: string | null;
}

const listStmt = db.prepare<[], Security>(
  `SELECT id, ticker, name, asset_type, currency, exchange
     FROM securities ORDER BY ticker ASC`,
);

const findByTickerStmt = db.prepare<[string], Security>(
  `SELECT id, ticker, name, asset_type, currency, exchange
     FROM securities WHERE ticker = ?`,
);

const findByIdStmt = db.prepare<[number], Security>(
  `SELECT id, ticker, name, asset_type, currency, exchange
     FROM securities WHERE id = ?`,
);

const insertStmt = db.prepare(
  `INSERT INTO securities (ticker, name, asset_type, currency, exchange)
   VALUES (?, ?, ?, ?, ?)`,
);

const updateMetaStmt = db.prepare(
  `UPDATE securities SET name = COALESCE(?, name),
                         asset_type = ?,
                         currency = ?,
                         exchange = COALESCE(?, exchange)
    WHERE id = ?`,
);

export interface UpsertSecurityInput {
  ticker: string;
  name: string | null;
  asset_type: 'share' | 'etf';
  currency: string;
  exchange: string | null;
}

export const securitiesRepo = {
  list(): Security[] {
    return listStmt.all();
  },
  findById(id: number): Security | undefined {
    return findByIdStmt.get(id);
  },
  findByTicker(ticker: string): Security | undefined {
    return findByTickerStmt.get(ticker);
  },
  /**
   * Insert if missing, update name/exchange/currency if present. Returns the row.
   */
  upsert(input: UpsertSecurityInput): Security {
    const existing = findByTickerStmt.get(input.ticker);
    if (existing) {
      updateMetaStmt.run(
        input.name,
        input.asset_type,
        input.currency,
        input.exchange,
        existing.id,
      );
      const refreshed = findByIdStmt.get(existing.id);
      if (!refreshed) throw new Error('Upsert failed to find row after update');
      return refreshed;
    }
    const result = insertStmt.run(
      input.ticker,
      input.name,
      input.asset_type,
      input.currency,
      input.exchange,
    );
    const row = findByIdStmt.get(Number(result.lastInsertRowid));
    if (!row) throw new Error('Insert failed to fetch row');
    return row;
  },
};