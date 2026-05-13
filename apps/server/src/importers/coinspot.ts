// CoinSpot order history CSV importer.
//
// Expected columns (header row):
//   Transaction Date, Type, Market, Amount, Rate inc. fee, Rate ex. fee,
//   Fee, Fee AUD (inc GST), GST AUD, Total AUD, Total (inc GST)
//
// aud_value_cents storage:
//   buy  → Total AUD × 100  (total paid, includes fee = cost base)
//   sell → Total AUD × 100  (net received after fee = CGT proceeds)
//
// Coin-to-coin swaps (e.g. LUNA2/ARKM):
//   Emits a sell of the base and a buy of the quote at the same AUD value.
//   The quote unit count is parsed from the "Total (inc GST)" column.

import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { dollarsToCents } from '../lib/money.js';
import { financialYearsRepo, type FinancialYear } from '../db/repos/financialYears.js';
import { cryptoAssetsRepo } from '../db/repos/cryptoAssets.js';
import { cryptoTradesRepo } from '../db/repos/cryptoTrades.js';
import { db } from '../db/index.js';

export interface CoinspotImportError {
  file: string;
  row: number;
  message: string;
}

export interface CryptoPreviewTrade {
  source_file: string;
  source_row: number;
  trade_date: string;
  symbol: string;
  side: 'buy' | 'sell';
  units: number;
  aud_value_cents: number;
  fee_cents: number;
  external_id: string;
  duplicate: boolean;
  note: string | null;
}

export interface CoinspotImportPreview {
  filename: string;
  total: number;
  new_count: number;
  duplicate_count: number;
  trades: CryptoPreviewTrade[];
  errors: CoinspotImportError[];
}

export interface CoinspotCommitResult {
  inserted: number;
  skipped_duplicates: number;
  new_assets: number;
}

// ── helpers ────────────────────────────────────────────────────────────────

function sha1Short(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 8);
}

function trimStr(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

// DD/MM/YYYY HH:MM AM/PM → YYYY-MM-DD
function parseCoinspotDate(raw: string): string {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) throw new Error(`Unrecognised date format: "${raw}"`);
  const [, dd, mm, yyyy] = m;
  return `${yyyy!}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`;
}

// Parse a value that may have a trailing currency label, e.g. "16.17 AUD" or "3.72 ARKM"
function parseNumericPart(raw: string): number {
  const cleaned = raw.trim().split(/\s+/)[0] ?? '0';
  return parseFloat(cleaned) || 0;
}

function parseTotalWithCurrency(raw: string): { amount: number; currency: string } {
  const parts = raw.trim().split(/\s+/);
  return {
    amount: parseFloat(parts[0] ?? '0') || 0,
    currency: parts[1] ?? 'AUD',
  };
}

function fyForDateOrThrow(isoDate: string): FinancialYear {
  const fy = financialYearsRepo.findByDate(isoDate);
  if (!fy) throw new Error(`No financial_year covers date ${isoDate}. Seed an extra FY.`);
  return fy;
}

// ── public API ─────────────────────────────────────────────────────────────

export interface InputFile {
  filename: string;
  buffer: Buffer;
}

export function buildCoinspotPreview(files: readonly InputFile[]): CoinspotImportPreview[] {
  return files.map((f) => parseFile(f));
}

function parseFile(f: InputFile): CoinspotImportPreview {
  const errors: CoinspotImportError[] = [];
  const trades: CryptoPreviewTrade[] = [];

  let rows: unknown[][];
  try {
    const wb = XLSX.read(f.buffer, { type: 'buffer', cellDates: false });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('Empty workbook');
    const ws = wb.Sheets[sheetName]!;
    rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
  } catch (err) {
    errors.push({ file: f.filename, row: 0, message: `Could not parse CSV: ${err instanceof Error ? err.message : String(err)}` });
    return { filename: f.filename, total: 0, new_count: 0, duplicate_count: 0, trades: [], errors };
  }

  if (rows.length < 2) {
    return { filename: f.filename, total: 0, new_count: 0, duplicate_count: 0, trades: [], errors };
  }

  const header = (rows[0] ?? []).map((h) => trimStr(h).toLowerCase());

  // Dispatch to the correct parser based on which columns are present
  if (header.includes('coin')) {
    parseSendsReceivesRows(f.filename, rows, header, trades, errors);
  } else {
    parseOrderHistoryRows(f.filename, rows, header, trades, errors);
  }

  const dupCount = trades.filter((t) => t.duplicate).length;
  return {
    filename: f.filename,
    total: trades.length,
    new_count: trades.length - dupCount,
    duplicate_count: dupCount,
    trades,
    errors,
  };
}

// ── Sends & Receives parser ─────────────────────────────────────────────────
// Columns: Transaction Date, Type, Coin, Status, Fee, Amount, Address, Txid, Aud

function parseSendsReceivesRows(
  filename: string,
  rows: unknown[][],
  header: string[],
  trades: CryptoPreviewTrade[],
  errors: CoinspotImportError[],
): void {
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const IDX = {
    date:   col('transaction date'),
    type:   col('type'),
    coin:   col('coin'),
    status: col('status'),
    amount: col('amount'),
    aud:    col('aud'),
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => trimStr(c) === '')) continue;

    try {
      const dateRaw   = trimStr(row[IDX.date]);
      const typeRaw   = trimStr(row[IDX.type]).toLowerCase();
      const coinRaw   = trimStr(row[IDX.coin]).toUpperCase();
      const statusRaw = trimStr(row[IDX.status]).toLowerCase();
      const amountRaw = trimStr(row[IDX.amount]);
      const audRaw    = trimStr(row[IDX.aud]);

      if (statusRaw !== 'complete') continue; // skip pending rows

      const tradeDate = parseCoinspotDate(dateRaw);
      if (typeRaw !== 'receive' && typeRaw !== 'send') throw new Error(`Unknown type: "${typeRaw}"`);
      const side: 'buy' | 'sell' = typeRaw === 'receive' ? 'buy' : 'sell';

      const units = parseFloat(amountRaw);
      if (!Number.isFinite(units) || units <= 0) throw new Error(`Invalid amount: "${amountRaw}"`);

      const audValue = parseFloat(audRaw);
      if (!Number.isFinite(audValue) || audValue < 0) throw new Error(`Invalid AUD: "${audRaw}"`);

      const audValueCents = dollarsToCents(String(audValue));
      const rowSeed = `${dateRaw}|${typeRaw}|${coinRaw}|${amountRaw}|${audRaw}`;
      const extId = `coinspot-sr-${sha1Short(rowSeed)}`;
      const duplicate = cryptoTradesRepo.findByExternalId(extId) != null;

      trades.push({
        source_file: filename,
        source_row: r + 1,
        trade_date: tradeDate,
        symbol: coinRaw,
        side,
        units,
        aud_value_cents: audValueCents,
        fee_cents: 0,
        external_id: extId,
        duplicate,
        note: typeRaw === 'receive' ? 'receive/airdrop/staking' : 'send/withdrawal',
      });
    } catch (err) {
      errors.push({
        file: filename,
        row: r + 1,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── Order History parser ────────────────────────────────────────────────────
// Columns: Transaction Date, Type, Market, Amount, Rate inc. fee, Rate ex. fee,
//          Fee, Fee AUD (inc GST), GST AUD, Total AUD, Total (inc GST)

function parseOrderHistoryRows(
  filename: string,
  rows: unknown[][],
  header: string[],
  trades: CryptoPreviewTrade[],
  errors: CoinspotImportError[],
): void {
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const IDX = {
    date:        col('transaction date'),
    type:        col('type'),
    market:      col('market'),
    amount:      col('amount'),
    feeAud:      col('fee aud (inc gst)'),
    totalAud:    col('total aud'),
    totalIncGst: col('total (inc gst)'),
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => trimStr(c) === '')) continue;

    try {
      const dateRaw   = trimStr(row[IDX.date]);
      const typeRaw   = trimStr(row[IDX.type]).toLowerCase();
      const marketRaw = trimStr(row[IDX.market]);
      const amountRaw = trimStr(row[IDX.amount]);
      const feeAudRaw = trimStr(row[IDX.feeAud]);
      const totalAudRaw = trimStr(row[IDX.totalAud]);
      const totalIncGstRaw = trimStr(row[IDX.totalIncGst]);

      const tradeDate = parseCoinspotDate(dateRaw);
      if (typeRaw !== 'buy' && typeRaw !== 'sell') throw new Error(`Unknown type: "${typeRaw}"`);
      const side = typeRaw as 'buy' | 'sell';

      const [baseSymbol, quoteSymbol] = marketRaw.split('/');
      if (!baseSymbol || !quoteSymbol) throw new Error(`Unrecognised market: "${marketRaw}"`);

      const units = parseFloat(amountRaw);
      if (!Number.isFinite(units) || units <= 0) throw new Error(`Invalid amount: "${amountRaw}"`);

      const totalAud = parseFloat(totalAudRaw);
      if (!Number.isFinite(totalAud)) throw new Error(`Invalid Total AUD: "${totalAudRaw}"`);

      const feeCents = dollarsToCents(String(parseNumericPart(feeAudRaw)));
      const audValueCents = dollarsToCents(String(totalAud));
      const rowSeed = `${dateRaw}|${typeRaw}|${marketRaw}|${amountRaw}|${totalAudRaw}`;
      const extId = `coinspot-${sha1Short(rowSeed)}`;

      const isCoinToCoin = quoteSymbol.toUpperCase() !== 'AUD';

      // --- Sell of base currency ---
      const sellDup = cryptoTradesRepo.findByExternalId(extId) != null;
      trades.push({
        source_file: filename,
        source_row: r + 1,
        trade_date: tradeDate,
        symbol: baseSymbol.toUpperCase(),
        side,
        units,
        aud_value_cents: audValueCents,
        fee_cents: feeCents,
        external_id: extId,
        duplicate: sellDup,
        note: isCoinToCoin ? `coin-to-coin: ${marketRaw}` : null,
      });

      // --- Buy of quote currency (coin-to-coin only) ---
      if (isCoinToCoin) {
        const { amount: quoteAmount, currency: quoteCurrency } = parseTotalWithCurrency(totalIncGstRaw);
        if (quoteCurrency.toUpperCase() !== quoteSymbol.toUpperCase()) {
          throw new Error(`Quote currency mismatch: expected ${quoteSymbol}, got ${quoteCurrency}`);
        }
        if (quoteAmount <= 0) throw new Error(`Zero quote amount in Total (inc GST): "${totalIncGstRaw}"`);

        const buyExtId = `coinspot-${sha1Short(rowSeed + '-buy')}`;
        const buyDup = cryptoTradesRepo.findByExternalId(buyExtId) != null;
        trades.push({
          source_file: filename,
          source_row: r + 1,
          trade_date: tradeDate,
          symbol: quoteSymbol.toUpperCase(),
          side: 'buy',
          units: quoteAmount,
          aud_value_cents: audValueCents,
          fee_cents: 0,
          external_id: buyExtId,
          duplicate: buyDup,
          note: `coin-to-coin: ${marketRaw} (received ${quoteSymbol})`,
        });
      }
    } catch (err) {
      errors.push({
        file: filename,
        row: r + 1,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function commitCoinspotImport(previews: CoinspotImportPreview[]): CoinspotCommitResult {
  const result: CoinspotCommitResult = { inserted: 0, skipped_duplicates: 0, new_assets: 0 };

  const tx = db.transaction(() => {
    for (const preview of previews) {
      for (const t of preview.trades) {
        if (cryptoTradesRepo.findByExternalId(t.external_id)) {
          result.skipped_duplicates += 1;
          continue;
        }

        const existingAsset = cryptoAssetsRepo.findBySymbol(t.symbol);
        const asset = cryptoAssetsRepo.upsert(t.symbol, null);
        if (!existingAsset) result.new_assets += 1;

        const fy = fyForDateOrThrow(t.trade_date);
        cryptoTradesRepo.insert({
          asset_id: asset.id,
          fy_id: fy.id,
          trade_date: t.trade_date,
          side: t.side,
          units: t.units,
          aud_value_cents: t.aud_value_cents,
          fee_cents: t.fee_cents,
          notes: t.note,
          external_id: t.external_id,
        });
        result.inserted += 1;
      }
    }
  });

  tx();
  return result;
}
