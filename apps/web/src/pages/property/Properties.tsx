import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFy } from '../../lib/fyContext.js';
import { api, type Property, type PropertySummary } from '../../lib/api.js';
import { fmtAud } from '../../lib/format.js';

interface SummaryCard {
  property: Property;
  summary: PropertySummary | null;
  error: string | null;
}

function AddPropertyForm({ onAdded }: { onAdded: (p: Property) => void }) {
  const [address, setAddress] = useState('');
  const [ownershipPct, setOwnershipPct] = useState('100');
  const [acquiredDate, setAcquiredDate] = useState('');
  const [acquisitionCost, setAcquisitionCost] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const prop = await api.createProperty({
        address: address.trim(),
        ownership_percent: parseFloat(ownershipPct) || 100,
        acquired_date: acquiredDate || null,
        acquisition_cost_cents: acquisitionCost
          ? Math.round(parseFloat(acquisitionCost) * 100)
          : null,
        notes: notes || null,
      });
      onAdded(prop);
      setAddress(''); setOwnershipPct('100'); setAcquiredDate('');
      setAcquisitionCost(''); setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add property');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="inline-form">
      <h3>Add property</h3>
      {error && <div className="error">{error}</div>}
      <div className="form-row">
        <label>Address *</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} required style={{ width: '22rem' }} />
      </div>
      <div className="form-row">
        <label>Ownership %</label>
        <input type="number" min="0" max="100" step="0.01" value={ownershipPct}
          onChange={(e) => setOwnershipPct(e.target.value)} style={{ width: '6rem' }} />
      </div>
      <div className="form-row">
        <label>Acquired date</label>
        <input type="date" value={acquiredDate} onChange={(e) => setAcquiredDate(e.target.value)} />
      </div>
      <div className="form-row">
        <label>Acquisition cost ($)</label>
        <input type="number" min="0" step="0.01" value={acquisitionCost}
          onChange={(e) => setAcquisitionCost(e.target.value)} style={{ width: '10rem' }}
          placeholder="incl. stamp duty, legals" />
      </div>
      <div className="form-row">
        <label>Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '22rem' }} />
      </div>
      <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add property'}</button>
    </form>
  );
}

export function PropertiesPage() {
  const { selected } = useFy();
  const [cards, setCards] = useState<SummaryCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProperties() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const props = await api.listProperties();
      const cardData: SummaryCard[] = await Promise.all(
        props.map(async (property) => {
          try {
            const summary = await api.propertySummary(property.id, selected.id);
            return { property, summary, error: null };
          } catch {
            return { property, summary: null, error: 'Could not load summary' };
          }
        }),
      );
      setCards(cardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadProperties(); }, [selected?.id]);

  function handleAdded(prop: Property) {
    if (!selected) return;
    api.propertySummary(prop.id, selected.id)
      .then((summary) => setCards((prev) => [...prev, { property: prop, summary, error: null }]))
      .catch(() => setCards((prev) => [...prev, { property: prop, summary: null, error: null }]));
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this property and all its data?')) return;
    try {
      await api.deleteProperty(id);
      setCards((prev) => prev.filter((c) => c.property.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  if (!selected) return <p className="muted">Loading financial year...</p>;

  return (
    <div>
      <h2>Rental Properties — FY {selected.label}</h2>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      {cards.length === 0 && !loading && (
        <p className="muted">No properties yet. Add one below.</p>
      )}

      {cards.map(({ property, summary }) => {
        const net = summary?.ownership_adjusted_net_cents ?? null;
        return (
          <div key={property.id} className="section" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong>
                  <Link to={`/property/${property.id}`}>{property.address}</Link>
                </strong>
                {property.ownership_percent !== 100 && (
                  <span className="muted" style={{ marginLeft: '0.5rem' }}>
                    ({property.ownership_percent}% owned)
                  </span>
                )}
                {property.sold_date && (
                  <span className="muted" style={{ marginLeft: '0.5rem' }}>SOLD {property.sold_date}</span>
                )}
              </div>
              <button onClick={() => void handleDelete(property.id)} style={{ color: 'var(--bad)' }}>
                Delete
              </button>
            </div>

            {summary && (
              <table style={{ marginTop: '0.5rem' }}>
                <tbody>
                  <tr>
                    <td>Gross income</td>
                    <td className="num">{fmtAud(summary.income_cents)}</td>
                  </tr>
                  <tr>
                    <td>Total expenses</td>
                    <td className="num">({fmtAud(summary.total_expenses_cents)})</td>
                  </tr>
                  <tr>
                    <td>Depreciation (Div 40 + 43)</td>
                    <td className="num">({fmtAud(summary.depreciation.total_cents)})</td>
                  </tr>
                  <tr style={{ fontWeight: 600 }}>
                    <td>Net rental income (ownership-adjusted)</td>
                    <td className="num" style={{ color: net !== null && net < 0 ? 'var(--bad)' : 'var(--good)' }}>
                      {net !== null ? fmtAud(net) : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            <p style={{ marginTop: '0.25rem' }}>
              <Link to={`/property/${property.id}`}>Open detail →</Link>
            </p>
          </div>
        );
      })}

      <section className="section">
        <AddPropertyForm onAdded={handleAdded} />
      </section>
    </div>
  );
}
