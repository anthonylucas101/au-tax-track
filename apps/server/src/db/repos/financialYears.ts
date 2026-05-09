import { db } from '../index.js';

export interface FinancialYear {
  id: number;
  label: string;
  start_date: string;
  end_date: string;
}

const listStmt = db.prepare<[], FinancialYear>(
  `SELECT id, label, start_date, end_date FROM financial_years ORDER BY start_date ASC`,
);

const findByIdStmt = db.prepare<[number], FinancialYear>(
  `SELECT id, label, start_date, end_date FROM financial_years WHERE id = ?`,
);

const findByDateStmt = db.prepare<[string], FinancialYear>(
  `SELECT id, label, start_date, end_date
     FROM financial_years
    WHERE ? BETWEEN start_date AND end_date`,
);

export const financialYearsRepo = {
  list(): FinancialYear[] {
    return listStmt.all();
  },
  findById(id: number): FinancialYear | undefined {
    return findByIdStmt.get(id);
  },
  /** Find FY containing the given ISO date (YYYY-MM-DD). */
  findByDate(isoDate: string): FinancialYear | undefined {
    return findByDateStmt.get(isoDate);
  },
};