import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { cryptoTradesRepo } from '../db/repos/cryptoTrades.js';
import { cryptoAssetsRepo } from '../db/repos/cryptoAssets.js';
import { financialYearsRepo } from '../db/repos/financialYears.js';
import { dollarsToCents } from '../lib/money.js';

export const cryptoTradesRoute = new Hono();

const query = z.object({ fyId: z.coerce.number().int().positive() });

cryptoTradesRoute.get('/', zValidator('query', query), (c) => {
  const { fyId } = c.req.valid('query');
  return c.json(cryptoTradesRepo.listByFy(fyId));
});

const createBody = z.object({
  symbol:         z.string().min(1).max(20).toUpperCase(),
  trade_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  side:           z.enum(['buy', 'sell']),
  units:          z.number().positive(),
  aud_value:      z.number().nonnegative(),
  notes:          z.string().optional(),
});

cryptoTradesRoute.post('/', zValidator('json', createBody), (c) => {
  const body = c.req.valid('json');

  const fy = financialYearsRepo.findByDate(body.trade_date);
  if (!fy) return c.json({ error: `No financial year covers ${body.trade_date}` }, 400);

  const asset = cryptoAssetsRepo.upsert(body.symbol, null);
  const id = cryptoTradesRepo.insert({
    asset_id: asset.id,
    fy_id: fy.id,
    trade_date: body.trade_date,
    side: body.side,
    units: body.units,
    aud_value_cents: dollarsToCents(String(body.aud_value)),
    fee_cents: 0,
    notes: body.notes ?? null,
    external_id: null,
  });

  return c.json({ id }, 201);
});

cryptoTradesRoute.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  cryptoTradesRepo.delete(id);
  return c.json({ ok: true });
});
