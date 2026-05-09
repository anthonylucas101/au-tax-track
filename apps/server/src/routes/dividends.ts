import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { dividendsRepo } from '../db/repos/dividends.js';
import { securitiesRepo } from '../db/repos/securities.js';
import { financialYearsRepo } from '../db/repos/financialYears.js';

export const dividendsRoute = new Hono();

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const listQuery = z.object({ fyId: z.coerce.number().int().positive() });
const idParam = z.object({ id: z.coerce.number().int().positive() });

const createSchema = z.object({
  ticker: z.string().min(1).max(20),
  payment_date: z.string().regex(dateRe),
  ex_date: z.string().regex(dateRe).nullable().optional(),
  unfranked_cents: z.number().int().nonnegative().default(0),
  franked_cents: z.number().int().nonnegative().default(0),
  franking_credits_cents: z.number().int().nonnegative().default(0),
  withholding_tax_cents: z.number().int().nonnegative().default(0),
  currency: z.string().length(3).default('AUD'),
  aud_fx_rate: z.number().positive().nullable().optional(),
  dividend_type: z.string().max(50).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  security_name: z.string().max(200).nullable().optional(),
  asset_type: z.enum(['share', 'etf']).default('share'),
  exchange: z.string().min(1).max(20).default('ASX'),
});

dividendsRoute.get('/', zValidator('query', listQuery), (c) => {
  const { fyId } = c.req.valid('query');
  return c.json(dividendsRepo.listByFy(fyId));
});

dividendsRoute.post('/', zValidator('json', createSchema), (c) => {
  const body = c.req.valid('json');
  const ticker = body.ticker.trim();
  const sec = securitiesRepo.upsert({
    ticker,
    name: body.security_name ?? null,
    asset_type: body.asset_type,
    currency: body.currency,
    exchange: body.exchange,
  });
  const fy = financialYearsRepo.findByDate(body.payment_date);
  if (!fy) return c.json({ error: `No FY covers payment_date ${body.payment_date}` }, 400);
  const div = dividendsRepo.insert({
    security_id: sec.id,
    fy_id: fy.id,
    payment_date: body.payment_date,
    ex_date: body.ex_date ?? null,
    unfranked_cents: body.unfranked_cents,
    franked_cents: body.franked_cents,
    franking_credits_cents: body.franking_credits_cents,
    withholding_tax_cents: body.withholding_tax_cents,
    drp_units: 0,
    currency: body.currency,
    aud_fx_rate: body.aud_fx_rate ?? null,
    dividend_type: body.dividend_type ?? null,
    external_id: null,
    notes: body.notes ?? null,
  });
  return c.json(div, 201);
});

dividendsRoute.delete('/:id', zValidator('param', idParam), (c) => {
  const { id } = c.req.valid('param');
  const ok = dividendsRepo.delete(id);
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});