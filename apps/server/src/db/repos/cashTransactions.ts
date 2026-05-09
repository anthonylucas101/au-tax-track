import { db } from '../index.js';

export interface CashTransaction {
  id: number;
  fy_id: number;
  tx_date: string;
  description: string;
  debit_cents: number;
  credit_cents: number;
  balance_cents: number | null;
  currency: string;
  category: string | null;
  external_id: string | null;
  notes: string | null;
}

export interface CashTransactionInput {
  fy_id: number;
  tx_date: string;
  description: string;
  debit_cents: number;
  credit_cents: number;
  balance_cents: number | null;
  currency: string;
  category: string | null;
  external_id: string | null;
  notes: string | null;
}

const insertStmt = db.prepare(
  `INSERT INTO cash_transactions (
      fy_id, tx_date, description, debit_cents, credit_cents,
      balance_cents, currency, category, external_id, notes
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const findByIdStmt = db.prepare<[number], CashTransaction>(
  `SELECT id, fy_id, tx_date, description, debit_cents, credit_cents,
          balance_cents, currency, category, external_id, notes
     FROM cash_transactions WHERE id = ?`,
);

const findByExternalStmt = db.prepare<[string], CashTransaction>(
  `SELECT id, fy_id, tx_date, description, debit_cents, credit_cents,
          balance_cents, currency, category, external_id, notes
     FROM cash_transactions WHERE external_id = ?`,
);

const listByFyStmt = db.prepare<[number], CashTransaction>(
  `SELECT id, fy_id, tx_date, description, debit_cents, credit_cents,
          balance_cents, currency, category, external_id, notes
     FROM cash_transactions
    WHERE fy_id = ?
    ORDER BY tx_date ASC, id ASC`,
);

export const cashTransactionsRepo = {
  insert(input: CashTransactionInput): CashTransaction {
    const result = insertStmt.run(
      input.fy_id,
      input.tx_date,
      input.description,
      input.debit_cents,
      input.credit_cents,
      input.balance_cents,
      input.currency,
      input.category,
      input.external_id,
      input.notes,
    );
    const row = findByIdStmt.get(Number(result.lastInsertRowid));
    if (!row) throw new Error('Insert returned no row');
    return row;
  },
  findByExternalId(externalId: string): CashTransaction | undefined {
    return findByExternalStmt.get(externalId);
  },
  listByFy(fyId: number): CashTransaction[] {
    return listByFyStmt.all(fyId);
  },
};