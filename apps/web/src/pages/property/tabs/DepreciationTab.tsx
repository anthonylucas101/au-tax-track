import { useState } from 'react';
import { api, type DepreciationAsset, type BuildingAllowance, type DepreciationResult } from '../../../lib/api.js';
import { fmtAud } from '../../../lib/format.js';

interface Props {
  propertyId: number;
  assets: DepreciationAsset[];
  allowances: BuildingAllowance[];
  depreciationResult: DepreciationResult;
  onChanged: () => void;
}

function AddAssetForm({ propertyId, onAdded }: {
  propertyId: number;
  onAdded: (a: DepreciationAsset) => void;
}) {
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [startDate, setStartDate] = useState('');
  const [method, setMethod] = useState<'prime_cost' | 'diminishing_value'>('prime_cost');
  const [effectiveLife, setEffectiveLife] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const asset = await api.createDepreciationAsset(propertyId, {
        description,
        cost_cents: Math.round(parseFloat(cost) * 100),
        start_date: startDate,
        method,
        effective_life_years: parseFloat(effectiveLife),
        notes: notes || null,
      });
      onAdded(asset);
      setDescription(''); setCost(''); setStartDate(''); setEffectiveLife(''); setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="inline-form">
      <h4>Add Div 40 asset</h4>
      {error && <div className="error">{error}</div>}
      <div className="form-row"><label>Description *</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} required style={{ width: '18rem' }} />
      </div>
      <div className="form-row"><label>Cost ($) *</label>
        <input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} required style={{ width: '8rem' }} />
      </div>
      <div className="form-row"><label>First available date *</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
      </div>
      <div className="form-row"><label>Method *</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as 'prime_cost' | 'diminishing_value')}>
          <option value="prime_cost">Prime cost</option>
          <option value="diminishing_value">Diminishing value</option>
        </select>
      </div>
      <div className="form-row"><label>Effective life (years) *</label>
        <input type="number" min="0.5" step="0.5" value={effectiveLife}
          onChange={(e) => setEffectiveLife(e.target.value)} required style={{ width: '6rem' }} />
      </div>
      <div className="form-row"><label>Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '18rem' }} />
      </div>
      <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add asset'}</button>
    </form>
  );
}

function AddAllowanceForm({ propertyId, onAdded }: {
  propertyId: number;
  onAdded: (ba: BuildingAllowance) => void;
}) {
  const [description, setDescription] = useState('Building allowance');
  const [constructionCost, setConstructionCost] = useState('');
  const [completionDate, setCompletionDate] = useState('');
  const [rate, setRate] = useState('2.5');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const ba = await api.createBuildingAllowance(propertyId, {
        description,
        construction_cost_cents: Math.round(parseFloat(constructionCost) * 100),
        completion_date: completionDate,
        rate: parseFloat(rate) / 100,
        notes: notes || null,
      });
      onAdded(ba);
      setConstructionCost(''); setCompletionDate(''); setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="inline-form">
      <h4>Add Div 43 building allowance</h4>
      {error && <div className="error">{error}</div>}
      <div className="form-row"><label>Description</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '18rem' }} />
      </div>
      <div className="form-row"><label>Construction cost ($) *</label>
        <input type="number" min="0" step="0.01" value={constructionCost}
          onChange={(e) => setConstructionCost(e.target.value)} required style={{ width: '10rem' }} />
      </div>
      <div className="form-row"><label>Completion date *</label>
        <input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} required />
      </div>
      <div className="form-row"><label>Rate % (2.5 standard, 4 pre-1987)</label>
        <input type="number" min="0" max="100" step="0.1" value={rate}
          onChange={(e) => setRate(e.target.value)} style={{ width: '5rem' }} />
      </div>
      <div className="form-row"><label>Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '18rem' }} />
      </div>
      <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add allowance'}</button>
    </form>
  );
}

export function DepreciationTab({ propertyId, assets, allowances, depreciationResult, onChanged }: Props) {
  const [localAssets, setLocalAssets] = useState<DepreciationAsset[]>(assets);
  const [localAllowances, setLocalAllowances] = useState<BuildingAllowance[]>(allowances);

  async function handleDeleteAsset(assetId: number) {
    try {
      await api.deleteDepreciationAsset(propertyId, assetId);
      setLocalAssets((prev) => prev.filter((a) => a.id !== assetId));
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleDeleteAllowance(baId: number) {
    try {
      await api.deleteBuildingAllowance(propertyId, baId);
      setLocalAllowances((prev) => prev.filter((b) => b.id !== baId));
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const div40ByAsset = Object.fromEntries(
    depreciationResult.div40.map((d) => [d.asset_id, d.deduction_cents]),
  );
  const div43ByAllowance = Object.fromEntries(
    depreciationResult.div43.map((d) => [d.allowance_id, d.deduction_cents]),
  );

  return (
    <div>
      <h3>Depreciation</h3>

      <h4>Division 40 — Plant & Equipment</h4>
      {localAssets.length === 0 ? (
        <p className="muted">No assets yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Description</th><th className="num">Cost</th><th>Method</th>
              <th className="num">Life (yrs)</th><th>Start date</th>
              <th className="num">FY deduction</th><th />
            </tr>
          </thead>
          <tbody>
            {localAssets.map((a) => (
              <tr key={a.id}>
                <td>{a.description}</td>
                <td className="num">{fmtAud(a.cost_cents)}</td>
                <td>{a.method === 'prime_cost' ? 'Prime cost' : 'Diminishing value'}</td>
                <td className="num">{a.effective_life_years}</td>
                <td>{a.start_date}</td>
                <td className="num">{fmtAud(div40ByAsset[a.id] ?? 0)}</td>
                <td>
                  <button onClick={() => void handleDeleteAsset(a.id)} style={{ color: 'var(--bad)' }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="section" style={{ marginTop: '1rem' }}>
        <AddAssetForm propertyId={propertyId} onAdded={(a) => { setLocalAssets((p) => [...p, a]); onChanged(); }} />
      </section>

      <h4 style={{ marginTop: '2rem' }}>Division 43 — Building Allowance</h4>
      {localAllowances.length === 0 ? (
        <p className="muted">No building allowances yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Description</th><th className="num">Construction cost</th>
              <th>Completion date</th><th className="num">Rate</th>
              <th className="num">FY deduction</th><th />
            </tr>
          </thead>
          <tbody>
            {localAllowances.map((ba) => (
              <tr key={ba.id}>
                <td>{ba.description}</td>
                <td className="num">{fmtAud(ba.construction_cost_cents)}</td>
                <td>{ba.completion_date}</td>
                <td className="num">{(ba.rate * 100).toFixed(1)}%</td>
                <td className="num">{fmtAud(div43ByAllowance[ba.id] ?? 0)}</td>
                <td>
                  <button onClick={() => void handleDeleteAllowance(ba.id)} style={{ color: 'var(--bad)' }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="section" style={{ marginTop: '1rem' }}>
        <AddAllowanceForm
          propertyId={propertyId}
          onAdded={(ba) => { setLocalAllowances((p) => [...p, ba]); onChanged(); }}
        />
      </section>

      <div style={{ marginTop: '1rem', fontWeight: 600 }}>
        Total FY depreciation: {fmtAud(depreciationResult.total_cents)}
      </div>
    </div>
  );
}
