import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { securitiesRepo } from '../db/repos/securities.js';

export const securitiesRoute = new Hono();

const upsertSchema = z.object({
  ticker: z.string().min(1).max(20),
  name: z.string().max(200).nullable().optional(),
  asset_type: z.enum(['share', 'etf']),
  currency: z.string().length(3).default('AUD'),
  exchange: z.string().min(1).max(20).nullable().optional(),
});

securitiesRoute.get('/', (c) => c.json(securitiesRepo.list()));

securitiesRoute.post('/', zValidator('json', upsertSchema), (c) => {
  const body = c.req.valid('json');
  const sec = securitiesRepo.upsert({
    ticker: body.ticker.trim(),
    name: body.name ?? null,
    asset_type: body.asset_type,
    currency: body.currency,
    exchange: body.exchange ?? null,
  });
  return c.json(sec, 201);
});