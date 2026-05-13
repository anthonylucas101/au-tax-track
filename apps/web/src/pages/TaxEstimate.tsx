import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFy } from '../lib/fyContext.js';
import { api, type TaxEstimate } from '../lib/api.js';
import { fmtAud } from '../lib/format.js';

export function TaxEstimatePage() {
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
      <h2>Tax Estimate — FY {selected.label}</h2>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}
      {estimate && (
        <>
          <section className="section">
            <h3>Line-item breakdown</h3>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Amount</th>
                  <th>Formula / source</th>
                </tr>
              </thead>
              <tbody>
                {estimate.lines.map((line, idx) => (
                  <tr key={idx}>
                    <td>{line.label}</td>
                    <td className="num">{fmtAud(line.amount_cents)}</td>
                    <td className="formula">{line.formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="section">
            <h3>Resident tax brackets applied for FY {selected.label}</h3>
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">Marginal rate</th>
                  <th className="num">Base tax at lower bound</th>
                  <th>Applied?</th>
                </tr>
              </thead>
              <tbody>
                {estimate.bracket_breakdown.map((b, idx) => (
                  <tr key={idx} style={b.applied ? { background: '#e8f5ee' } : undefined}>
                    <td className="num">{fmtAud(b.threshold_from_cents)}</td>
                    <td className="num">{b.threshold_to_cents === null ? '—' : fmtAud(b.threshold_to_cents)}</td>
                    <td className="num">{(b.marginal_rate * 100).toFixed(2)}%</td>
                    <td className="num">{fmtAud(b.base_tax_cents)}</td>
                    <td>{b.applied ? `yes — taxed ${fmtAud(b.taxable_in_bracket_cents)} above threshold` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {(estimate.dividend_totals.au_total_cents > 0 || estimate.dividend_totals.foreign_total_cents > 0) && (
            <section className="section">
              <h3>Dividend breakdown</h3>
              <table>
                <tbody>
                  <tr>
                    <td>AU dividends (unfranked + franked)</td>
                    <td className="num">{fmtAud(estimate.dividend_totals.unfranked_cents + estimate.dividend_totals.franked_cents)}</td>
                  </tr>
                  <tr>
                    <td>AU franking credits (gross-up)</td>
                    <td className="num">{fmtAud(estimate.dividend_totals.franking_credits_cents)}</td>
                  </tr>
                  <tr>
                    <td>Foreign dividends (AUD)</td>
                    <td className="num">{fmtAud(estimate.dividend_totals.foreign_total_cents)}</td>
                  </tr>
                  <tr>
                    <td>Foreign withholding tax (FITO offset)</td>
                    <td className="num">{fmtAud(estimate.dividend_totals.withholding_tax_cents)}</td>
                  </tr>
                  <tr style={{ fontWeight: 600 }}>
                    <td>Total dividend income incl gross-up</td>
                    <td className="num">{fmtAud(
                      estimate.dividend_totals.unfranked_cents +
                      estimate.dividend_totals.franked_cents +
                      estimate.dividend_totals.franking_credits_cents +
                      estimate.dividend_totals.foreign_total_cents
                    )}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          <section className="section">
            <h3>Capital gains (FY {selected.label})</h3>
            <table>
              <tbody>
                <tr><td>Total capital gains</td><td className="num">{fmtAud(estimate.cgt.total_gain_cents)}</td></tr>
                <tr><td>Total capital losses</td><td className="num">{fmtAud(estimate.cgt.total_loss_cents)}</td></tr>
                <tr><td>Net capital gains</td><td className="num">{fmtAud(estimate.cgt.net_gain_cents)}</td></tr>
                <tr><td>Pre-1 Jul 2027 gains after 50% discount (added to taxable income)</td><td className="num">{fmtAud(estimate.cgt.discounted_net_gain_cents)}</td></tr>
                {estimate.cgt.new_regime_net_gain_cents > 0 && (
                  <tr>
                    <td>
                      Post-1 Jul 2027 gains — CPI-indexed real gain (added to taxable income)
                      <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.82rem' }}>2026-27 Budget Reform</span>
                    </td>
                    <td className="num">{fmtAud(estimate.cgt.new_regime_net_gain_cents)}</td>
                  </tr>
                )}
                {estimate.cgt_min_tax_cents > 0 && (
                  <tr style={{ color: 'var(--bad)' }}>
                    <td>
                      30% CGT minimum tax top-up
                      {estimate.received_income_support && (
                        <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.82rem' }}>(exempt — income support)</span>
                      )}
                    </td>
                    <td className="num">{fmtAud(estimate.cgt_min_tax_cents)}</td>
                  </tr>
                )}
                {estimate.cgt.loss_carryforward_cents > 0 && (
                  <tr>
                    <td>
                      Carry-forward losses{' '}
                      <span className="muted" style={{ fontSize: '0.82rem' }}>
                        (these losses exceed gains this FY and carry forward to future years)
                      </span>
                    </td>
                    <td className="num" style={{ color: 'var(--bad)' }}>{fmtAud(estimate.cgt.loss_carryforward_cents)}</td>
                  </tr>
                )}
                <tr><td>CGT events counted</td><td className="num">{estimate.cgt.event_count}</td></tr>
                <tr>
                  <td>
                    Orphan sells
                    {estimate.cgt.orphan_count > 0 && (
                      <>{' '}<Link to="/investments/cgt" style={{ fontSize: '0.85rem' }}>→ view details</Link></>
                    )}
                  </td>
                  <td className="num" style={estimate.cgt.orphan_count > 0 ? { color: 'var(--warn)' } : undefined}>
                    {estimate.cgt.orphan_count}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {estimate.rental.properties.length > 0 && (
            <section className="section">
              <h3>Rental properties (FY {selected.label})</h3>
              <table>
                <thead>
                  <tr>
                    <th>Property</th>
                    <th className="num">Net income</th>
                    <th className="num">Ownership-adjusted net</th>
                    {estimate.rental.reform_applies && <th>NG status</th>}
                  </tr>
                </thead>
                <tbody>
                  {estimate.rental.properties.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/property/${p.id}`}>{p.address}</Link>
                      </td>
                      <td className="num" style={{ color: p.net_cents < 0 ? 'var(--bad)' : undefined }}>
                        {fmtAud(p.net_cents)}
                      </td>
                      <td className="num" style={{ color: p.ownership_adjusted_net_cents < 0 ? 'var(--bad)' : undefined }}>
                        {fmtAud(p.ownership_adjusted_net_cents)}
                      </td>
                      {estimate.rental.reform_applies && (
                        <td className="muted" style={{ fontSize: '0.82rem' }}>{p.ng_status.replace(/_/g, ' ')}</td>
                      )}
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, borderTop: '2px solid #ccc' }}>
                    <td>
                      {estimate.rental.total_net_cents < 0
                        ? 'Negative gearing offset (reduces taxable income)'
                        : 'Net rental income (adds to taxable income)'}
                    </td>
                    <td />
                    <td
                      className="num"
                      style={{ color: estimate.rental.total_net_cents < 0 ? 'var(--bad)' : 'var(--good)' }}
                    >
                      {fmtAud(estimate.rental.total_net_cents)}
                    </td>
                    {estimate.rental.reform_applies && <td />}
                  </tr>
                  {estimate.rental.reform_applies && (
                    <>
                      {estimate.rental.general_offset_net_cents !== estimate.rental.total_net_cents && (
                        <tr>
                          <td className="muted" style={{ fontSize: '0.85rem' }}>
                            Of which: grandfathered / transitional / new-build (offsets taxable income)
                          </td>
                          <td />
                          <td className="num muted" style={{ fontSize: '0.85rem' }}>{fmtAud(estimate.rental.general_offset_net_cents)}</td>
                          <td />
                        </tr>
                      )}
                      {estimate.rental.quarantined_net_cents < 0 && (
                        <tr style={{ color: 'var(--warn)' }}>
                          <td style={{ fontSize: '0.85rem' }}>
                            Quarantined loss (restricted properties — does not reduce taxable income)
                          </td>
                          <td />
                          <td className="num" style={{ fontSize: '0.85rem' }}>{fmtAud(estimate.rental.quarantined_net_cents)}</td>
                          <td />
                        </tr>
                      )}
                      {estimate.rental.carry_forward_applied_cents > 0 && (
                        <tr style={{ color: 'var(--good)' }}>
                          <td style={{ fontSize: '0.85rem' }}>
                            Prior-year carry-forward losses applied against restricted-property income
                          </td>
                          <td />
                          <td className="num" style={{ fontSize: '0.85rem' }}>{fmtAud(estimate.rental.carry_forward_applied_cents)}</td>
                          <td />
                        </tr>
                      )}
                      {estimate.rental.new_carry_forward_cents > 0 && (
                        <tr className="muted">
                          <td style={{ fontSize: '0.85rem' }}>
                            Accumulated carry-forward losses at end of FY (available next year)
                          </td>
                          <td />
                          <td className="num" style={{ fontSize: '0.85rem' }}>{fmtAud(estimate.rental.new_carry_forward_cents)}</td>
                          <td />
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </section>
          )}

          <section className="section">
            <h3>Configuration</h3>
            <table>
              <tbody>
                <tr><td>Medicare levy rate</td><td className="num">{(estimate.config.medicare_levy_rate * 100).toFixed(2)}%</td></tr>
                <tr><td>LITO max</td><td className="num">{fmtAud(estimate.config.lito_max_cents)}</td></tr>
                <tr><td>LITO taper 1 starts at</td><td className="num">{fmtAud(estimate.config.lito_taper1_threshold_cents)} ({(estimate.config.lito_taper1_rate * 100).toFixed(2)}%)</td></tr>
                <tr><td>LITO taper 2 starts at</td><td className="num">{fmtAud(estimate.config.lito_taper2_threshold_cents)} ({(estimate.config.lito_taper2_rate * 100).toFixed(2)}%)</td></tr>
              </tbody>
            </table>
          </section>

          <p className="disclaimer">
            ATO resident rates seeded for FY 2024-25 and 2025-26. Phase 1 has no deductions, no Medicare low-income reduction,
            no HELP/HECS, no PHI, and no offsets beyond LITO. Verify all figures before lodging.
          </p>
        </>
      )}
    </div>
  );
}
