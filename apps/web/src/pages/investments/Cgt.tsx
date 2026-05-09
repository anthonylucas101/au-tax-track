import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type CgtResult, type CgtEvent, type CgtOrphan } from '../../lib/api.js';
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

export function CgtPage() {
  const { selected } = useFy();
  const [result, setResult] = useState<CgtResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    api
      .cgt(selected.id)
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
      <h2>Capital Gains — FY {selected.label}</h2>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}
      {result && (
        <>
          <div className="summary-cards">
            <SummaryCard label="Total Gains" value={fmtAud(result.totalGainCents)} className={result.totalGainCents > 0 ? 'good' : undefined} />
            <SummaryCard label="Total Losses" value={fmtAud(result.totalLossCents)} className={result.totalLossCents < 0 ? 'bad' : undefined} />
            <SummaryCard label="Net Gains" value={fmtAud(result.netGainCents)} className={result.netGainCents >= 0 ? 'good' : 'bad'} />
            <SummaryCard label="After 50% Discount" value={fmtAud(result.discountedNetGainCents)} />
            <SummaryCard label="Carry-forward Losses" value={fmtAud(result.loss_carryforward_cents)} className={result.loss_carryforward_cents > 0 ? 'bad' : undefined} />
          </div>

          {result.events.length === 0 && result.orphans.length === 0 && (
            <p className="muted">No CGT events for FY {selected.label}.</p>
          )}

          {result.events.length > 0 && (
            <section className="section">
              <h3>CGT Events</h3>
              <table>
                <thead>
                  <tr>
                    <th>Date Sold</th>
                    <th>Ticker</th>
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
                  {result.events.map((ev: CgtEvent) => {
                    const isGain = ev.gain_aud_cents >= 0;
                    const discountedGain = ev.discount_eligible
                      ? Math.round(ev.gain_aud_cents / 2)
                      : ev.gain_aud_cents;
                    return (
                      <tr key={ev.sell_trade_id} className={isGain ? 'cgt-gain' : 'cgt-loss'}>
                        <td>{ev.sell_date}</td>
                        <td><strong>{ev.ticker}</strong></td>
                        <td className="num">{ev.units.toLocaleString('en-AU')}</td>
                        <td className="num">{fmtAud(ev.proceeds_aud_cents)}</td>
                        <td className="num">{fmtAud(ev.cost_base_aud_cents)}</td>
                        <td className={`num ${isGain ? 'cgt-gain' : 'cgt-loss'}`}>{fmtAud(ev.gain_aud_cents)}</td>
                        <td>{ev.discount_eligible ? 'Yes (>12mo)' : 'No'}</td>
                        <td className="num">{fmtAud(discountedGain)}</td>
                        <td>{ev.acquired_date}</td>
                        <td className="num">{ev.held_days}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {result.orphans.length > 0 && (
            <section className="section">
              <div className="error" style={{ marginBottom: '0.75rem' }}>
                The following sells have no matching buy parcels — import earlier Stake statements
                or add opening parcels to complete CGT matching.
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Sell Date</th>
                    <th className="num">Units</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.orphans.map((o: CgtOrphan) => (
                    <tr key={o.sell_trade_id}>
                      <td>{o.ticker}</td>
                      <td>{o.sell_date}</td>
                      <td className="num">{o.units_unmatched.toLocaleString('en-AU')}</td>
                      <td>{o.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: '0.85rem' }}>
                Go to <Link to="/investments/trades">Trades</Link> to add opening parcels.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
