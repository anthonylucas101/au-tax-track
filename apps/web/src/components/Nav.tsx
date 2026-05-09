import { NavLink } from 'react-router-dom';
import { useFy } from '../lib/fyContext.js';

export function Nav() {
  const { years, selected, selectByLabel, loading } = useFy();

  return (
    <header className="app-nav">
      <h1>AU Tax Tracker</h1>
      <nav>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/salary">Salary</NavLink>
        <NavLink to="/tax-estimate">Tax Estimate</NavLink>
        <span className="nav-group">Investments</span>
        <NavLink to="/investments/holdings" className="nav-sub-link">Holdings</NavLink>
        <NavLink to="/investments/trades" className="nav-sub-link">Trades</NavLink>
        <NavLink to="/investments/dividends" className="nav-sub-link">Dividends</NavLink>
        <NavLink to="/investments/import" className="nav-sub-link">Import</NavLink>
        <NavLink to="/investments/cgt" className="nav-sub-link">CGT</NavLink>
        <span className="disabled">Crypto <span className="coming-soon">(coming soon)</span></span>
        <span className="nav-group">Property</span>
        <NavLink to="/property" className="nav-sub-link">Properties</NavLink>
        <NavLink to="/export">Export</NavLink>
      </nav>
      <div className="fy-select">
        <label htmlFor="fy">FY:</label>
        <select
          id="fy"
          value={selected?.label ?? ''}
          disabled={loading || years.length === 0}
          onChange={(e) => selectByLabel(e.target.value)}
        >
          {years.map((y) => (
            <option key={y.id} value={y.label}>{y.label}</option>
          ))}
        </select>
      </div>
    </header>
  );
}

