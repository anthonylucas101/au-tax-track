import { useEffect, useState } from 'react';
import { api, type CryptoTrade } from '../../lib/api.js';
import { fmtAud } from '../../lib/format.js';
import { useFy } from '../../lib/fyContext.js';

interface TradeForm {
  symbol: string;
  trade_date: string;
  side: 'buy' | 'sell';
  units: string;
  aud_value: string;
  notes: string;
}

const emptyForm: TradeForm = {
  symbol: '', trade_date: '', side: 'buy', units: '', aud_value: '', notes: '',
};

export function CryptoTradesPage() {
  const { selected } = useFy();
  const [trades, setTrades] = useState<CryptoTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TradeForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function load(fyId: number) {
    setLoading(true);
    api.cryptoTrades(fyId)
      .then((r) => { setTrades(r); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (selected) load(selected.id);
  }, [selected?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await api.createCryptoTrade({
        symbol: form.symbol.trim().toUpperCase(),
        trade_date: form.trade_date,
        side: form.side,
        units: parseFloat(form.units),
        aud_value: parseFloat(form.aud_value),
        notes: form.notes.trim() || undefined,
      });
      setForm(emptyForm);
      setShowForm(false);
      load(selected.id);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    if (!selected) return;
    await api.deleteCryptoTrade(id);
    load(selected.id);
  }

  function set(field: keyof TradeForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  if (!selected) return <p className="muted">Loading financial year...</p>;

  const imported = trades.filter((t) => t.external_id !== null);
  const manual = trades.filter((t) => t.external_id === null);

  return (
    <div>
      <h2>Crypto Trades — FY {selected.label}</h2>
      <p className="muted" style={{ maxWidth: 600, fontSize: '0.9rem' }}>
        Imported CoinSpot trades are shown below. Use <strong>Add manual entry</strong> to record
        airdrops, staking rewards, or transfers in that won't appear in your CoinSpot export.
        These are needed for accurate CGT matching.
      </p>

      <button onClick={() => setShowForm((v) => !v)} style={{ marginBottom: '1rem' }}>
        {showForm ? 'Cancel' : '+ Add manual entry'}
      </button>

      {showForm && (
        <form onSubmit={handleSubmit} className="section" style={{ maxWidth: 520, marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>New entry</h3>
          {formError && <div className="error" style={{ marginBottom: '0.5rem' }}>{formError}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
            <label>
              Coin symbol
              <input
                value={form.symbol}
                onChange={(e) => set('symbol', e.target.value.toUpperCase())}
                placeholder="e.g. LUNA2"
                required
              />
            </label>
            <label>
              Date
              <input
                type="date"
                value={form.trade_date}
                onChange={(e) => set('trade_date', e.target.value)}
                required
              />
            </label>
            <label>
              Type
              <select value={form.side} onChange={(e) => set('side', e.target.value as 'buy' | 'sell')}>
                <option value="buy">Buy / Received / Airdrop</option>
                <option value="sell">Sell / Sent</option>
              </select>
            </label>
            <label>
              Units
              <input
                type="number"
                step="any"
                min="0"
                value={form.units}
                onChange={(e) => set('units', e.target.value)}
                placeholder="0.00"
                required
              />
            </label>
            <label>
              AUD value (cost base)
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.aud_value}
                onChange={(e) => set('aud_value', e.target.value)}
                placeholder="0.00"
                required
              />
            </label>
            <label>
              Notes (optional)
              <input
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="e.g. Terra airdrop"
              />
            </label>
          </div>

          <p className="muted" style={{ fontSize: '0.82rem', marginTop: '0.4rem' }}>
            For airdrops and staking rewards, AUD value = market value at time of receipt
            (this also becomes your assessable income for that FY).
          </p>

          <button type="submit" disabled={submitting} style={{ marginTop: '0.5rem' }}>
            {submitting ? 'Saving...' : 'Save entry'}
          </button>
        </form>
      )}

      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      {manual.length > 0 && (
        <section className="section">
          <h3>Manual entries</h3>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Coin</th>
                <th>Type</th>
                <th className="num">Units</th>
                <th className="num">AUD Value</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {manual.map((t) => (
                <tr key={t.id}>
                  <td>{t.trade_date}</td>
                  <td><strong>{t.symbol}</strong></td>
                  <td style={{ color: t.side === 'buy' ? '#2e7d32' : '#c62828' }}>
                    {t.side === 'buy' ? 'Received' : 'Sent'}
                  </td>
                  <td className="num">{t.units.toLocaleString('en-AU', { maximumFractionDigits: 8 })}</td>
                  <td className="num">{fmtAud(t.aud_value_cents)}</td>
                  <td className="muted" style={{ fontSize: '0.85rem' }}>{t.notes ?? ''}</td>
                  <td>
                    <button
                      className="secondary"
                      style={{ fontSize: '0.8rem', padding: '0.15rem 0.4rem', color: '#c62828' }}
                      onClick={() => handleDelete(t.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {imported.length > 0 && (
        <section className="section">
          <h3>Imported from CoinSpot ({imported.length} trades)</h3>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Coin</th>
                <th>Side</th>
                <th className="num">Units</th>
                <th className="num">AUD Value</th>
                <th className="num">Fee</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {imported.map((t) => (
                <tr key={t.id}>
                  <td>{t.trade_date}</td>
                  <td><strong>{t.symbol}</strong></td>
                  <td style={{ color: t.side === 'buy' ? '#2e7d32' : '#c62828' }}>{t.side}</td>
                  <td className="num">{t.units.toLocaleString('en-AU', { maximumFractionDigits: 8 })}</td>
                  <td className="num">{fmtAud(t.aud_value_cents)}</td>
                  <td className="num">{t.fee_cents > 0 ? fmtAud(t.fee_cents) : '—'}</td>
                  <td className="muted" style={{ fontSize: '0.85rem' }}>{t.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && trades.length === 0 && (
        <p className="muted">No trades for FY {selected.label}.</p>
      )}
    </div>
  );
}
