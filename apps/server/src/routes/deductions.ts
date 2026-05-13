import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { deductionsRepo } from '../db/repos/deductions.js';

export const deductionsRoute = new Hono();

deductionsRoute.get('/', (c) => {
  const fyId = Number(c.req.query('fyId'));
  if (!fyId) return c.json({ error: 'fyId required' }, 400);
  const items = deductionsRepo.findAllByFy(fyId);
  const settings = deductionsRepo.getTaxSettings(fyId);
  return c.json({ items, ...settings });
});

const upsertSchema = z.object({
  fy_id:        z.number().int().positive(),
  category:     z.string().min(1),
  amount_cents: z.number().int().min(0),
  notes:        z.string().nullable().optional(),
});

deductionsRoute.put('/', zValidator('json', upsertSchema), (c) => {
  const body = c.req.valid('json');
  deductionsRepo.upsert(body.fy_id, body.category, body.amount_cents, body.notes ?? null);
  return c.json({ ok: true });
});

const taxSettingsSchema = z.object({
  fy_id:                        z.number().int().positive(),
  has_hecs:                     z.boolean().optional(),
  has_phi:                      z.boolean().optional(),
  salary_sacrifice_super_cents: z.number().int().min(0).optional(),
  received_income_support:      z.boolean().optional(),
});

deductionsRoute.put('/tax-settings', zValidator('json', taxSettingsSchema), (c) => {
  const { fy_id, ...patch } = c.req.valid('json');
  const current = deductionsRepo.getTaxSettings(fy_id);
  deductionsRepo.saveTaxSettings(fy_id, {
    has_hecs: patch.has_hecs ?? current.has_hecs,
    has_phi: patch.has_phi ?? current.has_phi,
    salary_sacrifice_super_cents: patch.salary_sacrifice_super_cents ?? current.salary_sacrifice_super_cents,
    received_income_support: patch.received_income_support ?? current.received_income_support,
  });
  return c.json({ ok: true });
});

// Keep old /hecs endpoint for backward compat
const hecsSchema = z.object({ fy_id: z.number().int().positive(), enabled: z.boolean() });
deductionsRoute.put('/hecs', zValidator('json', hecsSchema), (c) => {
  const { fy_id, enabled } = c.req.valid('json');
  const current = deductionsRepo.getTaxSettings(fy_id);
  deductionsRepo.saveTaxSettings(fy_id, { ...current, has_hecs: enabled });
  return c.json({ ok: true });
});
