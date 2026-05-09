import { useState } from 'react';
import { api, type RentalTransaction } from '../../../lib/api.js';
import { fmtAud } from '../../../lib/format.js';

const INCOME_CATEGORIES = ['rent', 'bond_forfeited', 'other_income'] as const;
const EXPENSE_CATEGORIES = [
  'interest', 'council_rates', 'water_rates', 'land_tax', 'insurance',
  'body_corporate', 'agent_fees', 'repairs_maintenance', 'advertising',
  'pest_control', 'gardening_cleaning', 'accounting', 'other_expense',
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent', bond_forfeited: 'Bond forfeited', other_income: 'Other income',
  interest: 'Interest on loan', council_rates: 'Council rates', water_rates: 'Water rates',
  land_tax: 'Land tax', insurance: 'Insurance', body_corporate: 'Body corporate fees',
  agent_fees: 'Agent fees', repairs_maintenance: 'Repairs & maintenance',
  advertising: 'Advertising', pest_control: 'Pest control',
  gardening_cleaning: 'Gardening & cleaning', accounting: 'Accounting fees',
  other_expense: 'Other expense',
};

interface Props {
  propertyId: number;
  fyId: number;
  transactions: RentalTransaction[];
  onChanged: () => void;
}

function AddTransactionForm({ propertyId, fyId, onAdded }: {
  propertyId: number;
  fyId: number;
  onAdded: (tx: RentalTransaction) => void;
}) {
  const [txDate, setTxDate] = useState('');
  const [category, setCategory] = useState<string>('rent');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!txDate || !amount) return;
    setSaving(true);
    setError(null);
    try {
      const tx = await api.createRentalTransaction(propertyId, {
        fy_id: fyId,
        tx_date: txDate,
        category,
        amount_cents: Math.round(parseFloat(amount) * 100),
        notes: notes || null,
      });
      onAdded(tx);
      setTxDate(''); setAmount(''); setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="inline-form">
      <h4>Add transaction</h4>
      {error && <div className="error">{error}</div>}
      <div className="form-row">
        <label>Date *</label>
        <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} required />
      </div>
      <div className="form-row">
        <label>Category *</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <optgroup label="Income">
            {INCOME_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </optgroup>
          <optgroup label="Expenses">
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </optgroup>
        </select>
      </div>
      <div className="form-row">
        <label>Amount ($) *</label>
        <input type="number" min="0" step="0.01" value={amount}
          onChange={(e) => setAmount(e.target.value)} required style={{ width: '8rem' }} />
      </div>
      <div className="form-row">
        <label>Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '18rem' }} />
      </div>
      <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add'}</button>
    </form>
  );
}

export function TransactionsTab({ propertyId, fyId, transactions, onChanged }: Props) {
  const [localTxs, setLocalTxs] = useState<RentalTransaction[]>(transactions);

  // Sync when parent reloads
  useState(() => { setLocalTxs(transactions); });

  function handleAdded(tx: RentalTransaction) {
    setLocalTxs((prev) => [...prev, tx]);
    onChanged();
  }

  async function handleDelete(txId: number) {
    try {
      await api.deleteRentalTransaction(propertyId, txId);
      setLocalTxs((prev) => prev.filter((t) => t.id !== txId));
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const income = localTxs.filter((t) => (INCOME_CATEGORIES as readonly string[]).includes(t.category));
  const expenses = localTxs.filter((t) => (EXPENSE_CATEGORIES as readonly string[]).includes(t.category));

  return (
    <div>
      <h3>Income & Expenses</h3>

      <h4>Income</h4>
      {income.length === 0 ? (
        <p className="muted">No income transactions this FY.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Date</th><th>Category</th><th className="num">Amount</th><th>Notes</th><th /></tr>
          </thead>
          <tbody>
            {income.map((tx) => (
              <tr key={tx.id}>
                <td>{tx.tx_date}</td>
                <td>{CATEGORY_LABELS[tx.category] ?? tx.category}</td>
                <td className="num">{fmtAud(tx.amount_cents)}</td>
                <td>{tx.notes}</td>
                <td>
                  <button onClick={() => void handleDelete(tx.id)} style={{ color: 'var(--bad)' }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 style={{ marginTop: '1.5rem' }}>Expenses</h4>
      {expenses.length === 0 ? (
        <p className="muted">No expense transactions this FY.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Date</th><th>Category</th><th className="num">Amount</th><th>Notes</th><th /></tr>
          </thead>
          <tbody>
            {expenses.map((tx) => (
              <tr key={tx.id}>
                <td>{tx.tx_date}</td>
                <td>{CATEGORY_LABELS[tx.category] ?? tx.category}</td>
                <td className="num">({fmtAud(tx.amount_cents)})</td>
                <td>{tx.notes}</td>
                <td>
                  <button onClick={() => void handleDelete(tx.id)} style={{ color: 'var(--bad)' }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="section" style={{ marginTop: '1.5rem' }}>
        <AddTransactionForm propertyId={propertyId} fyId={fyId} onAdded={handleAdded} />
      </section>
    </div>
  );
}
