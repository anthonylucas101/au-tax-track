import { db } from '../index.js';

export interface TaxBracket {
  threshold_from_cents: number;
  threshold_to_cents: number | null;
  base_tax_cents: number;
  marginal_rate: number;
}

export interface TaxConfig {
  fy_id: number;
  medicare_levy_rate: number;
  lito_max_cents: number;
  lito_taper1_threshold_cents: number;
  lito_taper1_rate: number;
  lito_taper2_threshold_cents: number;
  lito_taper2_rate: number;
}

const bracketsStmt = db.prepare<[number], TaxBracket>(
  `SELECT threshold_from_cents, threshold_to_cents, base_tax_cents, marginal_rate
     FROM tax_brackets
    WHERE fy_id = ?
    ORDER BY threshold_from_cents ASC`,
);

const configStmt = db.prepare<[number], TaxConfig>(
  `SELECT fy_id, medicare_levy_rate,
          lito_max_cents,
          lito_taper1_threshold_cents, lito_taper1_rate,
          lito_taper2_threshold_cents, lito_taper2_rate
     FROM tax_config
    WHERE fy_id = ?`,
);

export const taxConfigRepo = {
  bracketsByFy(fyId: number): TaxBracket[] {
    return bracketsStmt.all(fyId);
  },
  configByFy(fyId: number): TaxConfig | undefined {
    return configStmt.get(fyId);
  },
};
