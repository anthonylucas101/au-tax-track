import { db } from '../index.js';

export interface DeductionRow {
  category: string;
  amount_cents: number;
  notes: string | null;
}

export interface TaxSettings {
  has_hecs: boolean;
  has_phi: boolean;
  salary_sacrifice_super_cents: number;
  received_income_support: boolean; // exempt from 30% CGT minimum tax (Age Pension, JobSeeker, etc.)
}

const upsertStmt = db.prepare<[number, string, number, string | null]>(`
  INSERT INTO deductions (fy_id, category, amount_cents, notes)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(fy_id, category) DO UPDATE SET
    amount_cents = excluded.amount_cents,
    notes        = excluded.notes
`);

const findByFyStmt = db.prepare<[number], DeductionRow>(`
  SELECT category, amount_cents, notes
  FROM deductions
  WHERE fy_id = ?
  ORDER BY category
`);

const totalByFyStmt = db.prepare<[number], { total: number }>(`
  SELECT COALESCE(SUM(amount_cents), 0) AS total
  FROM deductions
  WHERE fy_id = ?
`);

const getSettingsStmt = db.prepare<[number], { enabled: number; has_phi: number; salary_sacrifice_super_cents: number; received_income_support: number }>(`
  SELECT enabled, has_phi, salary_sacrifice_super_cents, received_income_support
  FROM hecs_settings WHERE fy_id = ?
`);

const upsertSettingsStmt = db.prepare<[number, number, number, number, number]>(`
  INSERT INTO hecs_settings (fy_id, enabled, has_phi, salary_sacrifice_super_cents, received_income_support)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(fy_id) DO UPDATE SET
    enabled                      = excluded.enabled,
    has_phi                      = excluded.has_phi,
    salary_sacrifice_super_cents = excluded.salary_sacrifice_super_cents,
    received_income_support      = excluded.received_income_support
`);

export const deductionsRepo = {
  upsert(fyId: number, category: string, amount_cents: number, notes: string | null = null) {
    upsertStmt.run(fyId, category, amount_cents, notes);
  },

  findAllByFy(fyId: number): DeductionRow[] {
    return findByFyStmt.all(fyId);
  },

  totalByFy(fyId: number): number {
    return totalByFyStmt.get(fyId)?.total ?? 0;
  },

  getTaxSettings(fyId: number): TaxSettings {
    const row = getSettingsStmt.get(fyId);
    return {
      has_hecs: (row?.enabled ?? 0) === 1,
      has_phi: (row?.has_phi ?? 0) === 1,
      salary_sacrifice_super_cents: row?.salary_sacrifice_super_cents ?? 0,
      received_income_support: (row?.received_income_support ?? 0) === 1,
    };
  },

  saveTaxSettings(fyId: number, settings: TaxSettings) {
    upsertSettingsStmt.run(
      fyId,
      settings.has_hecs ? 1 : 0,
      settings.has_phi ? 1 : 0,
      settings.salary_sacrifice_super_cents,
      settings.received_income_support ? 1 : 0,
    );
  },

  // Kept for backward-compat with existing calls in taxEstimate.ts
  getHecsEnabled(fyId: number): boolean {
    return this.getTaxSettings(fyId).has_hecs;
  },
};
