import { useCallback, useEffect, useState } from 'react';
import { useFy } from '../lib/fyContext.js';
import { api } from '../lib/api.js';
import { fmtAud } from '../lib/format.js';

// ATO 2024-25 cents-per-km rate for D1 car (up to 5,000 km)
const CAR_RATE_CPK = 0.88;

interface Category {
  key: string;
  label: string;
  ato: string;
  hint: string;
}

const CATEGORIES: Category[] = [
  { key: 'car',               label: 'Work-related car expenses',            ato: 'D1', hint: '88c/km (2024-25) × work km, or logbook method' },
  { key: 'travel',            label: 'Work-related travel',                  ato: 'D2', hint: 'Fares, accommodation for work travel (not car)' },
  { key: 'clothing',          label: 'Clothing, laundry & dry-cleaning',     ato: 'D3', hint: 'Uniforms, protective clothing, occupation-specific clothing' },
  { key: 'self_education',    label: 'Self-education',                       ato: 'D4', hint: 'Course fees, textbooks, travel to study' },
  { key: 'home_office_other', label: 'Home office & other work expenses',    ato: 'D5', hint: '67c/hr fixed rate, or phone, internet, tools, stationery' },
  { key: 'gifts_donations',   label: 'Gifts & donations',                    ato: 'D9', hint: 'Donations to DGR-registered charities' },
  { key: 'tax_agent',         label: 'Tax agent / accounting fees',          ato: 'D10', hint: 'Fees for preparing and lodging this tax return' },
  { key: 'income_protection', label: 'Income protection insurance',          ato: 'D14', hint: 'Premiums for policies covering lost income (not life/trauma)' },
];

// ── Car km calculator ────────────────────────────────────────────────────────
function CarKmHelper({ onUse }: { onUse: (cents: number) => void }) {
  const [km, setKm] = useState('');
  const cents = Math.round((parseFloat(km) || 0) * CAR_RATE_CPK * 100);
  const capped = Math.min(parseFloat(km) || 0, 5000);
  const cappedCents = Math.round(capped * CAR_RATE_CPK * 100);

  return (
    <div className="km-helper">
      <span className="km-helper-label">km calculator:</span>
      <input
        type="number"
        min="0"
        step="1"
        value={km}
        onChange={(e) => setKm(e.target.value)}
        placeholder="km driven"
        style={{ width: '7rem' }}
      />
      <span className="muted" style={{ fontSize: '0.8rem' }}>
        × 88c = {fmtAud(cents)}
        {(parseFloat(km) || 0) > 5000 && (
          <> <span style={{ color: 'var(--warn)' }}>(capped at 5,000 km → {fmtAud(cappedCents)})</span></>
        )}
      </span>
      {cents > 0 && (
        <button type="button" onClick={() => onUse(cappedCents)} style={{ fontSize: '0.78rem' }}>
          Use {fmtAud(cappedCents)}
        </button>
      )}
    </div>
  );
}

// ── Home office hours calculator ─────────────────────────────────────────────
function HomeOfficeHelper({ onUse }: { onUse: (cents: number) => void }) {
  const [hours, setHours] = useState('');
  const cents = Math.round((parseFloat(hours) || 0) * 0.67 * 100);

  return (
    <div className="km-helper">
      <span className="km-helper-label">hours calculator:</span>
      <input
        type="number"
        min="0"
        step="0.5"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        placeholder="hrs worked at home"
        style={{ width: '9rem' }}
      />
      <span className="muted" style={{ fontSize: '0.8rem' }}>× 67c = {fmtAud(cents)}</span>
      {cents > 0 && (
        <button type="button" onClick={() => onUse(cents)} style={{ fontSize: '0.78rem' }}>
          Use {fmtAud(cents)}
        </button>
      )}
    </div>
  );
}

// ── Single deduction row ──────────────────────────────────────────────────────
function DeductionRow({
  cat,
  initialCents,
  fyId,
  onSaved,
}: {
  cat: Category;
  initialCents: number;
  fyId: number;
  onSaved: (cents: number) => void;
}) {
  const [dollars, setDollars] = useState(initialCents > 0 ? (initialCents / 100).toFixed(2) : '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setAmount(cents: number) {
    setDollars((cents / 100).toFixed(2));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const cents = Math.round((parseFloat(dollars) || 0) * 100);
      await api.upsertDeduction({ fy_id: fyId, category: cat.key, amount_cents: cents });
      setDirty(false);
      onSaved(cents);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="deduction-row">
      <div className="deduction-meta">
        <span className="deduction-ato">{cat.ato}</span>
        <div>
          <div className="deduction-label">{cat.label}</div>
          <div className="deduction-hint">{cat.hint}</div>
        </div>
      </div>
      <div className="deduction-input-row">
        <span className="deduction-dollar">$</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={dollars}
          placeholder="0.00"
          onChange={(e) => { setDollars(e.target.value); setDirty(true); }}
          style={{ width: '8rem' }}
        />
        {dirty && (
          <button type="button" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {!dirty && initialCents > 0 && (
          <span className="deduction-saved">✓ saved</span>
        )}
        {err && <span className="error" style={{ fontSize: '0.8rem' }}>{err}</span>}
      </div>
      {cat.key === 'car' && <CarKmHelper onUse={setAmount} />}
      {cat.key === 'home_office_other' && <HomeOfficeHelper onUse={setAmount} />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function DeductionsPage() {
  const { selected } = useFy();
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [hasHecs, setHasHecs] = useState(false);
  const [hasPhi, setHasPhi] = useState(false);
  const [receivedIncomeSupport, setReceivedIncomeSupport] = useState(false);
  const [salarySacrifice, setSalarySacrifice] = useState('');
  const [salarySacrificeDirty, setSalarySacrificeDirty] = useState(false);
  const [salarySacrificeSaving, setSalarySacrificeSaving] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (fyId: number) => {
    setLoading(true);
    try {
      const data = await api.getDeductions(fyId);
      const map: Record<string, number> = {};
      for (const item of data.items) map[item.category] = item.amount_cents;
      setAmounts(map);
      setHasHecs(data.has_hecs);
      setHasPhi(data.has_phi);
      setReceivedIncomeSupport(data.received_income_support);
      setSalarySacrifice(data.salary_sacrifice_super_cents > 0 ? (data.salary_sacrifice_super_cents / 100).toFixed(2) : '');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    void reload(selected.id);
  }, [selected?.id, reload]);

  async function patchSettings(patch: { has_hecs?: boolean; has_phi?: boolean; salary_sacrifice_super_cents?: number; received_income_support?: boolean }) {
    if (!selected) return;
    setSettingsLoading(true);
    try {
      await api.updateTaxSettings(selected.id, patch);
      if (patch.has_hecs !== undefined) setHasHecs(patch.has_hecs);
      if (patch.has_phi !== undefined) setHasPhi(patch.has_phi);
      if (patch.received_income_support !== undefined) setReceivedIncomeSupport(patch.received_income_support);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveSalarySacrifice() {
    if (!selected) return;
    setSalarySacrificeSaving(true);
    try {
      const cents = Math.round((parseFloat(salarySacrifice) || 0) * 100);
      await api.updateTaxSettings(selected.id, { salary_sacrifice_super_cents: cents });
      setSalarySacrificeDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSalarySacrificeSaving(false);
    }
  }

  const totalCents = Object.values(amounts).reduce((s, v) => s + v, 0);

  if (!selected) return <p className="muted">Loading financial year…</p>;

  return (
    <div>
      <h2>Deductions — FY {selected.label}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Amounts entered here reduce your taxable income in the tax estimate.
      </p>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      {/* Medicare & Super settings */}
      <section className="section">
        <h3>Medicare &amp; Superannuation</h3>

        <label className="hecs-toggle" style={{ marginBottom: '0.75rem' }}>
          <input
            type="checkbox"
            checked={hasPhi}
            disabled={settingsLoading}
            onChange={(e) => void patchSettings({ has_phi: e.target.checked })}
          />
          <span>
            I have private hospital cover (PHI)
            <span className="muted" style={{ marginLeft: '0.5rem', fontWeight: 400 }}>
              — exempts you from the Medicare Levy Surcharge
            </span>
          </span>
        </label>
        {!hasPhi && (
          <p className="muted" style={{ fontSize: '0.82rem', margin: '0 0 0.75rem 1.6rem' }}>
            Without hospital cover: MLS of 1.0–1.5% applies on top of the 2% Medicare levy
            once income exceeds $93,000 (2024-25).
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.9rem', fontWeight: 500 }}>
            Salary sacrifice super (above SGC) ($)
          </label>
          <input
            type="number" min="0" step="0.01"
            value={salarySacrifice}
            placeholder="0.00"
            style={{ width: '9rem' }}
            onChange={(e) => { setSalarySacrifice(e.target.value); setSalarySacrificeDirty(true); }}
          />
          {salarySacrificeDirty && (
            <button type="button" onClick={saveSalarySacrifice} disabled={salarySacrificeSaving}>
              {salarySacrificeSaving ? 'Saving…' : 'Save'}
            </button>
          )}
          {!salarySacrificeDirty && parseFloat(salarySacrifice) > 0 && (
            <span className="deduction-saved">✓ saved</span>
          )}
        </div>
        <p className="muted" style={{ fontSize: '0.82rem', margin: '0.35rem 0 0' }}>
          Used for Division 293 tax (extra 15% on super when income + super &gt; $250,000).
          Employer SGC is pulled from your payslips automatically.
        </p>
      </section>

      {/* HECS/HELP toggle */}
      <section className="section">
        <h3>HECS / HELP debt</h3>
        <label className="hecs-toggle">
          <input
            type="checkbox"
            checked={hasHecs}
            disabled={settingsLoading}
            onChange={(e) => void patchSettings({ has_hecs: e.target.checked })}
          />
          <span>
            I have an outstanding HECS-HELP debt this FY
            <span className="muted" style={{ marginLeft: '0.5rem', fontWeight: 400 }}>
              (compulsory repayment will be added to your balance owing)
            </span>
          </span>
        </label>
        {hasHecs && (
          <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
            Repayment = ATO 2024-25 rate × repayment income. Verify with your HELP statement.
            Repayment income = taxable income (simplified; excludes reportable fringe benefits).
          </p>
        )}
      </section>

      {/* Income support (CGT min-tax exemption) */}
      <section className="section">
        <h3>Government income support</h3>
        <label className="hecs-toggle">
          <input
            type="checkbox"
            checked={receivedIncomeSupport}
            disabled={settingsLoading}
            onChange={(e) => void patchSettings({ received_income_support: e.target.checked })}
          />
          <span>
            I received means-tested income support this FY
            <span className="muted" style={{ marginLeft: '0.5rem', fontWeight: 400 }}>
              (Age Pension, JobSeeker, Parenting Payment, etc.)
            </span>
          </span>
        </label>
        {receivedIncomeSupport && (
          <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
            Exempts you from the 30% CGT minimum tax on real capital gains from 1 July 2027.
          </p>
        )}
      </section>

      {/* Deduction categories */}
      <section className="section">
        <h3>Work-related &amp; other deductions</h3>
        <div className="deductions-list">
          {CATEGORIES.map((cat) => (
            <DeductionRow
              key={cat.key}
              cat={cat}
              initialCents={amounts[cat.key] ?? 0}
              fyId={selected.id}
              onSaved={(cents) => setAmounts((prev) => ({ ...prev, [cat.key]: cents }))}
            />
          ))}
        </div>

        {totalCents > 0 && (
          <div className="deduction-total">
            <span>Total deductions</span>
            <strong>{fmtAud(totalCents)}</strong>
          </div>
        )}
      </section>

      <p className="disclaimer">
        Deductions must be directly related to earning your income. Keep receipts.
        The ATO may disallow claims without evidence. Not tax advice.
      </p>
    </div>
  );
}
