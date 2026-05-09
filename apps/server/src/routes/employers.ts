import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { employersRepo } from '../db/repos/employers.js';

export const employersRoute = new Hono();

const createSchema = z.object({
  name: z.string().min(1).max(200),
  abn: z.string().trim().min(1).max(20).optional().nullable(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

employersRoute.get('/', (c) => {
  return c.json(employersRepo.list());
});

employersRoute.post('/', zValidator('json', createSchema), (c) => {
  const body = c.req.valid('json');
  const created = employersRepo.create({ name: body.name, abn: body.abn ?? null });
  return c.json(created, 201);
});

employersRoute.delete('/:id', zValidator('param', idParam), (c) => {
  const { id } = c.req.valid('param');
  const ok = employersRepo.delete(id);
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});
