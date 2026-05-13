import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { computeCryptoCgtForFy } from '../services/cryptoCgt.js';

export const cryptoCgtRoute = new Hono();

const query = z.object({ fyId: z.coerce.number().int().positive() });

cryptoCgtRoute.get('/', zValidator('query', query), (c) => {
  const { fyId } = c.req.valid('query');
  try {
    return c.json(computeCryptoCgtForFy(fyId));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute crypto CGT';
    return c.json({ error: message }, 400);
  }
});
