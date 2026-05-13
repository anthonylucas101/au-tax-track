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
  // 2026-27 Budget Reform fields
  is_new_build: number;                        // 0 | 1
  contract_date: string | null;                // binding contract date (for grandfathering pre-settlement)
  cgt_method_choice: 'discount' | 'indexation' | null; // new-build only: choose between 50% discount or indexation
  value_at_commencement_cents: number | null;  // property value at 1 Jul 2027 (for transitional CGT split)
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
  is_new_build?: number;
  contract_date?: string | null;
  cgt_method_choice?: 'discount' | 'indexation' | null;
  value_at_commencement_cents?: number | null;
}

const COLS = `id, address, ownership_percent, acquired_date, acquisition_cost_cents,
              sold_date, sale_proceeds_cents, selling_costs_cents, notes,
              is_new_build, contract_date, cgt_method_choice, value_at_commencement_cents`;

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

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export const propertiesRepo = {
  findAll(): Property[] {
    return listStmt.all();
  },

  findById(id: number): Property | undefined {
    return findByIdStmt.get(id) ?? undefined;
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

    const address        = input.address ?? current.address;
    const ownershipPct   = input.ownership_percent ?? current.ownership_percent;
    const acquiredDate   = hasOwn(input, 'acquired_date')   ? input.acquired_date   : current.acquired_date;
    const acquisitionCost = hasOwn(input, 'acquisition_cost_cents') ? input.acquisition_cost_cents : current.acquisition_cost_cents;
    const soldDate       = hasOwn(input, 'sold_date')       ? input.sold_date       : current.sold_date;
    const saleProceeds   = hasOwn(input, 'sale_proceeds_cents') ? input.sale_proceeds_cents : current.sale_proceeds_cents;
    const sellingCosts   = input.selling_costs_cents ?? current.selling_costs_cents;
    const notes          = hasOwn(input, 'notes')           ? input.notes           : current.notes;
    const isNewBuild     = input.is_new_build ?? current.is_new_build;
    const contractDate   = hasOwn(input, 'contract_date')   ? input.contract_date   : current.contract_date;
    const cgtMethod      = hasOwn(input, 'cgt_method_choice') ? input.cgt_method_choice : current.cgt_method_choice;
    const valueAtComm    = hasOwn(input, 'value_at_commencement_cents') ? input.value_at_commencement_cents : current.value_at_commencement_cents;

    db.prepare(
      `UPDATE properties SET
         address = ?, ownership_percent = ?, acquired_date = ?, acquisition_cost_cents = ?,
         sold_date = ?, sale_proceeds_cents = ?, selling_costs_cents = ?, notes = ?,
         is_new_build = ?, contract_date = ?, cgt_method_choice = ?, value_at_commencement_cents = ?
       WHERE id = ?`,
    ).run(
      address, ownershipPct, acquiredDate ?? null, acquisitionCost ?? null,
      soldDate ?? null, saleProceeds ?? null, sellingCosts, notes ?? null,
      isNewBuild, contractDate ?? null, cgtMethod ?? null, valueAtComm ?? null,
      id,
    );

    return findByIdStmt.get(id);
  },

  delete(id: number): boolean {
    return deleteStmt.run(id).changes > 0;
  },
};
