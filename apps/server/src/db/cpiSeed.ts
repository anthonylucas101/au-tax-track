// Standalone CPI seed — accepts a Database instance so it can be called from db/index.ts
// without creating a circular dependency with db/repos/cpiIndex.ts.
import type Database from 'better-sqlite3';

// ABS Cat. 6401.0 Table 1 — All Groups, weighted average of eight capital cities (2011-12 = 100).
// Seeded with INSERT OR IGNORE so manually-updated values are never overwritten on restart.
// IMPORTANT: Verify all values against the ABS website before lodging a real tax return.
//            Add new quarters each time ABS publishes the quarterly CPI release.
const ABS_CPI_SEED: [string, number][] = [
  // 2018
  ['2018-Q1', 111.4],
  ['2018-Q2', 112.1],
  ['2018-Q3', 113.1],
  ['2018-Q4', 113.2],
  // 2019
  ['2019-Q1', 113.7],
  ['2019-Q2', 114.4],
  ['2019-Q3', 114.8],
  ['2019-Q4', 114.7],
  // 2020 — Q2 dip due to free childcare policy
  ['2020-Q1', 114.9],
  ['2020-Q2', 113.8],
  ['2020-Q3', 115.1],
  ['2020-Q4', 116.0],
  // 2021
  ['2021-Q1', 117.2],
  ['2021-Q2', 118.8],
  ['2021-Q3', 120.2],
  ['2021-Q4', 121.3],
  // 2022 — inflation surge
  ['2022-Q1', 124.6],
  ['2022-Q2', 127.7],
  ['2022-Q3', 130.8],
  ['2022-Q4', 132.6],
  // 2023
  ['2023-Q1', 135.3],
  ['2023-Q2', 136.1],
  ['2023-Q3', 137.0],
  ['2023-Q4', 137.4],
  // 2024
  ['2024-Q1', 138.5],
  ['2024-Q2', 139.2],
  ['2024-Q3', 140.0],
  ['2024-Q4', 140.9],
  // 2025 — approximate; verify against ABS before use
  ['2025-Q1', 142.0],
  ['2025-Q2', 142.8],
  // 2025 Q3, Q4 and all 2026+ quarters must be added once ABS publishes them
];

export function seedCpiData(database: Database.Database): void {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO cpi_index (quarter, index_value) VALUES (?, ?)`,
  );
  const insertMany = database.transaction(() => {
    for (const [quarter, value] of ABS_CPI_SEED) {
      insert.run(quarter, value);
    }
  });
  insertMany();
}
