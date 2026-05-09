import { db } from '../index.js';

export interface Payslip {
  id: number;
  employer_id: number;
  fy_id: number;
  pay_date: string;
  gross_cents: number;
  tax_withheld_cents: number;
  super_cents: number;
  allowances_cents: number;
  notes: string | null;
  created_at: string;
}

export interface PayslipWithEmployer extends Payslip {
  employer_name: string;
}

const listByFyStmt = db.prepare<[number], PayslipWithEmployer>(
  `SELECT p.id, p.employer_id, p.fy_id, p.pay_date,
          p.gross_cents, p.tax_withheld_cents, p.super_cents, p.allowances_cents,
          p.notes, p.created_at,
          e.name AS employer_name
     FROM payslips p
     JOIN employers e ON e.id = p.employer_id
    WHERE p.fy_id = ?
    ORDER BY p.pay_date ASC, p.id ASC`,
);

const findByIdStmt = db.prepare<[number], Payslip>(
  `SELECT id, employer_id, fy_id, pay_date,
          gross_cents, tax_withheld_cents, super_cents, allowances_cents,
          notes, created_at
     FROM payslips WHERE id = ?`,
);

const insertStmt = db.prepare(
  `INSERT INTO payslips (
      employer_id, fy_id, pay_date,
      gross_cents, tax_withheld_cents, super_cents, allowances_cents, notes
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

const deleteStmt = db.prepare(`DELETE FROM payslips WHERE id = ?`);

export interface PayslipTotals {
  gross_cents: number;
  tax_withheld_cents: number;
  super_cents: number;
  allowances_cents: number;
  count: number;
}

const totalsStmt = db.prepare<[number], PayslipTotals>(
  `SELECT COALESCE(SUM(gross_cents), 0)        AS gross_cents,
          COALESCE(SUM(tax_withheld_cents), 0) AS tax_withheld_cents,
          COALESCE(SUM(super_cents), 0)        AS super_cents,
          COALESCE(SUM(allowances_cents), 0)   AS allowances_cents,
          COUNT(*)                             AS count
     FROM payslips
    WHERE fy_id = ?`,
);

export interface PayslipInput {
  employer_id: number;
  fy_id: number;
  pay_date: string;
  gross_cents: number;
  tax_withheld_cents: number;
  super_cents: number;
  allowances_cents: number;
  notes: string | null;
}

export const payslipsRepo = {
  listByFy(fyId: number): PayslipWithEmployer[] {
    return listByFyStmt.all(fyId);
  },
  findById(id: number): Payslip | undefined {
    return findByIdStmt.get(id);
  },
  create(input: PayslipInput): Payslip {
    const result = insertStmt.run(
      input.employer_id,
      input.fy_id,
      input.pay_date,
      input.gross_cents,
      input.tax_withheld_cents,
      input.super_cents,
      input.allowances_cents,
      input.notes,
    );
    const row = findByIdStmt.get(Number(result.lastInsertRowid));
    if (!row) throw new Error('Insert succeeded but row not found');
    return row;
  },
  delete(id: number): boolean {
    const info = deleteStmt.run(id);
    return info.changes > 0;
  },
  totalsByFy(fyId: number): PayslipTotals {
    const row = totalsStmt.get(fyId);
    return row ?? { gross_cents: 0, tax_withheld_cents: 0, super_cents: 0, allowances_cents: 0, count: 0 };
  },
};
