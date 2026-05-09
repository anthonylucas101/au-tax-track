import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { computeCgtForFy } from '../services/cgt.js';

export const cgtRoute = new Hono();

const query = z.object({ fyId: z.coerce.number().int().positive() });

cgtRoute.get('/', zValidator('query', query), (c) => {
  const { fyId } = c.req.valid('query');
  try {
    return c.json(computeCgtForFy(fyId));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute CGT';
    return c.json({ error: message }, 400);
  }
});