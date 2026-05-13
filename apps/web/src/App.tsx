import '@mantine/core/styles.css';
import {
  MantineProvider, AppShell, createTheme,
  localStorageColorSchemeManager,
} from '@mantine/core';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Nav } from './components/Nav.js';
import { AppHeader } from './components/AppHeader.js';
import { FyProvider } from './lib/fyContext.js';
import { DashboardPage } from './pages/Dashboard.js';
import { SalaryPage } from './pages/Salary.js';
import { TaxEstimatePage } from './pages/TaxEstimate.js';
import { HoldingsPage } from './pages/investments/Holdings.js';
import { TradesPage } from './pages/investments/Trades.js';
import { DividendsPage } from './pages/investments/Dividends.js';
import { ImportPage, CryptoImportPage } from './pages/investments/Import.js';
import { CgtPage } from './pages/investments/Cgt.js';
import { CryptoCgtPage } from './pages/investments/CryptoCgt.js';
import { CryptoTradesPage } from './pages/investments/CryptoTrades.js';
import { PropertiesPage } from './pages/property/Properties.js';
import { PropertyDetailPage } from './pages/property/PropertyDetail.js';
import { ExportPage } from './pages/Export.js';
import { DeductionsPage } from './pages/Deductions.js';

const colorSchemeManager = localStorageColorSchemeManager({ key: 'au-tax-color-scheme' });

const theme = createTheme({
  primaryColor: 'indigo',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  defaultRadius: 'md',
});

export function App() {
  return (
    <MantineProvider theme={theme} colorSchemeManager={colorSchemeManager} defaultColorScheme="light">
      <FyProvider>
        <AppShell
          header={{ height: 52 }}
          navbar={{ width: 220, breakpoint: 'sm' }}
          padding="lg"
        >
          <AppHeader />
          <Nav />
          <AppShell.Main>
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
              <Route path="/investments/crypto-import" element={<CryptoImportPage />} />
              <Route path="/investments/crypto-cgt" element={<CryptoCgtPage />} />
              <Route path="/investments/crypto-trades" element={<CryptoTradesPage />} />
              <Route path="/property" element={<PropertiesPage />} />
              <Route path="/property/:id" element={<PropertyDetailPage />} />
              <Route path="/deductions" element={<DeductionsPage />} />
              <Route path="/export" element={<ExportPage />} />
              <Route path="*" element={<DashboardPage />} />
            </Routes>
          </AppShell.Main>
        </AppShell>
      </FyProvider>
    </MantineProvider>
  );
}
