import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useFy } from '../../lib/fyContext.js';
import { api, type Property, type PropertySummary, type RentalTransaction, type DepreciationAsset, type BuildingAllowance } from '../../lib/api.js';
import { fmtAud } from '../../lib/format.js';

const INCOME_CATS = ['rent', 'bond_forfeited', 'other_income'] as const;
const EXPENSE_CATS = [
  'interest', 'council_rates', 'water_rates', 'land_tax', 'insurance',
  'body_corporate', 'agent_fees', 'repairs_maintenance', 'advertising',
  'pest_control', 'gardening_cleaning', 'accounting', 'other_expense',
] as const;
const LABELS: Record<string, string> = {
  rent: 'Rent', bond_forfeited: 'Bond forfeited', other_income: 'Other income',
  interest: 'Interest on loan', council_rates: 'Council rates', water_rates: 'Water rates',
  land_tax: 'Land tax', insurance: 'Insurance', body_corporate: 'Body corporate fees',
  agent_fees: 'Agent fees', repairs_maintenance: 'Repairs & maintenance',
  advertising: 'Advertising', pest_control: 'Pest control',
  gardening_cleaning: 'Gardening & cleaning', accounting: 'Accounting fees',
  depreciation: 'Depreciation', other_expense: 'Other expense',
};

function isIncome(cat: string) { return (INCOME_CATS as readonly string[]).includes(cat); }

// ── Bulk / recurring entry form ───────────────────────────────────────────────

type Frequency = 'weekly' | 'fortnightly' | 'monthly';

function generateDates(start: string, end: string, freq: Frequency): string[] {
  if (!start || !end || start > end) return [];
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    if (freq === 'weekly') cur.setDate(cur.getDate() + 7);
    else if (freq === 'fortnightly') cur.setDate(cur.getDate() + 14);
    else { cur.setMonth(cur.getMonth() + 1); }
  }
  return dates;
}

function BulkTransactionForm({ propertyId, fyId, onAdded }: {
  propertyId: number; fyId: number; onAdded: (txs: RentalTransaction[]) => void;
}) {
  const [category, setCategory] = useState('rent');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [freq, setFreq] = useState<Frequency>('fortnightly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generated = generateDates(startDate, endDate, freq);

  // When generated dates change, default all to checked
  useEffect(() => {
    setChecked(Object.fromEntries(generated.map(d => [d, true])));
  }, [startDate, endDate, freq]);

  const selected = generated.filter(d => checked[d]);
  const totalCents = selected.length * Math.round(parseFloat(amount || '0') * 100);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || selected.length === 0) return;
    setSaving(true); setError(null);
    try {
      const amountCents = Math.round(parseFloat(amount) * 100);
      const results: RentalTransaction[] = [];
      for (const date of selected) {
        const tx = await api.createRentalTransaction(propertyId, {
          fy_id: fyId, tx_date: date, category,
          amount_cents: amountCents, notes: notes || null,
        });
        results.push(tx);
      }
      onAdded(results);
      setStartDate(''); setEndDate(''); setChecked({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="inline-form">
      {error && <div className="error">{error}</div>}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="form-row">
          <label>Type *</label>
          <select value={category} onChange={e => setCategory(e.target.value)}>
            <optgroup label="── Income ──">
              {INCOME_CATS.map(c => <option key={c} value={c}>{LABELS[c]}</option>)}
            </optgroup>
            <optgroup label="── Expenses ──">
              {EXPENSE_CATS.map(c => <option key={c} value={c}>{LABELS[c]}</option>)}
            </optgroup>
          </select>
        </div>
        <div className="form-row">
          <label>Amount ($) *</label>
          <input type="number" min="0" step="0.01" value={amount}
            onChange={e => setAmount(e.target.value)} required style={{ width: '9rem' }} />
        </div>
        <div className="form-row">
          <label>Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '14rem' }} placeholder="optional" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        <div className="form-row">
          <label>Frequency</label>
          <select value={freq} onChange={e => setFreq(e.target.value as Frequency)}>
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div className="form-row">
          <label>From</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="form-row">
          <label>To</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      {generated.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.4rem' }}>
            <strong>{selected.length} of {generated.length} dates selected</strong>
            {amount && <span className="muted">= {fmtAud(totalCents)} total</span>}
            <button type="button" style={{ fontSize: '0.8rem' }}
              onClick={() => setChecked(Object.fromEntries(generated.map(d => [d, true])))}>
              Select all
            </button>
            <button type="button" style={{ fontSize: '0.8rem' }}
              onClick={() => setChecked(Object.fromEntries(generated.map(d => [d, false])))}>
              Clear all
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.2rem' }}>
            {generated.map(d => (
              <label key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={checked[d] ?? true}
                  onChange={e => setChecked(prev => ({ ...prev, [d]: e.target.checked }))} />
                {d}
              </label>
            ))}
          </div>
        </div>
      )}

      {generated.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <button type="submit" disabled={saving || selected.length === 0}>
            {saving ? 'Saving…' : `Add ${selected.length} entr${selected.length === 1 ? 'y' : 'ies'}`}
          </button>
        </div>
      )}
    </form>
  );
}

// ── Add transaction form (single entry) ───────────────────────────────────────

function AddTransactionForm({ propertyId, fyId, onAdded }: {
  propertyId: number; fyId: number; onAdded: (tx: RentalTransaction) => void;
}) {
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('rent');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !amount) return;
    setSaving(true);
    setError(null);
    try {
      const tx = await api.createRentalTransaction(propertyId, {
        fy_id: fyId,
        tx_date: date,
        category,
        amount_cents: Math.round(parseFloat(amount) * 100),
        notes: notes || null,
      });
      onAdded(tx);
      setDate(''); setAmount(''); setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="inline-form">
      {error && <div className="error">{error}</div>}
      <div className="form-row">
        <label>Date *</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
      </div>
      <div className="form-row">
        <label>Type *</label>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          <optgroup label="── Income ──">
            {INCOME_CATS.map(c => <option key={c} value={c}>{LABELS[c]}</option>)}
          </optgroup>
          <optgroup label="── Expenses ──">
            {EXPENSE_CATS.map(c => <option key={c} value={c}>{LABELS[c]}</option>)}
          </optgroup>
        </select>
      </div>
      <div className="form-row">
        <label>Amount ($) *</label>
        <input type="number" min="0" step="0.01" value={amount}
          onChange={e => setAmount(e.target.value)} required style={{ width: '9rem' }} />
      </div>
      <div className="form-row">
        <label>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '18rem' }} placeholder="optional" />
      </div>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add entry'}</button>
    </form>
  );
}

// ── Transaction list ──────────────────────────────────────────────────────────

function TxTable({ txs, propertyId, onDeleted }: {
  txs: RentalTransaction[]; propertyId: number; onDeleted: (id: number) => void;
}) {
  if (txs.length === 0) return <p className="muted">None yet.</p>;
  return (
    <table>
      <thead>
        <tr><th>Date</th><th>Type</th><th className="num">Amount</th><th>Notes</th><th /></tr>
      </thead>
      <tbody>
        {txs.map(tx => (
          <tr key={tx.id}>
            <td>{tx.tx_date}</td>
            <td>{LABELS[tx.category] ?? tx.category}</td>
            <td className="num">{fmtAud(tx.amount_cents)}</td>
            <td className="muted">{tx.notes}</td>
            <td>
              <button style={{ color: 'var(--bad)' }} onClick={async () => {
                try { await api.deleteRentalTransaction(propertyId, tx.id); onDeleted(tx.id); }
                catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); }
              }}>Delete</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Add Div 40 asset ──────────────────────────────────────────────────────────

function AddAssetForm({ propertyId, onAdded }: { propertyId: number; onAdded: (a: DepreciationAsset) => void }) {
  const [desc, setDesc] = useState('');
  const [cost, setCost] = useState('');
  const [startDate, setStartDate] = useState('');
  const [method, setMethod] = useState<'prime_cost' | 'diminishing_value'>('prime_cost');
  const [life, setLife] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const a = await api.createDepreciationAsset(propertyId, {
        description: desc, cost_cents: Math.round(parseFloat(cost) * 100),
        start_date: startDate, method, effective_life_years: parseFloat(life),
      });
      onAdded(a); setDesc(''); setCost(''); setStartDate(''); setLife('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="inline-form" style={{ marginTop: '0.75rem' }}>
      {error && <div className="error">{error}</div>}
      <div className="form-row"><label>Item *</label>
        <input value={desc} onChange={e => setDesc(e.target.value)} required placeholder="e.g. Hot water system" style={{ width: '16rem' }} /></div>
      <div className="form-row"><label>Cost ($) *</label>
        <input type="number" min="0" step="0.01" value={cost} onChange={e => setCost(e.target.value)} required style={{ width: '9rem' }} /></div>
      <div className="form-row"><label>First use date *</label>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required /></div>
      <div className="form-row"><label>Method</label>
        <select value={method} onChange={e => setMethod(e.target.value as typeof method)}>
          <option value="prime_cost">Prime cost</option>
          <option value="diminishing_value">Diminishing value</option>
        </select></div>
      <div className="form-row"><label>Effective life (years) *</label>
        <input type="number" min="1" step="0.5" value={life} onChange={e => setLife(e.target.value)} required style={{ width: '7rem' }} /></div>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add item'}</button>
    </form>
  );
}

// ── Add Div 43 building allowance ─────────────────────────────────────────────

function AddAllowanceForm({ propertyId, onAdded }: { propertyId: number; onAdded: (a: BuildingAllowance) => void }) {
  const [desc, setDesc] = useState('Building allowance');
  const [cost, setCost] = useState('');
  const [date, setDate] = useState('');
  const [rate, setRate] = useState('2.5');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const a = await api.createBuildingAllowance(propertyId, {
        description: desc, construction_cost_cents: Math.round(parseFloat(cost) * 100),
        completion_date: date, rate: parseFloat(rate) / 100,
      });
      onAdded(a); setCost(''); setDate('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="inline-form" style={{ marginTop: '0.75rem' }}>
      {error && <div className="error">{error}</div>}
      <div className="form-row"><label>Description</label>
        <input value={desc} onChange={e => setDesc(e.target.value)} style={{ width: '16rem' }} /></div>
      <div className="form-row"><label>Construction cost ($) *</label>
        <input type="number" min="0" step="0.01" value={cost} onChange={e => setCost(e.target.value)} required style={{ width: '9rem' }} /></div>
      <div className="form-row"><label>Construction completed *</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} required /></div>
      <div className="form-row"><label>Rate (%)</label>
        <input type="number" min="0" max="100" step="0.5" value={rate} onChange={e => setRate(e.target.value)} style={{ width: '7rem' }} />
        <span className="muted" style={{ marginLeft: '0.5rem' }}>2.5% standard, 4% pre-1987</span></div>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add allowance'}</button>
    </form>
  );
}

// ── Depreciation dollar input (upserts a single 'depreciation' transaction) ──

function DepreciationInput({ propertyId, fyId, fyEndDate, existing, onChanged }: {
  propertyId: number;
  fyId: number;
  fyEndDate: string;
  existing: RentalTransaction | null;
  onChanged: (tx: RentalTransaction | null) => void;
}) {
  const [amount, setAmount] = useState(existing ? String(existing.amount_cents / 100) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    setSaving(true); setError(null);
    try {
      if (existing) await api.deleteRentalTransaction(propertyId, existing.id);
      const tx = await api.createRentalTransaction(propertyId, {
        fy_id: fyId, tx_date: fyEndDate, category: 'depreciation',
        amount_cents: Math.round(parseFloat(amount) * 100), notes: null,
      });
      onChanged(tx);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!existing) return;
    setSaving(true);
    try {
      await api.deleteRentalTransaction(propertyId, existing.id);
      setAmount('');
      onChanged(null);
    } catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} className="inline-form">
      {error && <div className="error">{error}</div>}
      <div className="form-row">
        <label>Annual depreciation ($)</label>
        <input type="number" min="0" step="0.01" value={amount}
          onChange={e => setAmount(e.target.value)}
          style={{ width: '10rem' }} placeholder="0.00" />
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={saving || !amount}>
          {saving ? 'Saving…' : existing ? 'Update' : 'Save'}
        </button>
        {existing && (
          <button type="button" onClick={remove} disabled={saving} style={{ color: 'var(--bad)' }}>
            Remove
          </button>
        )}
      </div>
      {existing && (
        <p className="muted" style={{ marginTop: '0.4rem' }}>
          Currently set to {fmtAud(existing.amount_cents)} for FY {fyId}.
        </p>
      )}
    </form>
  );
}

// ── Sale / CGT form ───────────────────────────────────────────────────────────

function SaleForm({ property, onUpdated }: { property: Property; onUpdated: (p: Property) => void }) {
  const [soldDate, setSoldDate] = useState(property.sold_date ?? '');
  const [proceeds, setProceeds] = useState(property.sale_proceeds_cents ? String(property.sale_proceeds_cents / 100) : '');
  const [sellingCosts, setSellingCosts] = useState(property.selling_costs_cents ? String(property.selling_costs_cents / 100) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const p = await api.updateProperty(property.id, {
        sold_date: soldDate || null,
        sale_proceeds_cents: proceeds ? Math.round(parseFloat(proceeds) * 100) : null,
        selling_costs_cents: sellingCosts ? Math.round(parseFloat(sellingCosts) * 100) : 0,
      });
      onUpdated(p);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="inline-form">
      {error && <div className="error">{error}</div>}
      <div className="form-row"><label>Sale date</label>
        <input type="date" value={soldDate} onChange={e => setSoldDate(e.target.value)} /></div>
      <div className="form-row"><label>Sale proceeds ($)</label>
        <input type="number" min="0" step="0.01" value={proceeds} onChange={e => setProceeds(e.target.value)} style={{ width: '10rem' }} /></div>
      <div className="form-row"><label>Selling costs ($)</label>
        <input type="number" min="0" step="0.01" value={sellingCosts} onChange={e => setSellingCosts(e.target.value)} style={{ width: '10rem' }} placeholder="agent commission, legals" /></div>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save sale details'}</button>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const propertyId = Number(id);
  const { selected } = useFy();

  const [property, setProperty] = useState<Property | null>(null);
  const [summary, setSummary] = useState<PropertySummary | null>(null);
  const [txs, setTxs] = useState<RentalTransaction[]>([]);
  const [assets, setAssets] = useState<DepreciationAsset[]>([]);
  const [allowances, setAllowances] = useState<BuildingAllowance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<'single' | 'bulk'>('single');

  async function load() {
    if (!selected || !propertyId) return;
    setLoading(true); setError(null);
    try {
      const [props, summ, t, a, b] = await Promise.all([
        api.listProperties(),
        api.propertySummary(propertyId, selected.id),
        api.listRentalTransactions(propertyId, selected.id),
        api.listDepreciationAssets(propertyId),
        api.listBuildingAllowances(propertyId),
      ]);
      setProperty(props.find(p => p.id === propertyId) ?? null);
      setSummary(summ); setTxs(t); setAssets(a); setAllowances(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [propertyId, selected?.id]);

  async function refreshSummary() {
    if (!selected) return;
    const [summ, t] = await Promise.all([
      api.propertySummary(propertyId, selected.id),
      api.listRentalTransactions(propertyId, selected.id),
    ]).catch(() => [null, null]);
    if (summ) setSummary(summ as PropertySummary);
    if (t) setTxs(t as RentalTransaction[]);
  }

  async function refreshDepreciation() {
    if (!selected) return;
    const [a, b, summ] = await Promise.all([
      api.listDepreciationAssets(propertyId),
      api.listBuildingAllowances(propertyId),
      api.propertySummary(propertyId, selected.id),
    ]).catch(() => [null, null, null]);
    if (a) setAssets(a as DepreciationAsset[]);
    if (b) setAllowances(b as BuildingAllowance[]);
    if (summ) setSummary(summ as PropertySummary);
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <div className="error">{error}</div>;
  if (!property || !selected) return <div className="error">Property not found.</div>;

  const income = txs.filter(t => isIncome(t.category));
  const expenses = txs.filter(t => !isIncome(t.category));
  const net = summary?.ownership_adjusted_net_cents ?? 0;

  return (
    <div>
      <p><Link to="/property">← All properties</Link></p>
      <h2>{property.address}</h2>
      {property.ownership_percent !== 100 && <p className="muted">{property.ownership_percent}% owned</p>}
      {property.sold_date && <p style={{ color: 'var(--warn)' }}>Sold {property.sold_date}</p>}

      {/* ── FY net summary banner ── */}
      {summary && (
        <div className="section" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <div><span className="muted">Income</span><br /><strong>{fmtAud(summary.income_cents)}</strong></div>
          <div><span className="muted">Expenses</span><br /><strong>({fmtAud(summary.total_expenses_cents)})</strong></div>
          <div><span className="muted">Depreciation</span><br /><strong>({fmtAud(summary.depreciation.total_cents)})</strong></div>
          <div><span className="muted">Net (FY {selected.label})</span><br />
            <strong style={{ color: net < 0 ? 'var(--bad)' : net > 0 ? 'var(--good)' : undefined }}>
              {fmtAud(net)}{net < 0 ? ' (negatively geared)' : ''}
            </strong>
          </div>
        </div>
      )}

      {/* ── Add income / expense ── */}
      <section className="section">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>Add income or expense</h3>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button type="button"
              style={{ background: addMode === 'single' ? 'var(--accent)' : undefined, color: addMode === 'single' ? '#fff' : undefined }}
              onClick={() => setAddMode('single')}>Single entry</button>
            <button type="button"
              style={{ background: addMode === 'bulk' ? 'var(--accent)' : undefined, color: addMode === 'bulk' ? '#fff' : undefined }}
              onClick={() => setAddMode('bulk')}>Bulk / recurring</button>
          </div>
        </div>
        {addMode === 'single' ? (
          <AddTransactionForm propertyId={propertyId} fyId={selected.id} onAdded={tx => {
            setTxs(prev => [...prev, tx]);
            void refreshSummary();
          }} />
        ) : (
          <BulkTransactionForm propertyId={propertyId} fyId={selected.id} onAdded={newTxs => {
            setTxs(prev => [...prev, ...newTxs]);
            void refreshSummary();
          }} />
        )}
      </section>

      {/* ── Income list ── */}
      <section className="section">
        <h3>Income — FY {selected.label}</h3>
        <TxTable txs={income} propertyId={propertyId} onDeleted={tid => {
          setTxs(prev => prev.filter(t => t.id !== tid));
          void refreshSummary();
        }} />
      </section>

      {/* ── Expenses list ── */}
      <section className="section">
        <h3>Expenses — FY {selected.label}</h3>
        <TxTable txs={expenses} propertyId={propertyId} onDeleted={tid => {
          setTxs(prev => prev.filter(t => t.id !== tid));
          void refreshSummary();
        }} />
      </section>

      {/* ── Depreciation ── */}
      <section className="section">
        <h3>Depreciation — FY {selected.label}</h3>
        <p className="muted" style={{ marginTop: 0 }}>Enter the annual depreciation amount from your quantity surveyor report.</p>
        <DepreciationInput
          propertyId={propertyId}
          fyId={selected.id}
          fyEndDate={selected.end_date}
          existing={txs.find(t => t.category === 'depreciation') ?? null}
          onChanged={tx => {
            setTxs(prev => [...prev.filter(t => t.category !== 'depreciation'), ...(tx ? [tx] : [])]);
            void refreshSummary();
          }}
        />
      </section>

      {/* ── Sale / CGT ── */}
      <section className="section">
        <h3>Sale &amp; CGT</h3>
        {summary?.cgt ? (
          <table>
            <tbody>
              <tr><td>Cost base</td><td className="num">{fmtAud(summary.cgt.cost_base_cents)}</td></tr>
              <tr><td>Sale proceeds</td><td className="num">{fmtAud(summary.cgt.proceeds_cents)}</td></tr>
              <tr><td>Selling costs</td><td className="num">({fmtAud(summary.cgt.selling_costs_cents)})</td></tr>
              <tr><td>Gross gain</td><td className="num">{fmtAud(summary.cgt.gross_gain_cents)}</td></tr>
              {summary.cgt.eligible_for_discount && (
                <tr><td>After 50% CGT discount</td><td className="num">{fmtAud(summary.cgt.discounted_gain_cents)}</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <p className="muted">No sale recorded. Fill in the form below if you have sold or plan to sell this property.</p>
        )}
        <SaleForm property={property} onUpdated={p => { setProperty(p); void load(); }} />
      </section>
    </div>
  );
}
