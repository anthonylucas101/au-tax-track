import { db } from '../index.js';

export interface Dividend {
  id: number;
  security_id: number;
  fy_id: number;
  payment_date: string;
  ex_date: string | null;
  unfranked_cents: number;
  franked_cents: number;
  franking_credits_cents: number;
  withholding_tax_cents: number;
  drp_units: number;
  currency: string;
  aud_fx_rate: number | null;
  dividend_type: string | null;
  external_id: string | null;
  notes: string | null;
}

export interface DividendWithSecurity extends Dividend {
  ticker: string;
  security_name: string | null;
  exchange: string | null;
}

export interface DividendInput {
  security_id: number;
  fy_id: number;
  payment_date: string;
  ex_date: string | null;
  unfranked_cents: number;
  franked_cents: number;
  franking_credits_cents: number;
  withholding_tax_cents: number;
  drp_units: number;
  currency: string;
  aud_fx_rate: number | null;
  dividend_type: string | null;
  external_id: string | null;
  notes: string | null;
}

const insertStmt = db.prepare(
  `INSERT INTO dividends (
      security_id, fy_id, payment_date, ex_date,
      unfranked_cents, franked_cents, franking_credits_cents,
      withholding_tax_cents, drp_units, currency, aud_fx_rate,
      dividend_type, external_id, notes
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const findByIdStmt = db.prepare<[number], Dividend>(
  `SELECT id, security_id, fy_id, payment_date, ex_date,
          unfranked_cents, franked_cents, franking_credits_cents,
          withholding_tax_cents, drp_units, currency, aud_fx_rate,
          dividend_type, external_id, notes
     FROM dividends WHERE id = ?`,
);

const findByExternalStmt = db.prepare<[string], Dividend>(
  `SELECT id, security_id, fy_id, payment_date, ex_date,
          unfranked_cents, franked_cents, franking_credits_cents,
          withholding_tax_cents, drp_units, currency, aud_fx_rate,
          dividend_type, external_id, notes
     FROM dividends WHERE external_id = ?`,
);

const SELECT_WITH_SEC = `
  SELECT d.id, d.security_id, d.fy_id, d.payment_date, d.ex_date,
         d.unfranked_cents, d.franked_cents, d.franking_credits_cents,
         d.withholding_tax_cents, d.drp_units, d.currency, d.aud_fx_rate,
         d.dividend_type, d.external_id, d.notes,
         s.ticker, s.name AS security_name, s.exchange
    FROM dividends d
    JOIN securities s ON s.id = d.security_id`;

const listByFyStmt = db.prepare<[number], DividendWithSecurity>(
  `${SELECT_WITH_SEC} WHERE d.fy_id = ? ORDER BY d.payment_date ASC, d.id ASC`,
);

const deleteStmt = db.prepare(`DELETE FROM dividends WHERE id = ?`);

export const dividendsRepo = {
  insert(input: DividendInput): Dividend {
    const result = insertStmt.run(
      input.security_id,
      input.fy_id,
      input.payment_date,
      input.ex_date,
      input.unfranked_cents,
      input.franked_cents,
      input.franking_credits_cents,
      input.withholding_tax_cents,
      input.drp_units,
      input.currency,
      input.aud_fx_rate,
      input.dividend_type,
      input.external_id,
      input.notes,
    );
    const row = findByIdStmt.get(Number(result.lastInsertRowid));
    if (!row) throw new Error('Insert returned no row');
    return row;
  },
  findByExternalId(externalId: string): Dividend | undefined {
    return findByExternalStmt.get(externalId);
  },
  listByFy(fyId: number): DividendWithSecurity[] {
    return listByFyStmt.all(fyId);
  },
  delete(id: number): boolean {
    return deleteStmt.run(id).changes > 0;
  },
};