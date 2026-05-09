import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { buildTaxEstimate } from '../services/taxEstimate.js';

export const taxEstimateRoute = new Hono();

const query = z.object({
  fyId: z.coerce.number().int().positive(),
});

taxEstimateRoute.get('/', zValidator('query', query), (c) => {
  const { fyId } = c.req.valid('query');
  try {
    return c.json(buildTaxEstimate(fyId));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute estimate';
    return c.json({ error: message }, 400);
  }
});
