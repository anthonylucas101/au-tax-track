import { useEffect, useState } from 'react';
import { useFy } from '../lib/fyContext.js';
import { api, type TaxEstimate } from '../lib/api.js';
import { fmtAud } from '../lib/format.js';

export function DashboardPage() {
  const { selected } = useFy();
  const [estimate, setEstimate] = useState<TaxEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    api
      .taxEstimate(selected.id)
      .then((r) => { if (!cancelled) { setEstimate(r); setError(null); } })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  if (!selected) return <p className="muted">Loading financial year...</p>;

  return (
    <div>
      <h2>Dashboard — FY {selected.label}</h2>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}
      {estimate && (
        <>
          <div className="cards">
            <div className="card">
              <div className="label">Gross income (FY-to-date)</div>
              <div className="value">{fmtAud(estimate.gross_cents)}</div>
            </div>
            <div className="card">
              <div className="label">Tax withheld (PAYG)</div>
              <div className="value">{fmtAud(estimate.tax_withheld_cents)}</div>
            </div>
            <div className="card">
              <div className="label">Estimated tax payable</div>
              <div className="value">{fmtAud(estimate.estimated_tax_payable_cents)}</div>
            </div>
            <div className={`card ${estimate.refund_or_bill_cents >= 0 ? 'good' : 'bad'}`}>
              <div className="label">
                {estimate.refund_or_bill_cents >= 0 ? 'Estimated refund' : 'Estimated balance owing'}
              </div>
              <div className="value">{fmtAud(Math.abs(estimate.refund_or_bill_cents))}</div>
            </div>
          </div>
          <p className="muted">
            Based on {estimate.payslip_count} payslip(s) entered. Phase 1 has no deductions yet.
          </p>
        </>
      )}
      <p className="disclaimer">
        Estimates use ATO resident tax rates seeded for FY 2024-25 and 2025-26. Not tax advice. Verify before lodging.
      </p>
    </div>
  );
}
