// Residential property loss carry-forward (2026-27 Budget Reform).
// Stores the accumulated quarantined rental losses at the END of each FY,
// available to offset restricted-property income in future years.
import { db } from '../index.js';

const getStmt = db.prepare<[number], { amount_cents: number }>(
  `SELECT amount_cents FROM residential_property_loss_carryforward WHERE fy_id = ?`,
);

// Retrieve carry-forward that should be applied INTO the given FY:
// i.e., the amount saved at the end of the FY whose end_date is one day before fyStartDate.
const getPriorStmt = db.prepare<[string], { amount_cents: number }>(
  `SELECT cf.amount_cents
   FROM residential_property_loss_carryforward cf
   JOIN financial_years fy ON fy.id = cf.fy_id
   WHERE fy.end_date = date(?, '-1 day')`,
);

const saveStmt = db.prepare(
  `INSERT INTO residential_property_loss_carryforward (fy_id, amount_cents)
   VALUES (?, ?)
   ON CONFLICT(fy_id) DO UPDATE SET amount_cents = excluded.amount_cents`,
);

export const residentialLossCfRepo = {
  // Amount accumulated at end of a specific FY (0 if no record).
  get(fyId: number): number {
    return getStmt.get(fyId)?.amount_cents ?? 0;
  },

  // Amount to carry INTO the FY that starts on fyStartDate (looks up the preceding FY's record).
  getPriorFyAmount(fyStartDate: string): number {
    return getPriorStmt.get(fyStartDate)?.amount_cents ?? 0;
  },

  // Persist (upsert) the carry-forward remaining at end of fyId.
  save(fyId: number, amount_cents: number): void {
    saveStmt.run(fyId, Math.max(0, amount_cents));
  },
};
