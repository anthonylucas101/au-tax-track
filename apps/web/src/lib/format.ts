export function fmtAud(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? '-' : ''}$${dollars}`;
}

export function dollarsToCents(input: string): number {
  const trimmed = input.trim().replace(/[$,]/g, '');
  if (trimmed === '') return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${input}`);
  return Math.round(n * 100);
}

export function centsToDollarsInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
