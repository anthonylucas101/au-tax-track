import { db } from '../index.js';

export interface CryptoAsset {
  id: number;
  symbol: string;
  name: string | null;
}

const findBySymbolStmt = db.prepare<[string], CryptoAsset>(
  `SELECT id, symbol, name FROM crypto_assets WHERE symbol = ?`,
);

const findByIdStmt = db.prepare<[number], CryptoAsset>(
  `SELECT id, symbol, name FROM crypto_assets WHERE id = ?`,
);

const insertStmt = db.prepare(
  `INSERT OR IGNORE INTO crypto_assets (symbol, name) VALUES (?, ?)`,
);

export const cryptoAssetsRepo = {
  findBySymbol(symbol: string): CryptoAsset | undefined {
    return findBySymbolStmt.get(symbol) ?? undefined;
  },

  upsert(symbol: string, name: string | null): CryptoAsset {
    const existing = findBySymbolStmt.get(symbol);
    if (existing) return existing;
    const result = insertStmt.run(symbol, name);
    const row = findByIdStmt.get(Number(result.lastInsertRowid));
    if (!row) throw new Error(`Failed to find crypto_asset after insert: ${symbol}`);
    return row;
  },
};
