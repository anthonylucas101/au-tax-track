// Money + FX helpers. Money is INTEGER cents in this codebase.
// FX direction: aud_fx_rate is AUD-per-unit-of-foreign-currency
//   so AUD = foreign * rate. For Stake USD trades, rate ~ 1.5.

const ABSURD_RATE_LOW = 0.05;   // an AUD/foreign rate below this is almost certainly mis-parsed
const ABSURD_RATE_HIGH = 100;

export function parseDollars(input: number | string): number {
  // Accept '$0.4347', '0.4347', '-1,234.56', '$ 1.23', '', null-ish strings.
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Invalid dollar amount: ${input}`);
    return input;
  }
  const s = String(input).trim().replace(/[$,\s]/g, '');
  if (s === '' || s === '-' || s.toLowerCase() === 'null') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid dollar amount: ${input}`);
  return n;
}

export function dollarsToCents(input: number | string): number {
  const dollars = parseDollars(input);
  // Round half-away-from-zero to avoid IEEE-754 surprises like 0.005 -> 0.
  const cents = dollars >= 0
    ? Math.floor(dollars * 100 + 0.5)
    : -Math.floor(Math.abs(dollars) * 100 + 0.5);
  return cents;
}

export function centsToAud(c: number): string {
  const negative = c < 0;
  const abs = Math.abs(c);
  const dollars = (abs / 100).toFixed(2);
  return `${negative ? '-' : ''}$${dollars}`;
}

export function parsePercent(input: string | number): number {
  if (typeof input === 'number') return input > 1 ? input / 100 : input;
  const s = String(input).trim();
  if (s === '') return 0;
  const stripped = s.replace('%', '').trim();
  const n = Number(stripped);
  if (!Number.isFinite(n)) throw new Error(`Invalid percent: ${input}`);
  // If the source had a % sign or value > 1, treat as percent points.
  return s.endsWith('%') || n > 1 ? n / 100 : n;
}

export function parseFxRate(input: string | number): number {
  // Stake formats USD trade rates as '$1.538' (with $) and dividend rates as '1.517946' (plain).
  if (typeof input === 'number') {
    assertSaneRate(input);
    return input;
  }
  const s = String(input).trim().replace(/[$,\s]/g, '');
  if (s === '') throw new Error('Empty fx rate');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid fx rate: ${input}`);
  assertSaneRate(n);
  return n;
}

function assertSaneRate(n: number): void {
  if (n < ABSURD_RATE_LOW || n > ABSURD_RATE_HIGH) {
    throw new Error(
      `FX rate ${n} is outside sane bounds [${ABSURD_RATE_LOW}, ${ABSURD_RATE_HIGH}]. Possible parse error.`,
    );
  }
}

/**
 * Convert a foreign-currency amount (in cents) to AUD cents.
 *   AUD_cents = foreign_cents * fxRate
 * fxRate must be AUD-per-foreign (e.g. ~1.5 for AUD/USD as published by Stake).
 * If fromCurrency === 'AUD' the rate is ignored and the amount is passed through.
 */
export function convertToAud(
  amountCents: number,
  fxRate: number | null | undefined,
  fromCurrency: string,
): number {
  if (fromCurrency === 'AUD') return amountCents;
  if (fxRate == null) {
    throw new Error(`convertToAud: fx rate required when converting from ${fromCurrency}`);
  }
  assertSaneRate(fxRate);
  return Math.round(amountCents * fxRate);
}