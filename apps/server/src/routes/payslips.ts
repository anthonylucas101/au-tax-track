import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { payslipsRepo } from '../db/repos/payslips.js';

export const payslipsRoute = new Hono();

const listQuery = z.object({
  fyId: z.coerce.number().int().positive(),
});

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  employer_id: z.number().int().positive(),
  fy_id: z.number().int().positive(),
  pay_date: z.string().regex(dateRe, 'pay_date must be YYYY-MM-DD'),
  gross_cents: z.number().int().nonnegative(),
  tax_withheld_cents: z.number().int().nonnegative(),
  super_cents: z.number().int().nonnegative().optional().default(0),
  allowances_cents: z.number().int().nonnegative().optional().default(0),
  notes: z.string().max(1000).optional().nullable(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

payslipsRoute.get('/', zValidator('query', listQuery), (c) => {
  const { fyId } = c.req.valid('query');
  return c.json(payslipsRepo.listByFy(fyId));
});

payslipsRoute.post('/', zValidator('json', createSchema), (c) => {
  const body = c.req.valid('json');
  const created = payslipsRepo.create({
    employer_id: body.employer_id,
    fy_id: body.fy_id,
    pay_date: body.pay_date,
    gross_cents: body.gross_cents,
    tax_withheld_cents: body.tax_withheld_cents,
    super_cents: body.super_cents,
    allowances_cents: body.allowances_cents,
    notes: body.notes ?? null,
  });
  return c.json(created, 201);
});

payslipsRoute.delete('/:id', zValidator('param', idParam), (c) => {
  const { id } = c.req.valid('param');
  const ok = payslipsRepo.delete(id);
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});
