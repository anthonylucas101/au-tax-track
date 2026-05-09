import { db } from '../index.js';

export interface BuildingAllowance {
  id: number;
  property_id: number;
  description: string;
  construction_cost_cents: number;
  completion_date: string;
  rate: number;
  notes: string | null;
}

export interface BuildingAllowanceInput {
  property_id: number;
  description?: string;
  construction_cost_cents: number;
  completion_date: string;
  rate?: number;
  notes?: string | null;
}

const COLS = `id, property_id, description, construction_cost_cents, completion_date, rate, notes`;

const listStmt = db.prepare<[number], BuildingAllowance>(
  `SELECT ${COLS} FROM building_allowances WHERE property_id = ? ORDER BY completion_date ASC, id ASC`,
);

const findByIdStmt = db.prepare<[number], BuildingAllowance>(
  `SELECT ${COLS} FROM building_allowances WHERE id = ?`,
);

const listAllForPropertyStmt = db.prepare<[number], BuildingAllowance>(
  `SELECT ${COLS} FROM building_allowances WHERE property_id = ? ORDER BY completion_date ASC`,
);

const insertStmt = db.prepare(
  `INSERT INTO building_allowances (property_id, description, construction_cost_cents, completion_date, rate, notes)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

const deleteStmt = db.prepare(`DELETE FROM building_allowances WHERE id = ?`);

export const buildingAllowancesRepo = {
  listByProperty(propertyId: number): BuildingAllowance[] {
    return listStmt.all(propertyId);
  },

  listAllForProperty(propertyId: number): BuildingAllowance[] {
    return listAllForPropertyStmt.all(propertyId);
  },

  create(input: BuildingAllowanceInput): BuildingAllowance {
    const result = insertStmt.run(
      input.property_id,
      input.description ?? 'Building allowance',
      input.construction_cost_cents,
      input.completion_date,
      input.rate ?? 0.025,
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
