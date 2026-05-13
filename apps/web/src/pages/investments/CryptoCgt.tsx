import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type CryptoCgtResult, type CryptoCgtEvent, type CryptoCgtOrphan } from '../../lib/api.js';
import { fmtAud } from '../../lib/format.js';
import { useFy } from '../../lib/fyContext.js';

function SummaryCard({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`summary-card${className ? ` ${className}` : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

export function CryptoCgtPage() {
  const { selected } = useFy();
  const [result, setResult] = useState<CryptoCgtResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    api
      .cryptoCgt(selected.id)
      .then((r) => { if (!cancelled) { setResult(r); setError(null); } })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  if (!selected) return <p className="muted">Loading financial year...</p>;

  return (
    <div>
      <h2>Crypto Capital Gains — FY {selected.label}</h2>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}
      {result && (
        <>
          <div className="summary-cards">
            <SummaryCard
              label="Total Gains"
              value={fmtAud(result.total_gain_cents)}
              className={result.total_gain_cents > 0 ? 'good' : undefined}
            />
            <SummaryCard
              label="Total Losses"
              value={fmtAud(-result.total_loss_cents)}
              className={result.total_loss_cents > 0 ? 'bad' : undefined}
            />
            <SummaryCard
              label="Net Gains"
              value={fmtAud(result.net_gain_cents)}
              className={result.net_gain_cents >= 0 ? 'good' : 'bad'}
            />
            <SummaryCard label="After 50% Discount" value={fmtAud(result.discounted_net_gain_cents)} />
            <SummaryCard
              label="Carry-forward Losses"
              value={fmtAud(result.loss_carryforward_cents)}
              className={result.loss_carryforward_cents > 0 ? 'bad' : undefined}
            />
          </div>

          {result.events.length === 0 && (
            <p className="muted">
              No crypto CGT events for FY {selected.label}.{' '}
              <Link to="/investments/crypto-import">Import CoinSpot data</Link> to get started.
            </p>
          )}

          {result.events.length > 0 && (
            <section className="section">
              <h3>CGT Events</h3>
              <table>
                <thead>
                  <tr>
                    <th>Date Sold</th>
                    <th>Coin</th>
                    <th className="num">Units</th>
                    <th className="num">Proceeds (AUD)</th>
                    <th className="num">Cost Base (AUD)</th>
                    <th className="num">Gross Gain/Loss</th>
                    <th>Discount Eligible</th>
                    <th className="num">Taxable Gain</th>
                    <th>Acquired</th>
                    <th className="num">Days Held</th>
                  </tr>
                </thead>
                <tbody>
                  {result.events.map((ev: CryptoCgtEvent, i: number) => {
                    const isGain = ev.gain_cents >= 0;
                    const taxableGain = ev.discount_eligible
                      ? Math.round(ev.gain_cents / 2)
                      : ev.gain_cents;
                    return (
                      <tr key={`${ev.sell_trade_id}-${i}`} className={isGain ? 'cgt-gain' : 'cgt-loss'}>
                        <td>{ev.sell_date}</td>
                        <td><strong>{ev.symbol}</strong></td>
                        <td className="num">{ev.units.toLocaleString('en-AU', { maximumFractionDigits: 8 })}</td>
                        <td className="num">{fmtAud(ev.proceeds_cents)}</td>
                        <td className="num">{fmtAud(ev.cost_base_cents)}</td>
                        <td className={`num ${isGain ? 'cgt-gain' : 'cgt-loss'}`}>{fmtAud(ev.gain_cents)}</td>
                        <td>{ev.discount_eligible ? 'Yes (>12mo)' : 'No'}</td>
                        <td className="num">{fmtAud(taxableGain)}</td>
                        <td>{ev.acquired_date}</td>
                        <td className="num">{ev.held_days}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                {result.event_count} disposal event{result.event_count !== 1 ? 's' : ''} matched via FIFO.
                Coin-to-coin swaps are treated as a disposal at the AUD equivalent value.
              </p>
            </section>
          )}

          {result.orphans.length > 0 && (
            <section className="section">
              <div className="error" style={{ marginBottom: '0.75rem' }}>
                <strong>{result.orphans.length} sell{result.orphans.length !== 1 ? 's' : ''} could not be fully matched</strong> —
                no buy records exist for these coins in this or earlier financial years.
                Import your complete CoinSpot history (including earlier FYs) to calculate CGT accurately.
                These disposals are <strong>excluded from the totals above</strong>.
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Coin</th>
                    <th>Date Sold</th>
                    <th className="num">Units Sold</th>
                    <th className="num">Units Unmatched</th>
                  </tr>
                </thead>
                <tbody>
                  {result.orphans.map((o: CryptoCgtOrphan) => (
                    <tr key={o.sell_trade_id}>
                      <td><strong>{o.symbol}</strong></td>
                      <td>{o.sell_date}</td>
                      <td className="num">{o.units_sold.toLocaleString('en-AU', { maximumFractionDigits: 8 })}</td>
                      <td className="num" style={{ color: 'var(--color-bad, #c62828)' }}>
                        {o.units_unmatched.toLocaleString('en-AU', { maximumFractionDigits: 8 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: '0.85rem' }}>
                Go to <Link to="/investments/crypto-import">Import</Link> to upload earlier CoinSpot exports.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
