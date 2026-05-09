import { useState } from 'react';
import { api, type Property, type PropertySummary } from '../../../lib/api.js';
import { fmtAud } from '../../../lib/format.js';

interface Props {
  property: Property;
  summary: PropertySummary | null;
  onUpdated: (p: Property) => void;
}

export function SaleCgtTab({ property, summary, onUpdated }: Props) {
  const [soldDate, setSoldDate] = useState(property.sold_date ?? '');
  const [proceeds, setProceeds] = useState(
    property.sale_proceeds_cents != null ? String(property.sale_proceeds_cents / 100) : '',
  );
  const [sellingCosts, setSellingCosts] = useState(
    property.selling_costs_cents > 0 ? String(property.selling_costs_cents / 100) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateProperty(property.id, {
        sold_date: soldDate || null,
        sale_proceeds_cents: proceeds ? Math.round(parseFloat(proceeds) * 100) : null,
        selling_costs_cents: sellingCosts ? Math.round(parseFloat(sellingCosts) * 100) : 0,
      });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const cgt = summary?.cgt ?? null;

  return (
    <div>
      <h3>Sale & CGT</h3>

      <form onSubmit={handleSave} className="inline-form">
        {error && <div className="error">{error}</div>}
        <div className="form-row">
          <label>Sold date</label>
          <input type="date" value={soldDate} onChange={(e) => setSoldDate(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Gross sale proceeds ($)</label>
          <input type="number" min="0" step="0.01" value={proceeds}
            onChange={(e) => setProceeds(e.target.value)} style={{ width: '10rem' }} />
        </div>
        <div className="form-row">
          <label>Selling costs ($) <span className="muted">(agent commission, legals)</span></label>
          <input type="number" min="0" step="0.01" value={sellingCosts}
            onChange={(e) => setSellingCosts(e.target.value)} style={{ width: '10rem' }} />
        </div>
        <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save sale details'}</button>
      </form>

      {cgt && (
        <div style={{ marginTop: '1.5rem' }}>
          <h4>CGT estimate</h4>
          <table>
            <tbody>
              <tr>
                <td>Sale proceeds</td>
                <td className="num">{fmtAud(cgt.proceeds_cents)}</td>
              </tr>
              <tr>
                <td>Cost base (acquisition cost + selling costs)</td>
                <td className="num">({fmtAud(cgt.cost_base_cents)})</td>
              </tr>
              <tr style={{ fontWeight: 600 }}>
                <td>Gross capital gain</td>
                <td className="num" style={{ color: cgt.gross_gain_cents < 0 ? 'var(--bad)' : 'var(--good)' }}>
                  {fmtAud(cgt.gross_gain_cents)}
                </td>
              </tr>
              <tr>
                <td>50% CGT discount eligible?</td>
                <td>{cgt.eligible_for_discount ? 'Yes (held > 12 months)' : 'No (held ≤ 12 months)'}</td>
              </tr>
              {cgt.gross_gain_cents > 0 && (
                <tr style={{ fontWeight: 700 }}>
                  <td>Taxable gain (after discount if eligible)</td>
                  <td className="num" style={{ color: 'var(--good)' }}>
                    {fmtAud(cgt.discounted_gain_cents)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
            Note: cost base above uses acquisition cost + selling costs only. It does not yet
            deduct depreciation claimed (cost base reduction per s110-55 ITAA 1997) — consult your
            tax agent for the exact cost base.
          </p>
        </div>
      )}

      {!property.sold_date && (
        <p className="muted" style={{ marginTop: '1rem' }}>
          Enter a sold date and proceeds above to see CGT estimate.
        </p>
      )}
    </div>
  );
}
