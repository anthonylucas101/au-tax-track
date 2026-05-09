import { db } from '../index.js';

export interface Property {
  id: number;
  address: string;
  ownership_percent: number;
  acquired_date: string | null;
  acquisition_cost_cents: number | null;
  sold_date: string | null;
  sale_proceeds_cents: number | null;
  selling_costs_cents: number;
  notes: string | null;
}

export interface PropertyInput {
  address: string;
  ownership_percent?: number;
  acquired_date?: string | null;
  acquisition_cost_cents?: number | null;
  notes?: string | null;
}

export interface PropertyUpdate {
  address?: string;
  ownership_percent?: number;
  acquired_date?: string | null;
  acquisition_cost_cents?: number | null;
  sold_date?: string | null;
  sale_proceeds_cents?: number | null;
  selling_costs_cents?: number;
  notes?: string | null;
}

const COLS = `id, address, ownership_percent, acquired_date, acquisition_cost_cents,
              sold_date, sale_proceeds_cents, selling_costs_cents, notes`;

const listStmt = db.prepare<[], Property>(
  `SELECT ${COLS} FROM properties ORDER BY address ASC`,
);

const findByIdStmt = db.prepare<[number], Property>(
  `SELECT ${COLS} FROM properties WHERE id = ?`,
);

const insertStmt = db.prepare(
  `INSERT INTO properties (address, ownership_percent, acquired_date, acquisition_cost_cents, notes)
   VALUES (?, ?, ?, ?, ?)`,
);

const deleteStmt = db.prepare(`DELETE FROM properties WHERE id = ?`);

export const propertiesRepo = {
  findAll(): Property[] {
    return listStmt.all();
  },

  findById(id: number): Property | undefined {
    return findByIdStmt.get(id);
  },

  create(input: PropertyInput): Property {
    const result = insertStmt.run(
      input.address,
      input.ownership_percent ?? 100,
      input.acquired_date ?? null,
      input.acquisition_cost_cents ?? null,
      input.notes ?? null,
    );
    const row = findByIdStmt.get(Number(result.lastInsertRowid));
    if (!row) throw new Error('Insert succeeded but row not found');
    return row;
  },

  update(id: number, input: PropertyUpdate): Property | undefined {
    const current = findByIdStmt.get(id);
    if (!current) return undefined;

    const address = input.address ?? current.address;
    const ownershipPercent = input.ownership_percent ?? current.ownership_percent;
    const acquiredDate = Object.prototype.hasOwnProperty.call(input, 'acquired_date')
      ? input.acquired_date
      : current.acquired_date;
    const acquisitionCost = Object.prototype.hasOwnProperty.call(input, 'acquisition_cost_cents')
      ? input.acquisition_cost_cents
      : current.acquisition_cost_cents;
    const soldDate = Object.prototype.hasOwnProperty.call(input, 'sold_date')
      ? input.sold_date
      : current.sold_date;
    const saleProceeds = Object.prototype.hasOwnProperty.call(input, 'sale_proceeds_cents')
      ? input.sale_proceeds_cents
      : current.sale_proceeds_cents;
    const sellingCosts = input.selling_costs_cents ?? current.selling_costs_cents;
    const notes = Object.prototype.hasOwnProperty.call(input, 'notes')
      ? input.notes
      : current.notes;

    db.prepare(
      `UPDATE properties SET
         address = ?, ownership_percent = ?, acquired_date = ?, acquisition_cost_cents = ?,
         sold_date = ?, sale_proceeds_cents = ?, selling_costs_cents = ?, notes = ?
       WHERE id = ?`,
    ).run(address, ownershipPercent, acquiredDate ?? null, acquisitionCost ?? null,
          soldDate ?? null, saleProceeds ?? null, sellingCosts, notes ?? null, id);

    return findByIdStmt.get(id);
  },

  delete(id: number): boolean {
    const info = deleteStmt.run(id);
    return info.changes > 0;
  },
};
