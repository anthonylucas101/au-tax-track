import { useEffect, useState } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { useFy } from '../lib/fyContext.js';
import { api, type TaxEstimate } from '../lib/api.js';
import { fmtAud } from '../lib/format.js';

// ── palette ──────────────────────────────────────────────────────────────────
const C_SALARY   = '#0b5fff';
const C_DIVS     = '#7c3aed';
const C_RENTAL   = '#0891b2';
const C_CGT      = '#d97706';
const C_GROSS    = '#b3261e';
const C_MEDICARE = '#e05a00';
const C_LITO     = '#1f7a3a';
const C_FRANKING = '#166534';
const C_FITO     = '#047857';
const C_INCOME   = '#0b5fff';
const C_EXPENSE  = '#b3261e';
const C_NET_POS  = '#1f7a3a';
const C_NET_NEG  = '#b3261e';

function cents(n: number) { return fmtAud(Math.abs(n)); }
function pct(n: number, d: number) {
  if (d === 0) return '0%';
  return `${((n / d) * 100).toFixed(1)}%`;
}

// Short address for chart labels
function shortAddress(addr: string) {
  const parts = addr.split(',');
  return parts[0]?.trim() ?? addr;
}

// ── tooltip formatter ─────────────────────────────────────────────────────────
function AudTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #d0d0d0', borderRadius: 6, padding: '0.5rem 0.75rem', fontSize: 13 }}>
      {label && <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>}
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {fmtAud(Math.abs(p.value))}
          {p.value < 0 ? ' (loss)' : ''}
        </div>
      ))}
    </div>
  );
}

// ── 1. Income sources donut ───────────────────────────────────────────────────
function IncomeDonut({ e }: { e: TaxEstimate }) {
  const salary   = e.gross_cents + e.allowances_cents;
  const auDivs   = e.dividend_totals.au_total_cents + e.dividend_totals.franking_credits_cents;
  const forDivs  = e.dividend_totals.foreign_total_cents;
  const cgt      = Math.max(0, e.cgt.discounted_net_gain_cents);
  const rental   = Math.max(0, e.rental.total_net_cents);

  const data = [
    { name: 'Salary',           value: salary,  fill: C_SALARY  },
    { name: 'AU Dividends',     value: auDivs,  fill: C_DIVS    },
    { name: 'Foreign Divs',     value: forDivs, fill: C_RENTAL  },
    { name: 'Capital Gains',    value: cgt,     fill: C_CGT     },
    { name: 'Net Rental',       value: rental,  fill: C_INCOME  },
  ].filter((d) => d.value > 0);

  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0) return <p className="muted">No income data for this FY.</p>;

  return (
    <div className="dash-chart-card">
      <h4>Income sources</h4>
      <p className="dash-chart-sub">{fmtAud(total)} taxable income</p>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={100}
            paddingAngle={2}
          >
            {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
          </Pie>
          <Tooltip
            formatter={(val) => [fmtAud(Number(val)), '']}
            contentStyle={{ fontSize: 13 }}
          />
          <Legend
            formatter={(value, entry) => {
              const item = data.find((d) => d.name === value);
              return `${value} (${pct(item?.value ?? 0, total)})`;
            }}
            wrapperStyle={{ fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 2. Rental P&L bar ─────────────────────────────────────────────────────────
function RentalBar({ e }: { e: TaxEstimate }) {
  const { properties } = e.rental;
  if (properties.length === 0) return <p className="muted">No rental properties this FY.</p>;

  const data = properties.map((p) => ({
    name: shortAddress(p.address),
    Income: p.income_cents / 100,
    Expenses: -(p.expense_cents / 100),
    Net: p.net_cents / 100,
  }));

  return (
    <div className="dash-chart-card">
      <h4>Rental property P&amp;L</h4>
      <p className="dash-chart-sub">
        Net: {e.rental.total_net_cents < 0
          ? <span style={{ color: C_NET_NEG }}>{fmtAud(Math.abs(e.rental.total_net_cents))} loss (negative gearing)</span>
          : <span style={{ color: C_NET_POS }}>{fmtAud(e.rental.total_net_cents)} profit</span>}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v) => `$${Math.abs(v).toLocaleString()}`} tick={{ fontSize: 11 }} />
          <Tooltip content={<AudTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0} stroke="#d0d0d0" />
          <Bar dataKey="Income"   fill={C_INCOME}  radius={[3, 3, 0, 0]} name="Income" />
          <Bar dataKey="Expenses" fill={C_EXPENSE} radius={[3, 3, 0, 0]} name="Expenses" />
          <Bar dataKey="Net"      radius={[3, 3, 0, 0]} name="Net"
            fill={e.rental.total_net_cents >= 0 ? C_NET_POS : C_NET_NEG}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 3. Tax breakdown stacked bar ──────────────────────────────────────────────
function TaxBreakdown({ e }: { e: TaxEstimate }) {
  const gross    = e.income_tax_cents + e.medicare_levy_cents;
  const offsets  = e.lito_cents + e.franking_credits_cents + e.fito_cents + e.tax_withheld_cents;
  const final    = e.estimated_tax_payable_cents;

  const data = [
    {
      name: 'Gross tax',
      'Income tax':    e.income_tax_cents / 100,
      'Medicare levy': e.medicare_levy_cents / 100,
    },
    {
      name: 'Offsets',
      'LITO':              -(e.lito_cents / 100),
      'Franking credits':  -(e.franking_credits_cents / 100),
      'FITO':              -(e.fito_cents / 100),
      'PAYG withheld':     -(e.tax_withheld_cents / 100),
    },
    {
      name: 'Tax payable',
      'Tax payable': final / 100,
    },
  ];

  if (gross === 0) return <p className="muted">No tax data for this FY.</p>;

  const effectiveRate = e.taxable_income_cents > 0
    ? ((e.estimated_tax_payable_cents / e.taxable_income_cents) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="dash-chart-card">
      <h4>Tax breakdown</h4>
      <p className="dash-chart-sub">Effective rate: {effectiveRate}%</p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v) => `$${Math.abs(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(val) => [fmtAud(Math.abs(Number(val) * 100)), '']}
            contentStyle={{ fontSize: 13 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0} stroke="#d0d0d0" />
          <Bar dataKey="Income tax"       stackId="a" fill={C_GROSS}    />
          <Bar dataKey="Medicare levy"    stackId="a" fill={C_MEDICARE} radius={[3, 3, 0, 0]} />
          <Bar dataKey="LITO"             stackId="b" fill={C_LITO}     />
          <Bar dataKey="Franking credits" stackId="b" fill={C_FRANKING} />
          <Bar dataKey="FITO"             stackId="b" fill={C_FITO}     />
          <Bar dataKey="PAYG withheld"    stackId="b" fill="#2d6a4f"    radius={[3, 3, 0, 0]} />
          <Bar dataKey="Tax payable"      fill={final >= 0 ? C_GROSS : C_NET_POS} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 4. Effective tax rate card ────────────────────────────────────────────────
function TaxRateCard({ e }: { e: TaxEstimate }) {
  const effectivePct = e.taxable_income_cents > 0
    ? (e.estimated_tax_payable_cents / e.taxable_income_cents) * 100
    : 0;

  const marginalRate = (() => {
    const applied = e.bracket_breakdown.filter((b) => b.applied);
    if (applied.length === 0) return 0;
    return (applied[applied.length - 1]?.marginal_rate ?? 0) * 100;
  })();

  const barWidth = Math.min(effectivePct / marginalRate, 1) * 100;

  return (
    <div className="dash-chart-card">
      <h4>Effective tax rate</h4>
      <p className="dash-chart-sub">vs top marginal rate</p>
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem', fontSize: 13 }}>
          <span>Effective rate</span>
          <strong style={{ color: C_GROSS }}>{effectivePct.toFixed(1)}%</strong>
        </div>
        <div style={{ background: '#f0f0f0', borderRadius: 6, height: 14, overflow: 'hidden', marginBottom: '1rem' }}>
          <div style={{ width: `${barWidth}%`, background: C_GROSS, height: '100%', borderRadius: 6, transition: 'width 0.4s' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem', fontSize: 13 }}>
          <span>Marginal rate</span>
          <strong style={{ color: C_MEDICARE }}>{marginalRate.toFixed(0)}%</strong>
        </div>
        <div style={{ background: '#f0f0f0', borderRadius: 6, height: 14, marginBottom: '1.5rem' }}>
          <div style={{ width: '100%', background: C_MEDICARE, height: '100%', borderRadius: 6 }} />
        </div>

        <div style={{ fontSize: 13, color: '#6a6a6a', lineHeight: 1.6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Taxable income</span><span>{fmtAud(e.taxable_income_cents)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Income tax + Medicare</span><span>{fmtAud(e.income_tax_cents + e.medicare_levy_cents)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Total offsets</span>
            <span style={{ color: C_NET_POS }}>
              −{fmtAud(e.lito_cents + e.franking_credits_cents + e.fito_cents)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #d0d0d0' }}>
            <span>{e.refund_or_bill_cents >= 0 ? 'Estimated refund' : 'Balance owing'}</span>
            <span style={{ color: e.refund_or_bill_cents >= 0 ? C_NET_POS : C_GROSS }}>
              {e.refund_or_bill_cents >= 0 ? '+' : '−'}{cents(e.refund_or_bill_cents)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
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
          {/* Stat cards */}
          <div className="cards">
            <div className="card">
              <div className="label">Gross income</div>
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
                {estimate.refund_or_bill_cents >= 0 ? 'Estimated refund' : 'Balance owing'}
              </div>
              <div className="value">{fmtAud(Math.abs(estimate.refund_or_bill_cents))}</div>
            </div>
          </div>

          {/* Charts grid */}
          <div className="dash-charts">
            <IncomeDonut e={estimate} />
            <TaxRateCard e={estimate} />
            <RentalBar e={estimate} />
            <TaxBreakdown e={estimate} />
          </div>
        </>
      )}

      <p className="disclaimer">
        Estimates use ATO resident tax rates for FY 2024-25 and 2025-26. Not tax advice. Verify before lodging.
      </p>
    </div>
  );
}
