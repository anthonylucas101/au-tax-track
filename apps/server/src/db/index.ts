import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedCpiData } from './cpiSeed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up from this file to find the workspace root (marker: a package.json with "workspaces").
function findRepoRoot(start: string): string {
  let dir = start;
  while (true) {
    const pkg = resolve(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
        if (json.workspaces) return dir;
      } catch {
        // fall through and keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // No workspace root found — fall back to cwd.
      return process.cwd();
    }
    dir = parent;
  }
}

const REPO_ROOT = process.env.ACCOUNTING_REPO_ROOT ?? findRepoRoot(__dirname);
const DB_PATH = process.env.ACCOUNTING_DB_PATH ?? resolve(REPO_ROOT, 'data', 'accounting.db');
const SCHEMA_PATH = resolve(__dirname, 'schema.sql');

function ensureDataDir(): void {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function applySchema(database: Database.Database): void {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  database.exec(schema);
}

// ALTER TABLE migrations for columns added after initial schema creation.
// SQLite has no ADD COLUMN IF NOT EXISTS, so we check PRAGMA table_info first.
// Safe to run on every startup — skips columns that already exist.
interface ColumnMigration {
  table: string;
  column: string;
  definition: string; // everything after the column name in ALTER TABLE ADD COLUMN
}

const COLUMN_MIGRATIONS: ColumnMigration[] = [
  { table: 'properties',    column: 'ownership_percent',            definition: 'REAL    NOT NULL DEFAULT 100' },
  { table: 'properties',    column: 'sold_date',                    definition: 'TEXT' },
  { table: 'properties',    column: 'sale_proceeds_cents',          definition: 'INTEGER' },
  { table: 'properties',    column: 'selling_costs_cents',          definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'hecs_settings', column: 'has_phi',                      definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'hecs_settings', column: 'salary_sacrifice_super_cents', definition: 'INTEGER NOT NULL DEFAULT 0' },
  // 2026-27 Budget Reform columns
  { table: 'properties',    column: 'is_new_build',                 definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'properties',    column: 'contract_date',                definition: 'TEXT' },
  { table: 'properties',    column: 'cgt_method_choice',            definition: "TEXT CHECK(cgt_method_choice IN ('discount','indexation'))" },
  { table: 'properties',    column: 'value_at_commencement_cents',  definition: 'INTEGER' },
  { table: 'securities',    column: 'value_at_commencement_cents',  definition: 'INTEGER' },
  { table: 'hecs_settings', column: 'received_income_support',      definition: 'INTEGER NOT NULL DEFAULT 0' },
];

function runMigrations(database: Database.Database): void {
  for (const m of COLUMN_MIGRATIONS) {
    const cols = database.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === m.column)) {
      database.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.definition}`);
      console.log(`[migration] Added ${m.table}.${m.column}`);
    }
  }
}

ensureDataDir();
export const db: Database.Database = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
applySchema(db);
runMigrations(db);
seedCpiData(db);

export function getDbPath(): string {
  return DB_PATH;
}
