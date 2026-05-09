import { db } from '../index.js';
import { EXPENSE_CATEGORIES, isIncomeCategory } from '../../lib/rentalCategories.js';

export interface RentalTransaction {
  id: number;
  property_id: number;
  fy_id: number;
  tx_date: string;
  category: string;
  amount_cents: number;
  notes: string | null;
}

export interface RentalTransactionInput {
  property_id: number;
  fy_id: number;
  tx_date: string;
  category: string;
  amount_cents: number;
  notes?: string | null;
}

export interface CategoryTotals {
  income_cents: number;
  expense_cents: number;
  by_category: Record<string, number>;
}

const listStmt = db.prepare<[number, number], RentalTransaction>(
  `SELECT id, property_id, fy_id, tx_date, category, amount_cents, notes
     FROM rental_transactions
    WHERE property_id = ? AND fy_id = ?
    ORDER BY tx_date ASC, id ASC`,
);

const findByIdStmt = db.prepare<[number], RentalTransaction>(
  `SELECT id, property_id, fy_id, tx_date, category, amount_cents, notes
     FROM rental_transactions WHERE id = ?`,
);

const insertStmt = db.prepare(
  `INSERT INTO rental_transactions (property_id, fy_id, tx_date, category, amount_cents, notes)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

const deleteStmt = db.prepare(`DELETE FROM rental_transactions WHERE id = ?`);

const totalsByFyStmt = db.prepare<[number, number], { category: string; amount_cents: number }>(
  `SELECT category, SUM(amount_cents) AS amount_cents
     FROM rental_transactions
    WHERE property_id = ? AND fy_id = ?
    GROUP BY category`,
);

export const rentalTransactionsRepo = {
  listByPropertyAndFy(propertyId: number, fyId: number): RentalTransaction[] {
    return listStmt.all(propertyId, fyId);
  },

  create(input: RentalTransactionInput): RentalTransaction {
    const result = insertStmt.run(
      input.property_id,
      input.fy_id,
      input.tx_date,
      input.category,
      input.amount_cents,
      input.notes ?? null,
    );
    const row = findByIdStmt.get(Number(result.lastInsertRowid));
    if (!row) throw new Error('Insert succeeded but row not found');
    return row;
  },

  delete(id: number): boolean {
    const info = deleteStmt.run(id);
    return info.changes > 0;
  },

  totalsByPropertyAndFy(propertyId: number, fyId: number): CategoryTotals {
    const rows = totalsByFyStmt.all(propertyId, fyId);
    let income = 0;
    let expense = 0;
    const by_category: Record<string, number> = {};

    for (const row of rows) {
      by_category[row.category] = row.amount_cents;
      if (isIncomeCategory(row.category)) {
        income += row.amount_cents;
      } else {
        expense += row.amount_cents;
      }
    }

    // Ensure all expense categories appear (as 0) for consistent UI
    for (const cat of EXPENSE_CATEGORIES) {
      if (!(cat in by_category)) by_category[cat] = 0;
    }

    return { income_cents: income, expense_cents: expense, by_category };
  },
};
