import { Navigate, Route, Routes } from 'react-router-dom';
import { Nav } from './components/Nav.js';
import { FyProvider, useFy } from './lib/fyContext.js';
import { DashboardPage } from './pages/Dashboard.js';
import { SalaryPage } from './pages/Salary.js';
import { TaxEstimatePage } from './pages/TaxEstimate.js';
import { HoldingsPage } from './pages/investments/Holdings.js';
import { TradesPage } from './pages/investments/Trades.js';
import { DividendsPage } from './pages/investments/Dividends.js';
import { ImportPage } from './pages/investments/Import.js';
import { CgtPage } from './pages/investments/Cgt.js';
import { PropertiesPage } from './pages/property/Properties.js';
import { PropertyDetailPage } from './pages/property/PropertyDetail.js';
import { ExportPage } from './pages/Export.js';
import { DeductionsPage } from './pages/Deductions.js';

function Body() {
  const { error, loading, selected } = useFy();
  return (
    <main className="app-main">
      {error && <div className="error">Failed to load app data: {error}. Is the server running on :3000?</div>}
      {loading && !selected && <p className="muted">Loading...</p>}
      {!loading && (
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/salary" element={<SalaryPage />} />
          <Route path="/tax-estimate" element={<TaxEstimatePage />} />
          <Route path="/investments" element={<Navigate to="/investments/holdings" replace />} />
          <Route path="/investments/holdings" element={<HoldingsPage />} />
          <Route path="/investments/trades" element={<TradesPage />} />
          <Route path="/investments/dividends" element={<DividendsPage />} />
          <Route path="/investments/import" element={<ImportPage />} />
          <Route path="/investments/cgt" element={<CgtPage />} />
          <Route path="/property" element={<PropertiesPage />} />
          <Route path="/property/:id" element={<PropertyDetailPage />} />
          <Route path="/deductions" element={<DeductionsPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      )}
    </main>
  );
}

export function App() {
  return (
    <FyProvider>
      <div className="app-shell">
        <Nav />
        <Body />
      </div>
    </FyProvider>
  );
}

