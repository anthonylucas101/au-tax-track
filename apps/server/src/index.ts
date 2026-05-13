import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { db, getDbPath } from './db/index.js';
import { seed } from './db/seed.js';
import { financialYearsRoute } from './routes/financialYears.js';
import { employersRoute } from './routes/employers.js';
import { payslipsRoute } from './routes/payslips.js';
import { taxEstimateRoute } from './routes/taxEstimate.js';
import { securitiesRoute } from './routes/securities.js';
import { shareTradesRoute } from './routes/shareTrades.js';
import { dividendsRoute } from './routes/dividends.js';
import { holdingsRoute } from './routes/holdings.js';
import { cgtRoute } from './routes/cgt.js';
import { importStakeRoute } from './routes/importStake.js';
import { propertiesRoute } from './routes/properties.js';
import { exportRoute } from './routes/export.js';
import { deductionsRoute } from './routes/deductions.js';

seed(db);

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true, db: getDbPath() }));

app.route('/api/financial-years', financialYearsRoute);
app.route('/api/employers', employersRoute);
app.route('/api/payslips', payslipsRoute);
app.route('/api/tax-estimate', taxEstimateRoute);
app.route('/api/securities', securitiesRoute);
app.route('/api/share-trades', shareTradesRoute);
app.route('/api/dividends', dividendsRoute);
app.route('/api/holdings', holdingsRoute);
app.route('/api/cgt', cgtRoute);
app.route('/api/import/stake', importStakeRoute);
app.route('/api/properties', propertiesRoute);
app.route('/api/export', exportRoute);
app.route('/api/deductions', deductionsRoute);

app.onError((err, c) => {
  console.error('[server] error:', err);
  return c.json({ error: err.message ?? 'Internal error' }, 500);
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] AU Tax Tracker API listening on http://localhost:${info.port}`);
  console.log(`[server] DB: ${getDbPath()}`);
});

