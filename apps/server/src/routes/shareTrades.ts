import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { shareTradesRepo } from '../db/repos/shareTrades.js';
import { securitiesRepo } from '../db/repos/securities.js';
import { financialYearsRepo } from '../db/repos/financialYears.js';

export const shareTradesRoute = new Hono();

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const listQuery = z.object({ fyId: z.coerce.number().int().positive() });
const idParam = z.object({ id: z.coerce.number().int().positive() });

const createSchema = z.object({
  ticker: z.string().min(1).max(20),
  trade_date: z.string().regex(dateRe),
  settlement_date: z.string().regex(dateRe).nullable().optional(),
  side: z.enum(['buy', 'sell']),
  units: z.number().positive(),
  price_cents: z.number().int().nonnegative(),
  brokerage_cents: z.number().int().nonnegative().default(0),
  gst_cents: z.number().int().nonnegative().default(0),
  currency: z.string().length(3).default('AUD'),
  aud_fx_rate: z.number().positive().nullable().optional(),
  is_opening: z.boolean().default(false),
  notes: z.string().max(1000).nullable().optional(),
  // Optional metadata to upsert security on first sight
  security_name: z.string().max(200).nullable().optional(),
  asset_type: z.enum(['share', 'etf']).default('share'),
  exchange: z.string().min(1).max(20).default('ASX'),
});

shareTradesRoute.get('/', zValidator('query', listQuery), (c) => {
  const { fyId } = c.req.valid('query');
  return c.json(shareTradesRepo.listByFy(fyId));
});

shareTradesRoute.post('/', zValidator('json', createSchema), (c) => {
  const body = c.req.valid('json');
  const ticker = body.ticker.trim();
  const sec = securitiesRepo.upsert({
    ticker,
    name: body.security_name ?? null,
    asset_type: body.asset_type,
    currency: body.currency,
    exchange: body.exchange,
  });
  const fy = financialYearsRepo.findByDate(body.trade_date);
  if (!fy) return c.json({ error: `No FY covers trade_date ${body.trade_date}` }, 400);
  const trade = shareTradesRepo.insert({
    security_id: sec.id,
    fy_id: fy.id,
    trade_date: body.trade_date,
    settlement_date: body.settlement_date ?? null,
    side: body.side,
    units: body.units,
    price_cents: body.price_cents,
    brokerage_cents: body.brokerage_cents,
    gst_cents: body.gst_cents,
    currency: body.currency,
    aud_fx_rate: body.aud_fx_rate ?? null,
    external_id: null,
    is_opening: body.is_opening ? 1 : 0,
    notes: body.notes ?? null,
  });
  return c.json(trade, 201);
});

shareTradesRoute.delete('/:id', zValidator('param', idParam), (c) => {
  const { id } = c.req.valid('param');
  const ok = shareTradesRepo.delete(id);
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});