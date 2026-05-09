import { useEffect, useRef, useState } from 'react';
import { api, type Dividend } from '../../lib/api.js';
import { fmtAud } from '../../lib/format.js';
import { useFy } from '../../lib/fyContext.js';

function fmtCurrency(cents: number, currency: string, fxRate: number | null): string {
  if (currency === 'AUD') return fmtAud(cents);
  const dollars = (Math.abs(cents) / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = cents < 0 ? '-' : '';
  const native = `${sign}${currency} $${dollars}`;
  if (fxRate && fxRate > 0) {
    return `${native} (${fmtAud(Math.round(cents / fxRate))} AUD)`;
  }
  return native;
}

interface DivForm {
  ticker: string;
  security_name: string;
  payment_date: string;
  ex_date: string;
  dividend_type: string;
  currency: string;
  aud_fx_rate: string;
  unfranked: string;
  franked: string;
  franking_credits: string;
  withholding_tax: string;
  notes: string;
}

const emptyForm: DivForm = {
  ticker: '', security_name: '', payment_date: '', ex_date: '',
  dividend_type: 'Dividend', currency: 'AUD', aud_fx_rate: '1',
  unfranked: '', franked: '', franking_credits: '', withholding_tax: '', notes: '',
};

export function DividendsPage() {
  const { selected } = useFy();
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<DivForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const abortRef = useRef(false);

  function load(fyId: number) {
    setLoading(true);
    api
      .listDividends(fyId)
      .then((rows) => {
        if (!abortRef.current) { setDividends(rows); setError(null); }
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

  function set(k: keyof DivForm, v: string) {
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
      await api.createDividend({
        ticker: form.ticker.toUpperCase().trim(),
        security_name: form.security_name.trim() || null,
        payment_date: form.payment_date,
        ex_date: form.ex_date || null,
        dividend_type: form.dividend_type.trim() || 'Dividend',
        currency: form.currency,
        aud_fx_rate: fx,
        unfranked_cents: toCents(form.unfranked),
        franked_cents: toCents(form.franked),
        franking_credits_cents: form.currency === 'AUD' ? toCents(form.franking_credits) : 0,
        withholding_tax_cents: form.currency !== 'AUD' ? toCents(form.withholding_tax) : 0,
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
    if (!confirm('Delete this dividend?')) return;
    try {
      await api.deleteDividend(id);
      load(selected.id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  if (!selected) return <p className="muted">Loading financial year...</p>;

  return (
    <div>
      <h2>Dividends — FY {selected.label}</h2>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}
      {!loading && !error && (
        dividends.length === 0
          ? <p className="muted">No dividends recorded for this FY.</p>
          : (
            <table>
              <thead>
                <tr>
                  <th>Payment Date</th>
                  <th>Ex Date</th>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Currency</th>
                  <th className="num">Unfranked</th>
                  <th className="num">Franked</th>
                  <th className="num">Franking Credit</th>
                  <th className="num">Withholding Tax</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {dividends.map((d) => (
                  <tr key={d.id}>
                    <td>{d.payment_date}</td>
                    <td>{d.ex_date ?? '—'}</td>
                    <td><strong>{d.ticker}</strong></td>
                    <td>{d.security_name ?? '—'}</td>
                    <td>{d.dividend_type ?? '—'}</td>
                    <td>{d.currency}</td>
                    <td className="num">{fmtCurrency(d.unfranked_cents, d.currency, d.aud_fx_rate)}</td>
                    <td className="num">{fmtCurrency(d.franked_cents, d.currency, d.aud_fx_rate)}</td>
                    <td className="num">{d.currency === 'AUD' ? fmtAud(d.franking_credits_cents) : '—'}</td>
                    <td className="num">{d.currency !== 'AUD' ? fmtCurrency(d.withholding_tax_cents, d.currency, d.aud_fx_rate) : '—'}</td>
                    <td>
                      <button className="danger" onClick={() => handleDelete(d.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}

      <div className="section">
        <button className="secondary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Add Dividend'}
        </button>
        {showForm && (
          <form className="stacked" onSubmit={handleSubmit} style={{ marginTop: '0.75rem' }}>
            <label>Ticker *<input required value={form.ticker} onChange={(e) => set('ticker', e.target.value)} /></label>
            <label>Name<input value={form.security_name} onChange={(e) => set('security_name', e.target.value)} /></label>
            <label>Payment Date *<input type="date" required value={form.payment_date} onChange={(e) => set('payment_date', e.target.value)} /></label>
            <label>Ex Date<input type="date" value={form.ex_date} onChange={(e) => set('ex_date', e.target.value)} /></label>
            <label>Type<input value={form.dividend_type} onChange={(e) => set('dividend_type', e.target.value)} /></label>
            <label>Currency
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                <option>AUD</option>
                <option>USD</option>
              </select>
            </label>
            {form.currency !== 'AUD' && (
              <label>AUD/FX Rate<input type="number" step="0.0001" min="0" value={form.aud_fx_rate} onChange={(e) => set('aud_fx_rate', e.target.value)} /></label>
            )}
            <label>Unfranked ($)<input type="number" step="0.01" min="0" value={form.unfranked} onChange={(e) => set('unfranked', e.target.value)} /></label>
            <label>Franked ($)<input type="number" step="0.01" min="0" value={form.franked} onChange={(e) => set('franked', e.target.value)} /></label>
            {form.currency === 'AUD' && (
              <label>Franking Credit ($)<input type="number" step="0.01" min="0" value={form.franking_credits} onChange={(e) => set('franking_credits', e.target.value)} /></label>
            )}
            {form.currency !== 'AUD' && (
              <label>Withholding Tax ($)<input type="number" step="0.01" min="0" value={form.withholding_tax} onChange={(e) => set('withholding_tax', e.target.value)} /></label>
            )}
            <label>Notes<input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
            <div className="actions">
              <button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save Dividend'}</button>
            </div>
            {formError && <div className="error">{formError}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
