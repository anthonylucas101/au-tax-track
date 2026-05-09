// Stake XLSX importer.
//
// Detects file kind by sheet names and parses each known sheet into normalised
// preview rows. The actual DB inserts happen in commitImport(), inside one
// transaction, so a partial failure rolls everything back.
//
// FX direction note (Stake): the AUD/USD column on USD trades is formatted
// like "$1.538" and represents AUD-per-USD (1 USD = 1.538 AUD). We confirmed
// the direction by checking sample Wall St trades: a 154.51 USD price is far
// closer to ~237 AUD than ~100 AUD, so AUD = USD * rate.

import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { dollarsToCents, parseFxRate, parsePercent } from '../lib/money.js';
import { financialYearsRepo, type FinancialYear } from '../db/repos/financialYears.js';
import { securitiesRepo } from '../db/repos/securities.js';
import { shareTradesRepo } from '../db/repos/shareTrades.js';
import { dividendsRepo } from '../db/repos/dividends.js';
import { cashTransactionsRepo } from '../db/repos/cashTransactions.js';
import { db } from '../db/index.js';

export type StakeFileKind = 'activity' | 'income' | 'cash';

export interface ImportError {
  file: string;
  sheet: string;
  row: number;
  message: string;
}

export interface SheetSummary {
  sheet: string;
  total: number;
  newRows: number;
  duplicate: number;
}

export interface FilePreview {
  filename: string;
  kind: StakeFileKind;
  sheetSummaries: SheetSummary[];
}

export interface PreviewTrade {
  source_file: string;
  source_sheet: string;
  source_row: number;
  trade_date: string;
  settlement_date: string | null;
  ticker: string;
  security_name: string | null;
  asset_type: 'share' | 'etf';
  exchange: string;
  side: 'buy' | 'sell';
  units: number;
  price_cents: number;
  brokerage_cents: number;
  gst_cents: number;
  currency: string;
  aud_fx_rate: number | null;
  external_id: string;
  duplicate: boolean;
  security_will_be_created: boolean;
}

export interface PreviewDividend {
  source_file: string;
  source_sheet: string;
  source_row: number;
  ticker: string;
  security_name: string | null;
  asset_type: 'share' | 'etf';
  exchange: string;
  payment_date: string;
  ex_date: string | null;
  unfranked_cents: number;
  franked_cents: number;
  franking_credits_cents: number;
  withholding_tax_cents: number;
  currency: string;
  aud_fx_rate: number | null;
  dividend_type: string | null;
  external_id: string;
  duplicate: boolean;
  security_will_be_created: boolean;
}

export interface PreviewCash {
  source_file: string;
  source_sheet: string;
  source_row: number;
  tx_date: string;
  description: string;
  debit_cents: number;
  credit_cents: number;
  balance_cents: number | null;
  currency: string;
  category: string;
  external_id: string;
  duplicate: boolean;
}

export interface ImportPreview {
  files: FilePreview[];
  preview: {
    trades: PreviewTrade[];
    dividends: PreviewDividend[];
    cashTransactions: PreviewCash[];
  };
  errors: ImportError[];
}

export interface CommitResult {
  inserted: {
    securities: number;
    trades: number;
    dividends: number;
    cashTransactions: number;
  };
  skippedDuplicates: {
    trades: number;
    dividends: number;
    cashTransactions: number;
  };
}

// ----- helpers ------------------------------------------------------------

function sha1Short(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 8);
}

function sheetRows(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    dateNF: 'yyyy-mm-dd',
    defval: '',
  });
}

function trimStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

// Stake's older exports append exchange suffixes (.ASX, .NYSE, etc) that newer exports omit.
// Strip them so historical buys and current sells resolve to the same security.
function normalizeTicker(raw: string): string {
  return raw.replace(/.(ASX|NYSE|NASDAQ|NZX|LSE|AX)$/i, '').toUpperCase().trim();
}

function asDate(v: unknown): string {
  if (v instanceof Date) {
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, '0');
    const dd = String(v.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const s = trimStr(v);
  if (!s) throw new Error('Missing date');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = m[1] ?? '';
    const mo = m[2] ?? '';
    const y = m[3] ?? '';
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  throw new Error(`Unrecognised date: ${s}`);
}

function fyForDateOrThrow(isoDate: string): FinancialYear {
  const fy = financialYearsRepo.findByDate(isoDate);
  if (!fy) throw new Error(`No financial_year row covers date ${isoDate}. Seed an extra FY?`);
  return fy;
}

export function inferCashCategory(text: string): string {
  const t = text.toLowerCase();
  if (t.startsWith('dividend withholding tax')) return 'withholding_tax';
  if (t.startsWith('dividend ')) return 'dividend';
  if (t.includes('settlement')) return 'settlement';
  if (t.startsWith('withdrawal')) return 'withdrawal';
  if (t.startsWith('deposit')) return 'deposit';
  if (t.includes('fee') || t.includes('brokerage')) return 'fee';
  return 'other';
}

function headerIndex(header: unknown[], wanted: string): number {
  const target = wanted.toLowerCase().trim();
  for (let i = 0; i < header.length; i++) {
    if (trimStr(header[i]).toLowerCase() === target) return i;
  }
  return -1;
}

// ----- detection ----------------------------------------------------------

export function detectKind(sheetNames: readonly string[]): StakeFileKind | null {
  if (sheetNames.includes('Aus Equities') || sheetNames.includes('Wall St Equities')) {
    return 'activity';
  }
  if (sheetNames.includes('Aus Dividends (Estimated)') || sheetNames.includes('Wall St Dividends')) {
    return 'income';
  }
  if (sheetNames.includes('AUD') || sheetNames.includes('USD')) {
    return 'cash';
  }
  return null;
}

// ----- row schemas (post-parse, before insert) ----------------------------

const tradeRowSchema = z.object({
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  settlement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  ticker: z.string().min(1),
  security_name: z.string().nullable(),
  side: z.enum(['buy', 'sell']),
  units: z.number().positive(),
  price_cents: z.number().int().nonnegative(),
  brokerage_cents: z.number().int().nonnegative(),
  gst_cents: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3),
  aud_fx_rate: z.number().positive().nullable(),
  external_id: z.string().min(1),
  asset_type: z.enum(['share', 'etf']),
  exchange: z.string().min(1),
});

const dividendRowSchema = z.object({
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ex_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  ticker: z.string().min(1),
  security_name: z.string().nullable(),
  unfranked_cents: z.number().int().nonnegative(),
  franked_cents: z.number().int().nonnegative(),
  franking_credits_cents: z.number().int().nonnegative(),
  withholding_tax_cents: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3),
  aud_fx_rate: z.number().positive().nullable(),
  dividend_type: z.string().nullable(),
  external_id: z.string().min(1),
  asset_type: z.enum(['share', 'etf']),
  exchange: z.string().min(1),
});

// ----- per-sheet parsers --------------------------------------------------

function inferAssetType(name: string | null, ticker: string): 'share' | 'etf' {
  const n = (name ?? '').toLowerCase();
  if (n.includes('etf') || n.includes('betashares') || n.includes('vanguard')) return 'etf';
  void ticker;
  return 'share';
}

function parseEquities(
  rows: unknown[][],
  sheetName: 'Aus Equities' | 'Wall St Equities',
  filename: string,
  errors: ImportError[],
): PreviewTrade[] {
  if (rows.length < 2) return [];
  const header = rows[0] ?? [];
  const isUS = sheetName === 'Wall St Equities';

  const idx = {
    trade_date: headerIndex(header, 'Trade Date'),
    settlement_date: headerIndex(header, 'Settlement Date'),
    symbol: headerIndex(header, 'Symbol'),
    name: headerIndex(header, 'Name'),
    side: headerIndex(header, 'Side'),
    trade_id: headerIndex(header, 'Trade Identifier'),
    units: headerIndex(header, 'Units'),
    avg_price: headerIndex(header, 'Avg. Price'),
    fees: headerIndex(header, 'Fees'),
    gst: headerIndex(header, 'GST'),
    currency: headerIndex(header, 'Currency'),
    fx: headerIndex(header, 'AUD/USD rate'),
  } as const;

  const out: PreviewTrade[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => trimStr(c) === '')) continue;
    try {
      const ticker = normalizeTicker(trimStr(row[idx.symbol]));
      if (!ticker) continue;
      const sideRaw = trimStr(row[idx.side]).toLowerCase();
      let side: 'buy' | 'sell';
      if (sideRaw === 'buy') side = 'buy';
      else if (sideRaw === 'sell') side = 'sell';
      else throw new Error(`Unknown side "${sideRaw}"`);

      const unitsSigned = Number(trimStr(row[idx.units]));
      if (!Number.isFinite(unitsSigned) || unitsSigned === 0) {
        throw new Error(`Invalid units: ${String(row[idx.units])}`);
      }
      const units = Math.abs(unitsSigned);

      const externalIdRaw = trimStr(row[idx.trade_id]);
      if (!externalIdRaw) throw new Error('Missing Trade Identifier');

      const currency = trimStr(row[idx.currency]) || (isUS ? 'USD' : 'AUD');
      const fxRate = isUS && idx.fx >= 0 ? parseFxRate(trimStr(row[idx.fx])) : null;

      const settlementRaw = idx.settlement_date >= 0 ? trimStr(row[idx.settlement_date]) : '';
      const nameRaw = idx.name >= 0 ? trimStr(row[idx.name]) : '';

      const parsed = tradeRowSchema.parse({
        trade_date: asDate(row[idx.trade_date]),
        settlement_date: settlementRaw === '' ? null : asDate(row[idx.settlement_date]),
        ticker,
        security_name: nameRaw === '' ? null : nameRaw,
        side,
        units,
        price_cents: dollarsToCents(trimStr(row[idx.avg_price])),
        brokerage_cents: dollarsToCents(trimStr(row[idx.fees])),
        gst_cents: dollarsToCents(trimStr(row[idx.gst])),
        currency,
        aud_fx_rate: fxRate,
        external_id: `stake-trade-${externalIdRaw}`,
        asset_type: inferAssetType(nameRaw === '' ? null : nameRaw, ticker),
        exchange: isUS ? 'NASDAQ' : 'ASX',
      });

      const existing = shareTradesRepo.findByExternalId(parsed.external_id);
      const sec = securitiesRepo.findByTicker(parsed.ticker);
      out.push({
        source_file: filename,
        source_sheet: sheetName,
        source_row: r + 1,
        trade_date: parsed.trade_date,
        settlement_date: parsed.settlement_date,
        ticker: parsed.ticker,
        security_name: parsed.security_name,
        asset_type: parsed.asset_type,
        exchange: parsed.exchange,
        side: parsed.side,
        units: parsed.units,
        price_cents: parsed.price_cents,
        brokerage_cents: parsed.brokerage_cents,
        gst_cents: parsed.gst_cents,
        currency: parsed.currency,
        aud_fx_rate: parsed.aud_fx_rate,
        external_id: parsed.external_id,
        duplicate: existing != null,
        security_will_be_created: sec == null,
      });
    } catch (err) {
      errors.push({
        file: filename,
        sheet: sheetName,
        row: r + 1,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

function parseAusDividends(
  rows: unknown[][],
  filename: string,
  errors: ImportError[],
): PreviewDividend[] {
  if (rows.length < 2) return [];
  const header = rows[0] ?? [];
  const idx = {
    ex_date: headerIndex(header, 'Ex-Dividend Date'),
    payment_date: headerIndex(header, 'Payment Date'),
    symbol: headerIndex(header, 'Symbol'),
    name: headerIndex(header, 'Name'),
    type: headerIndex(header, 'Type'),
    units: headerIndex(header, 'Units'),
    div_per_share: headerIndex(header, 'Dividend/Share'),
    total: headerIndex(header, 'Total Amount'),
    unfranked: headerIndex(header, 'Unfranked'),
    franked: headerIndex(header, 'Franked'),
    franking: headerIndex(header, 'Franking Credit'),
  };
  const sheetName = 'Aus Dividends (Estimated)';
  const out: PreviewDividend[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => trimStr(c) === '')) continue;
    try {
      const ticker = normalizeTicker(trimStr(row[idx.symbol]));
      if (!ticker) continue;
      const paymentDate = asDate(row[idx.payment_date]);
      const totalRaw = trimStr(row[idx.total]);
      const dividendTypeRaw = idx.type >= 0 ? trimStr(row[idx.type]) : '';
      const dividendType = dividendTypeRaw === '' ? null : dividendTypeRaw;
      const externalSeed = `${ticker}|${paymentDate}|${dividendType ?? ''}|${totalRaw}`;
      const exDateRaw = idx.ex_date >= 0 ? trimStr(row[idx.ex_date]) : '';
      const nameRaw = idx.name >= 0 ? trimStr(row[idx.name]) : '';

      const parsed = dividendRowSchema.parse({
        payment_date: paymentDate,
        ex_date: exDateRaw === '' ? null : asDate(row[idx.ex_date]),
        ticker,
        security_name: nameRaw === '' ? null : nameRaw,
        unfranked_cents: dollarsToCents(trimStr(row[idx.unfranked])),
        franked_cents: dollarsToCents(trimStr(row[idx.franked])),
        franking_credits_cents: dollarsToCents(trimStr(row[idx.franking])),
        withholding_tax_cents: 0,
        currency: 'AUD',
        aud_fx_rate: null,
        dividend_type: dividendType,
        external_id: `stake-div-${sha1Short(externalSeed)}`,
        asset_type: inferAssetType(nameRaw === '' ? null : nameRaw, ticker),
        exchange: 'ASX',
      });

      const existing = dividendsRepo.findByExternalId(parsed.external_id);
      const sec = securitiesRepo.findByTicker(parsed.ticker);
      out.push({
        source_file: filename,
        source_sheet: sheetName,
        source_row: r + 1,
        ticker: parsed.ticker,
        security_name: parsed.security_name,
        asset_type: parsed.asset_type,
        exchange: parsed.exchange,
        payment_date: parsed.payment_date,
        ex_date: parsed.ex_date,
        unfranked_cents: parsed.unfranked_cents,
        franked_cents: parsed.franked_cents,
        franking_credits_cents: parsed.franking_credits_cents,
        withholding_tax_cents: parsed.withholding_tax_cents,
        currency: parsed.currency,
        aud_fx_rate: parsed.aud_fx_rate,
        dividend_type: parsed.dividend_type,
        external_id: parsed.external_id,
        duplicate: existing != null,
        security_will_be_created: sec == null,
      });
    } catch (err) {
      errors.push({
        file: filename,
        sheet: sheetName,
        row: r + 1,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

function parseUsDividends(
  rows: unknown[][],
  filename: string,
  errors: ImportError[],
): PreviewDividend[] {
  if (rows.length < 2) return [];
  const header = rows[0] ?? [];
  const idx = {
    payment_date: headerIndex(header, 'Payment Date'),
    symbol: headerIndex(header, 'Symbol'),
    name: headerIndex(header, 'Name'),
    type: headerIndex(header, 'Type'),
    total: headerIndex(header, 'Total Amount'),
    rate_pct: headerIndex(header, 'Withholding Rate'),
    tax_withheld: headerIndex(header, 'Tax Withheld'),
    net_amount: headerIndex(header, 'Net Amount'),
    currency: headerIndex(header, 'Currency'),
    fx: headerIndex(header, 'AUD/USD rate'),
  };
  const sheetName = 'Wall St Dividends';
  const out: PreviewDividend[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => trimStr(c) === '')) continue;
    try {
      const ticker = normalizeTicker(trimStr(row[idx.symbol]));
      if (!ticker) continue;
      const paymentDate = asDate(row[idx.payment_date]);
      const totalRaw = trimStr(row[idx.total]);
      const dividendTypeRaw = idx.type >= 0 ? trimStr(row[idx.type]) : '';
      const dividendType = dividendTypeRaw === '' ? null : dividendTypeRaw;
      const externalSeed = `${ticker}|${paymentDate}|${dividendType ?? ''}|${totalRaw}`;
      if (idx.rate_pct >= 0 && trimStr(row[idx.rate_pct]) !== '') {
        parsePercent(trimStr(row[idx.rate_pct]));
      }
      const nameRaw = idx.name >= 0 ? trimStr(row[idx.name]) : '';
      const fxRaw = idx.fx >= 0 ? trimStr(row[idx.fx]) : '';

      const parsed = dividendRowSchema.parse({
        payment_date: paymentDate,
        ex_date: null,
        ticker,
        security_name: nameRaw === '' ? null : nameRaw,
        unfranked_cents: dollarsToCents(totalRaw),
        franked_cents: 0,
        franking_credits_cents: 0,
        withholding_tax_cents: dollarsToCents(trimStr(row[idx.tax_withheld])),
        currency: trimStr(row[idx.currency]) || 'USD',
        aud_fx_rate: fxRaw === '' ? null : parseFxRate(fxRaw),
        dividend_type: dividendType,
        external_id: `stake-div-${sha1Short(externalSeed)}`,
        asset_type: inferAssetType(nameRaw === '' ? null : nameRaw, ticker),
        exchange: 'NASDAQ',
      });

      const existing = dividendsRepo.findByExternalId(parsed.external_id);
      const sec = securitiesRepo.findByTicker(parsed.ticker);
      out.push({
        source_file: filename,
        source_sheet: sheetName,
        source_row: r + 1,
        ticker: parsed.ticker,
        security_name: parsed.security_name,
        asset_type: parsed.asset_type,
        exchange: parsed.exchange,
        payment_date: parsed.payment_date,
        ex_date: parsed.ex_date,
        unfranked_cents: parsed.unfranked_cents,
        franked_cents: parsed.franked_cents,
        franking_credits_cents: parsed.franking_credits_cents,
        withholding_tax_cents: parsed.withholding_tax_cents,
        currency: parsed.currency,
        aud_fx_rate: parsed.aud_fx_rate,
        dividend_type: parsed.dividend_type,
        external_id: parsed.external_id,
        duplicate: existing != null,
        security_will_be_created: sec == null,
      });
    } catch (err) {
      errors.push({
        file: filename,
        sheet: sheetName,
        row: r + 1,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

function parseCash(
  rows: unknown[][],
  sheetName: 'AUD' | 'USD',
  filename: string,
  errors: ImportError[],
): PreviewCash[] {
  if (rows.length < 2) return [];
  const header = rows[0] ?? [];
  const idx = {
    date: headerIndex(header, 'Date'),
    transaction: headerIndex(header, 'Transaction'),
    debit: headerIndex(header, 'Debit'),
    credit: headerIndex(header, 'Credit'),
    balance: headerIndex(header, 'Balance'),
    currency: headerIndex(header, 'Currency'),
  };
  const out: PreviewCash[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => trimStr(c) === '')) continue;
    try {
      const txDate = asDate(row[idx.date]);
      const description = trimStr(row[idx.transaction]);
      const debitRaw = trimStr(row[idx.debit]);
      const creditRaw = trimStr(row[idx.credit]);
      const balanceRaw = idx.balance >= 0 ? trimStr(row[idx.balance]) : '';
      const currency = idx.currency >= 0 ? (trimStr(row[idx.currency]) || sheetName) : sheetName;

      const debitCents = dollarsToCents(debitRaw);
      const creditCents = dollarsToCents(creditRaw);
      const balanceCents = balanceRaw === '' ? null : dollarsToCents(balanceRaw);

      const externalSeed = `${txDate}|${description}|${debitRaw}|${creditRaw}|${currency}`;
      const externalId = `stake-cash-${sha1Short(externalSeed)}`;

      const existing = cashTransactionsRepo.findByExternalId(externalId);
      out.push({
        source_file: filename,
        source_sheet: sheetName,
        source_row: r + 1,
        tx_date: txDate,
        description,
        debit_cents: debitCents,
        credit_cents: creditCents,
        balance_cents: balanceCents,
        currency,
        category: inferCashCategory(description),
        external_id: externalId,
        duplicate: existing != null,
      });
    } catch (err) {
      errors.push({
        file: filename,
        sheet: sheetName,
        row: r + 1,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

// ----- public API ---------------------------------------------------------

export interface InputFile {
  filename: string;
  buffer: Buffer;
}

export function buildPreview(files: readonly InputFile[]): ImportPreview {
  const errors: ImportError[] = [];
  const filePreviews: FilePreview[] = [];
  const trades: PreviewTrade[] = [];
  const dividends: PreviewDividend[] = [];
  const cashTx: PreviewCash[] = [];

  for (const f of files) {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(f.buffer, { cellDates: true });
    } catch (err) {
      errors.push({
        file: f.filename,
        sheet: '(workbook)',
        row: 0,
        message: `Could not read xlsx: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    const kind = detectKind(wb.SheetNames);
    if (!kind) {
      errors.push({
        file: f.filename,
        sheet: '(workbook)',
        row: 0,
        message: `No recognised Stake sheet in [${wb.SheetNames.join(', ')}]`,
      });
      continue;
    }

    const summaries: SheetSummary[] = [];
    const recordSummary = (sheet: string, parsed: ReadonlyArray<{ duplicate: boolean }>): void => {
      const dup = parsed.filter((p) => p.duplicate).length;
      summaries.push({
        sheet,
        total: parsed.length,
        newRows: parsed.length - dup,
        duplicate: dup,
      });
    };

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const rows = sheetRows(ws);

      if (sheetName === 'Aus Equities' || sheetName === 'Wall St Equities') {
        const parsed = parseEquities(rows, sheetName, f.filename, errors);
        trades.push(...parsed);
        recordSummary(sheetName, parsed);
      } else if (sheetName === 'Aus Dividends (Estimated)') {
        const parsed = parseAusDividends(rows, f.filename, errors);
        dividends.push(...parsed);
        recordSummary(sheetName, parsed);
      } else if (sheetName === 'Wall St Dividends') {
        const parsed = parseUsDividends(rows, f.filename, errors);
        dividends.push(...parsed);
        recordSummary(sheetName, parsed);
      } else if (sheetName === 'AUD' || sheetName === 'USD') {
        const parsed = parseCash(rows, sheetName, f.filename, errors);
        cashTx.push(...parsed);
        recordSummary(sheetName, parsed);
      }
    }

    filePreviews.push({ filename: f.filename, kind, sheetSummaries: summaries });
  }

  return {
    files: filePreviews,
    preview: { trades, dividends, cashTransactions: cashTx },
    errors,
  };
}

export function commitImport(preview: ImportPreview): CommitResult {
  const result: CommitResult = {
    inserted: { securities: 0, trades: 0, dividends: 0, cashTransactions: 0 },
    skippedDuplicates: { trades: 0, dividends: 0, cashTransactions: 0 },
  };

  const tx = db.transaction(() => {
    const seenTickers = new Set<string>();
    const upsertSec = (
      ticker: string,
      name: string | null,
      assetType: 'share' | 'etf',
      currency: string,
      exchange: string,
    ): void => {
      if (seenTickers.has(ticker)) return;
      seenTickers.add(ticker);
      const before = securitiesRepo.findByTicker(ticker);
      securitiesRepo.upsert({ ticker, name, asset_type: assetType, currency, exchange });
      if (!before) result.inserted.securities += 1;
    };

    for (const t of preview.preview.trades) {
      upsertSec(t.ticker, t.security_name, t.asset_type, t.currency, t.exchange);
    }
    for (const d of preview.preview.dividends) {
      upsertSec(d.ticker, d.security_name, d.asset_type, d.currency, d.exchange);
    }

    for (const t of preview.preview.trades) {
      if (shareTradesRepo.findByExternalId(t.external_id)) {
        result.skippedDuplicates.trades += 1;
        continue;
      }
      const sec = securitiesRepo.findByTicker(t.ticker);
      if (!sec) throw new Error(`Security ${t.ticker} missing after upsert`);
      const fy = fyForDateOrThrow(t.trade_date);
      shareTradesRepo.insert({
        security_id: sec.id,
        fy_id: fy.id,
        trade_date: t.trade_date,
        settlement_date: t.settlement_date,
        side: t.side,
        units: t.units,
        price_cents: t.price_cents,
        brokerage_cents: t.brokerage_cents,
        gst_cents: t.gst_cents,
        currency: t.currency,
        aud_fx_rate: t.aud_fx_rate,
        external_id: t.external_id,
        is_opening: 0,
        notes: null,
      });
      result.inserted.trades += 1;
    }

    for (const d of preview.preview.dividends) {
      if (dividendsRepo.findByExternalId(d.external_id)) {
        result.skippedDuplicates.dividends += 1;
        continue;
      }
      const sec = securitiesRepo.findByTicker(d.ticker);
      if (!sec) throw new Error(`Security ${d.ticker} missing after upsert`);
      const fy = fyForDateOrThrow(d.payment_date);
      dividendsRepo.insert({
        security_id: sec.id,
        fy_id: fy.id,
        payment_date: d.payment_date,
        ex_date: d.ex_date,
        unfranked_cents: d.unfranked_cents,
        franked_cents: d.franked_cents,
        franking_credits_cents: d.franking_credits_cents,
        withholding_tax_cents: d.withholding_tax_cents,
        drp_units: 0,
        currency: d.currency,
        aud_fx_rate: d.aud_fx_rate,
        dividend_type: d.dividend_type,
        external_id: d.external_id,
        notes: null,
      });
      result.inserted.dividends += 1;
    }

    for (const c of preview.preview.cashTransactions) {
      if (cashTransactionsRepo.findByExternalId(c.external_id)) {
        result.skippedDuplicates.cashTransactions += 1;
        continue;
      }
      const fy = fyForDateOrThrow(c.tx_date);
      cashTransactionsRepo.insert({
        fy_id: fy.id,
        tx_date: c.tx_date,
        description: c.description,
        debit_cents: c.debit_cents,
        credit_cents: c.credit_cents,
        balance_cents: c.balance_cents,
        currency: c.currency,
        category: c.category,
        external_id: c.external_id,
        notes: null,
      });
      result.inserted.cashTransactions += 1;
    }
  });

  tx();
  return result;
}