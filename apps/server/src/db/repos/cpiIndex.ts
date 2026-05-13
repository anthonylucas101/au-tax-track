import { db } from '../index.js';

export interface CpiRecord {
  quarter: string;     // 'YYYY-QN' e.g. '2027-Q3'
  index_value: number; // ABS All Groups Australia (2011-12 = 100)
  notes: string | null;
}

const getStmt = db.prepare<[string], CpiRecord>(
  `SELECT quarter, index_value, notes FROM cpi_index WHERE quarter = ?`,
);

const listStmt = db.prepare<[], CpiRecord>(
  `SELECT quarter, index_value, notes FROM cpi_index ORDER BY quarter ASC`,
);

const upsertStmt = db.prepare(
  `INSERT INTO cpi_index (quarter, index_value, notes) VALUES (?, ?, ?)
   ON CONFLICT(quarter) DO UPDATE SET index_value = excluded.index_value, notes = excluded.notes`,
);

export const cpiIndexRepo = {
  get(quarter: string): CpiRecord | undefined {
    return getStmt.get(quarter) ?? undefined;
  },

  list(): CpiRecord[] {
    return listStmt.all();
  },

  upsert(quarter: string, index_value: number, notes?: string): void {
    upsertStmt.run(quarter, index_value, notes ?? null);
  },
};
