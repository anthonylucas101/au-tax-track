import { useEffect, useRef, useState } from 'react';
import { api, type ShareTrade } from '../../lib/api.js';
import { fmtAud } from '../../lib/format.js';
import { useFy } from '../../lib/fyContext.js';

function computeValueCents(t: ShareTrade): number {
  const fx = t.aud_fx_rate ?? 1;
  const gross = t.price_cents * t.units;
  if (t.side === 'buy') {
    return Math.round((gross + t.brokerage_cents + t.gst_cents) / fx);
  }
  return Math.round((gross - t.brokerage_cents - t.gst_cents) / fx);
}

interface TradeForm {
  ticker: string;
  security_name: string;
  trade_date: string;
  settlement_date: string;
  side: 'buy' | 'sell';
  units: string;
  price: string;
  brokerage: string;
  gst: string;
  currency: string;
  aud_fx_rate: string;
  is_opening: boolean;
  notes: string;
}

const emptyForm: TradeForm = {
  ticker: '', security_name: '', trade_date: '', settlement_date: '',
  side: 'buy', units: '', price: '', brokerage: '0', gst: '0',
  currency: 'AUD', aud_fx_rate: '1', is_opening: false, notes: '',
};

export function TradesPage() {
  const { selected } = useFy();
  const [trades, setTrades] = useState<ShareTrade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TradeForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const abortRef = useRef(false);

  function load(fyId: number) {
    setLoading(true);
    api
      .listShareTrades(fyId)
      .then((rows) => {
        if (!abortRef.current) { setTrades(rows); setError(null); }
      })
      .catch((err: unknown) => {
        if (!abortRef.current) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!abortRef.current) setLoading(false); });
  }

  useEffect(() => {
    if (!selected) return;
    abortRef.current = false;
    load(selected.id);
    return () => { abortRef.current = true; };
  }, [selected?.id]);

  function set<K extends keyof TradeForm>(k: K, v: TradeForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const toCents = (s: string) => Math.round(parseFloat(s || '0') * 100);
      const fx = form.currency !== 'AUD' ? parseFloat(form.aud_fx_rate) : null;
      await api.createShareTrade({
        ticker: form.ticker.toUpperCase().trim(),
        security_name: form.security_name.trim() || null,
        trade_date: form.trade_date,
        settlement_date: form.settlement_date || null,
        side: form.side,
        units: parseFloat(form.units),
        price_cents: toCents(form.price),
        brokerage_cents: toCents(form.brokerage),
        gst_cents: toCents(form.gst),
        currency: form.currency,
        aud_fx_rate: fx,
        is_opening: form.is_opening,
        notes: form.notes.trim() || null,
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
    if (!confirm('Delete this trade?')) return;
    try {
      await api.deleteShareTrade(id);
      load(selected.id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  if (!selected) return <p className="muted">Loading financial year...</p>;

  return (
    <div>
      <h2>Trades — FY {selected.label}</h2>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}
      {!loading && !error && (
        trades.length === 0
          ? <p className="muted">No trades recorded for this FY.</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Settlement</th>
                    <th>Ticker</th>
                    <th>Name</th>
                    <th>Side</th>
                    <th className="num">Units</th>
                    <th className="num">Avg Price</th>
                    <th className="num">Fees+GST</th>
                    <th>Currency</th>
                    <th className="num">Value (AUD)</th>
                    <th>Ref ID</th>
                    <th>Opening?</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id}>
                      <td>{t.trade_date}</td>
                      <td>{t.settlement_date ?? '—'}</td>
                      <td><strong>{t.ticker}</strong></td>
                      <td>{t.security_name ?? '—'}</td>
                      <td className={t.side === 'buy' ? 'side-buy' : 'side-sell'}>
                        {t.side.toUpperCase()}
                      </td>
                      <td className="num">{t.units.toLocaleString('en-AU')}</td>
                      <td className="num">{fmtAud(t.price_cents)}{t.currency !== 'AUD' ? ` ${t.currency}` : ''}</td>
                      <td className="num">{fmtAud(t.brokerage_cents + t.gst_cents)}</td>
                      <td>{t.currency}</td>
                      <td className="num">{fmtAud(computeValueCents(t))}</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{t.external_id ?? '—'}</td>
                      <td>{t.is_opening ? 'Yes' : ''}</td>
                      <td>
                        <button className="danger" onClick={() => handleDelete(t.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}

      <div className="section">
        <button className="secondary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Add Manual Trade'}
        </button>
        {showForm && (
          <form className="stacked" onSubmit={handleSubmit} style={{ marginTop: '0.75rem' }}>
            <label>Ticker *<input required value={form.ticker} onChange={(e) => set('ticker', e.target.value)} /></label>
            <label>Name<input value={form.security_name} onChange={(e) => set('security_name', e.target.value)} /></label>
            <label>Trade Date *<input type="date" required value={form.trade_date} onChange={(e) => set('trade_date', e.target.value)} /></label>
            <label>Settlement Date<input type="date" value={form.settlement_date} onChange={(e) => set('settlement_date', e.target.value)} /></label>
            <label>Side
              <select value={form.side} onChange={(e) => set('side', e.target.value as 'buy' | 'sell')}>
                <option value="buy">BUY</option>
                <option value="sell">SELL</option>
              </select>
            </label>
            <label>Units *<input type="number" required step="0.000001" min="0" value={form.units} onChange={(e) => set('units', e.target.value)} /></label>
            <label>Avg Price ($)<input type="number" required step="0.0001" min="0" value={form.price} onChange={(e) => set('price', e.target.value)} /></label>
            <label>Brokerage ($)<input type="number" step="0.01" min="0" value={form.brokerage} onChange={(e) => set('brokerage', e.target.value)} /></label>
            <label>GST ($)<input type="number" step="0.01" min="0" value={form.gst} onChange={(e) => set('gst', e.target.value)} /></label>
            <label>Currency
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                <option>AUD</option>
                <option>USD</option>
              </select>
            </label>
            {form.currency !== 'AUD' && (
              <label>AUD/FX Rate<input type="number" step="0.0001" min="0" value={form.aud_fx_rate} onChange={(e) => set('aud_fx_rate', e.target.value)} /></label>
            )}
            <label style={{ gridColumn: '1 / -1' }}>
              <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexDirection: 'row' }}>
                <input type="checkbox" checked={form.is_opening} onChange={(e) => set('is_opening', e.target.checked)} />
                Opening parcel / prior-period cost base
              </span>
            </label>
            <label>Notes<input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
            <div className="actions">
              <button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save Trade'}</button>
            </div>
            {formError && <div className="error">{formError}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
