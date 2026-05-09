import { useEffect, useState } from 'react';
import { api, type Holding } from '../../lib/api.js';
import { fmtAud } from '../../lib/format.js';

export function HoldingsPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .listHoldings()
      .then((rows) => {
        if (!cancelled) {
          const sorted = [...rows].sort((a, b) => a.ticker.localeCompare(b.ticker));
          setHoldings(sorted);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <h2>Holdings</h2>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        Cost base is total AUD cost of all buys (including brokerage).
        Avg cost excludes opening-parcel label where is_opening=true.
      </p>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}
      {!loading && !error && (
        holdings.length === 0
          ? <p className="muted">No holdings found. Add trades to see holdings.</p>
          : (
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Exchange</th>
                  <th className="num">Total Units</th>
                  <th className="num">Avg Cost/Unit (AUD)</th>
                  <th className="num">Total Cost Base (AUD)</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const avgCents = h.units > 0 ? Math.round(h.cost_base_aud_cents / h.units) : 0;
                  return (
                    <tr key={h.security_id}>
                      <td><strong>{h.ticker}</strong></td>
                      <td>{h.security_name ?? '—'}</td>
                      <td>{h.exchange ?? '—'}</td>
                      <td className="num">{h.units.toLocaleString('en-AU')}</td>
                      <td className="num">{fmtAud(avgCents)}</td>
                      <td className="num">{fmtAud(h.cost_base_aud_cents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
      )}
    </div>
  );
}
