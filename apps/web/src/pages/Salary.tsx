import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFy } from '../lib/fyContext.js';
import { api, type Employer, type Payslip } from '../lib/api.js';
import { dollarsToCents, fmtAud } from '../lib/format.js';

// ── date generation ────────────────────────────────────────────────────────────
type Freq = 'weekly' | 'fortnightly' | '4-weekly' | 'monthly';

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function generateDates(start: string, end: string, freq: Freq): string[] {
  if (!start || !end || start > end) return [];
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dates: string[] = [];

  if (freq === 'monthly') {
    let cur = new Date(startDate);
    while (cur <= endDate) {
      dates.push(cur.toISOString().slice(0, 10));
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
    }
  } else {
    const step = freq === 'weekly' ? 7 : freq === 'fortnightly' ? 14 : 28;
    let cur = new Date(startDate);
    while (cur <= endDate) {
      dates.push(cur.toISOString().slice(0, 10));
      cur = addDays(cur, step);
    }
  }
  return dates;
}

// ── BulkPayslipForm ────────────────────────────────────────────────────────────
function BulkPayslipForm({
  fyId,
  employers,
  onCreated,
}: {
  fyId: number;
  employers: Employer[];
  onCreated: () => Promise<void> | void;
}) {
  const [employerId, setEmployerId] = useState<number | ''>('');
  const [freq, setFreq] = useState<Freq>('fortnightly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [gross, setGross] = useState('');
  const [tax, setTax] = useState('');
  const [superDollars, setSuperDollars] = useState('');
  const [allowances, setAllowances] = useState('');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  useEffect(() => {
    if (employerId === '' && employers[0]) setEmployerId(employers[0].id);
  }, [employers, employerId]);

  const dates = useMemo(() => generateDates(startDate, endDate, freq), [startDate, endDate, freq]);

  // Keep selection in sync when dates list changes
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(dates);
      const next = new Set([...prev].filter((d) => valid.has(d)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [dates]);

  function toggleDate(d: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (employerId === '' || selected.size === 0) return;
    setSubmitting(true);
    setErr(null);
    setSuccessCount(null);

    const grossCents = dollarsToCents(gross || '0');
    const taxCents = dollarsToCents(tax || '0');
    const superCents = dollarsToCents(superDollars || '0');
    const allowancesCents = dollarsToCents(allowances || '0');
    const notesVal = notes.trim() || null;

    try {
      const sortedDates = [...selected].sort();
      await Promise.all(
        sortedDates.map((pay_date) =>
          api.createPayslip({
            employer_id: employerId as number,
            fy_id: fyId,
            pay_date,
            gross_cents: grossCents,
            tax_withheld_cents: taxCents,
            super_cents: superCents,
            allowances_cents: allowancesCents,
            notes: notesVal,
          }),
        ),
      );
      setSuccessCount(sortedDates.length);
      setStartDate('');
      setEndDate('');
      setSelected(new Set());
      setGross('');
      setTax('');
      setSuperDollars('');
      setAllowances('');
      setNotes('');
      await onCreated();
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Failed to add payslips');
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = employers.length === 0;

  return (
    <form className="stacked" onSubmit={handleSubmit}>
      {err && <div className="error" style={{ gridColumn: '1 / -1' }}>{err}</div>}
      {successCount !== null && (
        <div className="success" style={{ gridColumn: '1 / -1' }}>
          Added {successCount} payslip{successCount !== 1 ? 's' : ''}.
        </div>
      )}

      <label>
        Employer
        <select
          value={employerId === '' ? '' : String(employerId)}
          onChange={(e) => setEmployerId(e.target.value ? Number(e.target.value) : '')}
          disabled={disabled}
          required
        >
          {employers.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
          {employers.length === 0 && <option value="">(add an employer first)</option>}
        </select>
      </label>

      <label>
        Frequency
        <select value={freq} onChange={(e) => setFreq(e.target.value as Freq)} disabled={disabled}>
          <option value="weekly">Weekly</option>
          <option value="fortnightly">Fortnightly</option>
          <option value="4-weekly">4-weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>

      <label>
        First pay date
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required disabled={disabled} />
      </label>

      <label>
        Last pay date
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required disabled={disabled} />
      </label>

      <label>
        Gross per payslip ($)
        <input inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0.00" required disabled={disabled} />
      </label>

      <label>
        Tax withheld per payslip ($)
        <input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" required disabled={disabled} />
      </label>

      <label>
        Super per payslip ($)
        <input inputMode="decimal" value={superDollars} onChange={(e) => setSuperDollars(e.target.value)} placeholder="0.00" disabled={disabled} />
      </label>

      <label>
        Allowances per payslip ($)
        <input inputMode="decimal" value={allowances} onChange={(e) => setAllowances(e.target.value)} placeholder="0.00" disabled={disabled} />
      </label>

      <label>
        Notes (applied to all)
        <input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={disabled} />
      </label>

      {dates.length > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              {dates.length} pay date{dates.length !== 1 ? 's' : ''} — select which to add:
            </span>
            <button type="button" onClick={() => setSelected(new Set(dates))} style={{ fontSize: '0.8rem' }}>
              Select all
            </button>
            <button type="button" onClick={() => setSelected(new Set())} style={{ fontSize: '0.8rem' }}>
              Clear all
            </button>
          </div>
          <div className="bulk-dates">
            {dates.map((d) => (
              <label key={d} className="bulk-date-item">
                <input
                  type="checkbox"
                  checked={selected.has(d)}
                  onChange={() => toggleDate(d)}
                />
                {d}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="actions">
        <button type="submit" disabled={submitting || disabled || selected.size === 0}>
          {submitting ? 'Adding...' : `Add ${selected.size > 0 ? selected.size : ''} payslip${selected.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </form>
  );
}

// ── PayslipForm (single) ───────────────────────────────────────────────────────
function PayslipForm({
  fyId,
  employers,
  onCreated,
}: {
  fyId: number;
  employers: Employer[];
  onCreated: () => Promise<void> | void;
}) {
  const [employerId, setEmployerId] = useState<number | ''>('');
  const [payDate, setPayDate] = useState('');
  const [gross, setGross] = useState('');
  const [tax, setTax] = useState('');
  const [superDollars, setSuperDollars] = useState('');
  const [allowances, setAllowances] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (employerId === '' && employers[0]) setEmployerId(employers[0].id);
  }, [employers, employerId]);

  const disabled = employers.length === 0;

  return (
    <form
      className="stacked"
      onSubmit={async (e) => {
        e.preventDefault();
        if (employerId === '' || !payDate) return;
        setSubmitting(true);
        setErr(null);
        try {
          await api.createPayslip({
            employer_id: employerId,
            fy_id: fyId,
            pay_date: payDate,
            gross_cents: dollarsToCents(gross || '0'),
            tax_withheld_cents: dollarsToCents(tax || '0'),
            super_cents: dollarsToCents(superDollars || '0'),
            allowances_cents: dollarsToCents(allowances || '0'),
            notes: notes.trim() ? notes.trim() : null,
          });
          setPayDate('');
          setGross('');
          setTax('');
          setSuperDollars('');
          setAllowances('');
          setNotes('');
          await onCreated();
        } catch (caught) {
          setErr(caught instanceof Error ? caught.message : 'Failed');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <label>
        Employer
        <select
          value={employerId === '' ? '' : String(employerId)}
          onChange={(e) => setEmployerId(e.target.value ? Number(e.target.value) : '')}
          disabled={disabled}
          required
        >
          {employers.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
          {employers.length === 0 && <option value="">(add an employer first)</option>}
        </select>
      </label>
      <label>
        Pay date
        <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} required disabled={disabled} />
      </label>
      <label>
        Gross ($)
        <input inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0.00" required disabled={disabled} />
      </label>
      <label>
        Tax withheld ($)
        <input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" required disabled={disabled} />
      </label>
      <label>
        Super ($)
        <input inputMode="decimal" value={superDollars} onChange={(e) => setSuperDollars(e.target.value)} placeholder="0.00" disabled={disabled} />
      </label>
      <label>
        Allowances ($)
        <input inputMode="decimal" value={allowances} onChange={(e) => setAllowances(e.target.value)} placeholder="0.00" disabled={disabled} />
      </label>
      <label>
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={disabled} />
      </label>
      <div className="actions">
        <button type="submit" disabled={submitting || disabled}>Add payslip</button>
      </div>
      {err && <div className="error" style={{ gridColumn: '1 / -1' }}>{err}</div>}
    </form>
  );
}

// ── EmployerForm ───────────────────────────────────────────────────────────────
function EmployerForm({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const [name, setName] = useState('');
  const [abn, setAbn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      className="stacked"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSubmitting(true);
        setErr(null);
        try {
          await api.createEmployer({ name: name.trim(), abn: abn.trim() ? abn.trim() : null });
          setName('');
          setAbn('');
          await onCreated();
        } catch (caught) {
          setErr(caught instanceof Error ? caught.message : 'Failed');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <label>
        Employer name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        ABN (optional)
        <input value={abn} onChange={(e) => setAbn(e.target.value)} />
      </label>
      <div className="actions">
        <button type="submit" disabled={submitting}>Add employer</button>
      </div>
      {err && <div className="error" style={{ gridColumn: '1 / -1' }}>{err}</div>}
    </form>
  );
}

// ── SalaryPage ────────────────────────────────────────────────────────────────
export function SalaryPage() {
  const { selected } = useFy();

  const [employers, setEmployers] = useState<Employer[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  const reloadEmployers = useCallback(async () => {
    const rows = await api.listEmployers();
    setEmployers(rows);
  }, []);

  const reloadPayslips = useCallback(async (fyId: number) => {
    const rows = await api.listPayslips(fyId);
    setPayslips(rows);
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([reloadEmployers(), reloadPayslips(selected.id)])
      .then(() => { if (!cancelled) setError(null); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.id, reloadEmployers, reloadPayslips]);

  const totals = useMemo(() => {
    return payslips.reduce(
      (acc, p) => {
        acc.gross += p.gross_cents;
        acc.tax += p.tax_withheld_cents;
        acc.superCents += p.super_cents;
        acc.allowances += p.allowances_cents;
        return acc;
      },
      { gross: 0, tax: 0, superCents: 0, allowances: 0 },
    );
  }, [payslips]);

  if (!selected) return <p className="muted">Loading financial year...</p>;

  return (
    <div>
      <h2>Salary &amp; PAYG — FY {selected.label}</h2>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      <section className="section">
        <h3>Employers</h3>
        <EmployerForm
          onCreated={async () => {
            try { await reloadEmployers(); } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed');
            }
          }}
        />
        {employers.length === 0 ? (
          <p className="muted">No employers yet. Add one above before entering payslips.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>ABN</th><th></th></tr>
            </thead>
            <tbody>
              {employers.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>{e.abn ?? '-'}</td>
                  <td className="num">
                    <button
                      className="danger"
                      onClick={async () => {
                        if (!confirm(`Delete employer "${e.name}"? This also deletes their payslips.`)) return;
                        try {
                          await api.deleteEmployer(e.id);
                          await Promise.all([reloadEmployers(), reloadPayslips(selected.id)]);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed');
                        }
                      }}
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h3>
          Add payslip
          <span className="mode-toggle">
            <button
              type="button"
              className={mode === 'single' ? 'active' : ''}
              onClick={() => setMode('single')}
            >Single</button>
            <button
              type="button"
              className={mode === 'bulk' ? 'active' : ''}
              onClick={() => setMode('bulk')}
            >Bulk</button>
          </span>
        </h3>

        {mode === 'single' ? (
          <PayslipForm
            fyId={selected.id}
            employers={employers}
            onCreated={async () => {
              try { await reloadPayslips(selected.id); } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed');
              }
            }}
          />
        ) : (
          <BulkPayslipForm
            fyId={selected.id}
            employers={employers}
            onCreated={async () => {
              try { await reloadPayslips(selected.id); } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed');
              }
            }}
          />
        )}
      </section>

      <section className="section">
        <h3>Payslips ({payslips.length})</h3>
        {payslips.length === 0 ? (
          <p className="muted">No payslips for this FY yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Pay date</th>
                <th>Employer</th>
                <th className="num">Gross</th>
                <th className="num">Tax withheld</th>
                <th className="num">Super</th>
                <th className="num">Allowances</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payslips.map((p) => (
                <tr key={p.id}>
                  <td>{p.pay_date}</td>
                  <td>{p.employer_name}</td>
                  <td className="num">{fmtAud(p.gross_cents)}</td>
                  <td className="num">{fmtAud(p.tax_withheld_cents)}</td>
                  <td className="num">{fmtAud(p.super_cents)}</td>
                  <td className="num">{fmtAud(p.allowances_cents)}</td>
                  <td>{p.notes ?? ''}</td>
                  <td className="num">
                    <button
                      className="danger"
                      onClick={async () => {
                        if (!confirm('Delete this payslip?')) return;
                        try {
                          await api.deletePayslip(p.id);
                          await reloadPayslips(selected.id);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed');
                        }
                      }}
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Totals ({payslips.length})</td>
                <td className="num">{fmtAud(totals.gross)}</td>
                <td className="num">{fmtAud(totals.tax)}</td>
                <td className="num">{fmtAud(totals.superCents)}</td>
                <td className="num">{fmtAud(totals.allowances)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </div>
  );
}
