import type Database from 'better-sqlite3';

// Source: ATO individual income tax rates for residents, FY 2024-25 & 2025-26. Verify before lodging.

interface BracketSeed {
  threshold_from_cents: number;
  threshold_to_cents: number | null;
  base_tax_cents: number;
  marginal_rate: number;
}

// Tax brackets only defined for FYs where the tax estimate page is relevant.
// Historical FYs are seeded as FY rows only (for CGT trade tracking), without brackets.
const BRACKETS_BY_FY: Record<string, readonly BracketSeed[]> = {
  '2024-25': [
    { threshold_from_cents:         0, threshold_to_cents:  1_820_000, base_tax_cents:        0, marginal_rate: 0.00 },
    { threshold_from_cents: 1_820_000, threshold_to_cents:  4_500_000, base_tax_cents:        0, marginal_rate: 0.16 },
    { threshold_from_cents: 4_500_000, threshold_to_cents: 13_500_000, base_tax_cents:  428_800, marginal_rate: 0.30 },
    { threshold_from_cents:13_500_000, threshold_to_cents: 19_000_000, base_tax_cents:3_128_800, marginal_rate: 0.37 },
    { threshold_from_cents:19_000_000, threshold_to_cents:        null, base_tax_cents:5_163_800, marginal_rate: 0.45 },
  ],
  '2025-26': [
    { threshold_from_cents:         0, threshold_to_cents:  1_820_000, base_tax_cents:        0, marginal_rate: 0.00 },
    { threshold_from_cents: 1_820_000, threshold_to_cents:  4_500_000, base_tax_cents:        0, marginal_rate: 0.16 },
    { threshold_from_cents: 4_500_000, threshold_to_cents: 13_500_000, base_tax_cents:  428_800, marginal_rate: 0.30 },
    { threshold_from_cents:13_500_000, threshold_to_cents: 19_000_000, base_tax_cents:3_128_800, marginal_rate: 0.37 },
    { threshold_from_cents:19_000_000, threshold_to_cents:        null, base_tax_cents:5_163_800, marginal_rate: 0.45 },
  ],
};

const TAX_CONFIG = {
  medicare_levy_rate: 0.02,
  lito_max_cents: 70_000,
  lito_taper1_threshold_cents: 3_750_000,
  lito_taper1_rate: 0.05,
  lito_taper2_threshold_cents: 4_500_000,
  lito_taper2_rate: 0.015,
};

// All FYs seeded — historical ones exist for CGT trade assignment only.
const ALL_FYS = [
  { label: '2019-20', start_date: '2019-07-01', end_date: '2020-06-30' },
  { label: '2020-21', start_date: '2020-07-01', end_date: '2021-06-30' },
  { label: '2021-22', start_date: '2021-07-01', end_date: '2022-06-30' },
  { label: '2022-23', start_date: '2022-07-01', end_date: '2023-06-30' },
  { label: '2023-24', start_date: '2023-07-01', end_date: '2024-06-30' },
  { label: '2024-25', start_date: '2024-07-01', end_date: '2025-06-30' },
  { label: '2025-26', start_date: '2025-07-01', end_date: '2026-06-30' },
] as const;

export function seed(db: Database.Database): void {
  const insertFy = db.prepare(
    `INSERT OR IGNORE INTO financial_years (label, start_date, end_date) VALUES (?, ?, ?)`,
  );
  const getFyId = db.prepare<[string], { id: number }>(
    `SELECT id FROM financial_years WHERE label = ?`,
  );
  const countBrackets = db.prepare<[number], { c: number }>(
    `SELECT COUNT(*) AS c FROM tax_brackets WHERE fy_id = ?`,
  );
  const insertBracket = db.prepare(
    `INSERT INTO tax_brackets (fy_id, threshold_from_cents, threshold_to_cents, base_tax_cents, marginal_rate)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const upsertConfig = db.prepare(
    `INSERT INTO tax_config (
        fy_id, medicare_levy_rate,
        lito_max_cents,
        lito_taper1_threshold_cents, lito_taper1_rate,
        lito_taper2_threshold_cents, lito_taper2_rate
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(fy_id) DO NOTHING`,
  );

  const tx = db.transaction(() => {
    for (const fy of ALL_FYS) {
      insertFy.run(fy.label, fy.start_date, fy.end_date);
      const row = getFyId.get(fy.label);
      if (!row) throw new Error(`Failed to seed FY ${fy.label}`);
      const fyId = row.id;

      const brackets = BRACKETS_BY_FY[fy.label];
      if (brackets) {
        const bracketCount = countBrackets.get(fyId);
        if (!bracketCount || bracketCount.c === 0) {
          for (const b of brackets) {
            insertBracket.run(fyId, b.threshold_from_cents, b.threshold_to_cents, b.base_tax_cents, b.marginal_rate);
          }
        }
        upsertConfig.run(
          fyId,
          TAX_CONFIG.medicare_levy_rate,
          TAX_CONFIG.lito_max_cents,
          TAX_CONFIG.lito_taper1_threshold_cents,
          TAX_CONFIG.lito_taper1_rate,
          TAX_CONFIG.lito_taper2_threshold_cents,
          TAX_CONFIG.lito_taper2_rate,
        );
      }
    }
  });

  tx();
}
