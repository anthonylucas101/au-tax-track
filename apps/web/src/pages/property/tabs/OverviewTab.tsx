import { type PropertySummary } from '../../../lib/api.js';
import { fmtAud } from '../../../lib/format.js';

const EXPENSE_LABELS: Record<string, string> = {
  interest: 'Interest on loan',
  council_rates: 'Council rates',
  water_rates: 'Water rates',
  land_tax: 'Land tax',
  insurance: 'Insurance',
  body_corporate: 'Body corporate fees',
  agent_fees: 'Agent fees (mgmt/letting)',
  repairs_maintenance: 'Repairs & maintenance',
  advertising: 'Advertising',
  pest_control: 'Pest control',
  gardening_cleaning: 'Gardening & cleaning',
  accounting: 'Accounting fees',
  other_expense: 'Other expense',
};

const INCOME_LABELS: Record<string, string> = {
  rent: 'Rent',
  bond_forfeited: 'Bond forfeited',
  other_income: 'Other income',
};

interface Props {
  summary: PropertySummary;
  fyLabel: string;
}

export function OverviewTab({ summary, fyLabel }: Props) {
  const { net_rental_income_cents: net, ownership_adjusted_net_cents: adjNet } = summary;
  const isNegGear = adjNet < 0;

  const incomeCategories = Object.entries(summary.expenses_by_category)
    .filter(([cat]) => cat in INCOME_LABELS && summary.expenses_by_category[cat] !== undefined);

  const expenseRows = Object.entries(EXPENSE_LABELS)
    .map(([cat, label]) => ({ cat, label, amount: summary.expenses_by_category[cat] ?? 0 }))
    .filter((row) => row.amount > 0);

  return (
    <div>
      <h3>Summary — FY {fyLabel}</h3>
      <table>
        <tbody>
          <tr>
            <td colSpan={2} style={{ fontWeight: 600, paddingTop: '0.75rem' }}>Income</td>
          </tr>
          {Object.entries(INCOME_LABELS).map(([cat, label]) => {
            const amt = summary.expenses_by_category[cat] ?? 0;
            if (amt === 0) return null;
            return (
              <tr key={cat}>
                <td style={{ paddingLeft: '1rem' }}>{label}</td>
                <td className="num">{fmtAud(amt)}</td>
              </tr>
            );
          })}
          <tr style={{ fontWeight: 600 }}>
            <td>Total income</td>
            <td className="num">{fmtAud(summary.income_cents)}</td>
          </tr>

          <tr>
            <td colSpan={2} style={{ fontWeight: 600, paddingTop: '0.75rem' }}>Expenses</td>
          </tr>
          {expenseRows.map(({ cat, label, amount }) => (
            <tr key={cat}>
              <td style={{ paddingLeft: '1rem' }}>{label}</td>
              <td className="num">({fmtAud(amount)})</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 600 }}>
            <td>Total expenses</td>
            <td className="num">({fmtAud(summary.total_expenses_cents)})</td>
          </tr>

          <tr>
            <td colSpan={2} style={{ fontWeight: 600, paddingTop: '0.75rem' }}>Depreciation</td>
          </tr>
          {summary.depreciation.div40.filter((a) => a.deduction_cents > 0).map((a) => (
            <tr key={a.asset_id}>
              <td style={{ paddingLeft: '1rem' }}>
                {a.description} <span className="muted">({a.method === 'prime_cost' ? 'PC' : 'DV'})</span>
              </td>
              <td className="num">({fmtAud(a.deduction_cents)})</td>
            </tr>
          ))}
          {summary.depreciation.div43.filter((b) => b.deduction_cents > 0).map((b) => (
            <tr key={b.allowance_id}>
              <td style={{ paddingLeft: '1rem' }}>{b.description} <span className="muted">(Div 43)</span></td>
              <td className="num">({fmtAud(b.deduction_cents)})</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 600 }}>
            <td>Total depreciation</td>
            <td className="num">({fmtAud(summary.depreciation.total_cents)})</td>
          </tr>

          <tr style={{ fontWeight: 700, fontSize: '1.05rem', borderTop: '2px solid #ccc' }}>
            <td>Net rental income</td>
            <td className="num">{fmtAud(net)}</td>
          </tr>
          {summary.property.ownership_percent !== 100 && (
            <tr style={{ fontWeight: 700, fontSize: '1.05rem' }}>
              <td>
                Ownership-adjusted net ({summary.property.ownership_percent}%)
              </td>
              <td
                className="num"
                style={{ color: isNegGear ? 'var(--bad)' : 'var(--good)' }}
              >
                {fmtAud(adjNet)}
              </td>
            </tr>
          )}
          {summary.property.ownership_percent === 100 && (
            <tr>
              <td />
              <td
                className="num"
                style={{ color: isNegGear ? 'var(--bad)' : 'var(--good)', fontStyle: 'italic', fontSize: '0.9rem' }}
              >
                {isNegGear ? 'Negatively geared' : 'Positively geared'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
