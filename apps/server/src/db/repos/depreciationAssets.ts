import { db } from '../index.js';

export interface DepreciationAsset {
  id: number;
  property_id: number;
  description: string;
  cost_cents: number;
  start_date: string;
  method: 'prime_cost' | 'diminishing_value';
  effective_life_years: number;
  notes: string | null;
}

export interface DepreciationAssetInput {
  property_id: number;
  description: string;
  cost_cents: number;
  start_date: string;
  method: 'prime_cost' | 'diminishing_value';
  effective_life_years: number;
  notes?: string | null;
}

const COLS = `id, property_id, description, cost_cents, start_date, method, effective_life_years, notes`;

const listStmt = db.prepare<[number], DepreciationAsset>(
  `SELECT ${COLS} FROM depreciation_assets WHERE property_id = ? ORDER BY start_date ASC, id ASC`,
);

const findByIdStmt = db.prepare<[number], DepreciationAsset>(
  `SELECT ${COLS} FROM depreciation_assets WHERE id = ?`,
);

const listAllForPropertyStmt = db.prepare<[number], DepreciationAsset>(
  `SELECT ${COLS} FROM depreciation_assets WHERE property_id = ? ORDER BY start_date ASC`,
);

const insertStmt = db.prepare(
  `INSERT INTO depreciation_assets (property_id, description, cost_cents, start_date, method, effective_life_years, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

const deleteStmt = db.prepare(`DELETE FROM depreciation_assets WHERE id = ?`);

export const depreciationAssetsRepo = {
  listByProperty(propertyId: number): DepreciationAsset[] {
    return listStmt.all(propertyId);
  },

  listAllForProperty(propertyId: number): DepreciationAsset[] {
    return listAllForPropertyStmt.all(propertyId);
  },

  create(input: DepreciationAssetInput): DepreciationAsset {
    const result = insertStmt.run(
      input.property_id,
      input.description,
      input.cost_cents,
      input.start_date,
      input.method,
      input.effective_life_years,
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
};
