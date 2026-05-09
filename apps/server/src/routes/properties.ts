import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { propertiesRepo } from '../db/repos/properties.js';
import { rentalTransactionsRepo } from '../db/repos/rentalTransactions.js';
import { depreciationAssetsRepo } from '../db/repos/depreciationAssets.js';
import { buildingAllowancesRepo } from '../db/repos/buildingAllowances.js';
import { financialYearsRepo } from '../db/repos/financialYears.js';
import { computeDepreciationForFy } from '../services/depreciation.js';
import { ALL_CATEGORIES, INCOME_CATEGORIES, EXPENSE_CATEGORIES } from '../lib/rentalCategories.js';

export const propertiesRoute = new Hono();

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const idParam = z.object({ id: z.coerce.number().int().positive() });

// ─── Properties CRUD ───────────────────────────────────────────────────────

const createPropertySchema = z.object({
  address: z.string().min(1).max(500),
  ownership_percent: z.number().min(0).max(100).optional().default(100),
  acquired_date: z.string().regex(dateRe).optional().nullable(),
  acquisition_cost_cents: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const updatePropertySchema = z.object({
  address: z.string().min(1).max(500).optional(),
  ownership_percent: z.number().min(0).max(100).optional(),
  acquired_date: z.string().regex(dateRe).optional().nullable(),
  acquisition_cost_cents: z.number().int().nonnegative().optional().nullable(),
  sold_date: z.string().regex(dateRe).optional().nullable(),
  sale_proceeds_cents: z.number().int().nonnegative().optional().nullable(),
  selling_costs_cents: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

propertiesRoute.get('/', (c) => c.json(propertiesRepo.findAll()));

propertiesRoute.post('/', zValidator('json', createPropertySchema), (c) => {
  const body = c.req.valid('json');
  const prop = propertiesRepo.create(body);
  return c.json(prop, 201);
});

propertiesRoute.get('/:id', zValidator('param', idParam), (c) => {
  const { id } = c.req.valid('param');
  const prop = propertiesRepo.findById(id);
  if (!prop) return c.json({ error: 'Not found' }, 404);
  return c.json(prop);
});

propertiesRoute.put('/:id', zValidator('param', idParam), zValidator('json', updatePropertySchema), (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const updated = propertiesRepo.update(id, body);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

propertiesRoute.delete('/:id', zValidator('param', idParam), (c) => {
  const { id } = c.req.valid('param');
  const ok = propertiesRepo.delete(id);
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ─── Rental Transactions ───────────────────────────────────────────────────

const txQuery = z.object({ fyId: z.coerce.number().int().positive() });
const txParam = z.object({ id: z.coerce.number().int().positive(), txId: z.coerce.number().int().positive() });

const createTxSchema = z.object({
  fy_id: z.number().int().positive(),
  tx_date: z.string().regex(dateRe),
  category: z.string().refine((v) => (ALL_CATEGORIES as readonly string[]).includes(v), {
    message: 'Invalid category',
  }),
  amount_cents: z.number().int().nonnegative(),
  notes: z.string().max(1000).optional().nullable(),
});

propertiesRoute.get('/:id/transactions', zValidator('param', idParam), zValidator('query', txQuery), (c) => {
  const { id } = c.req.valid('param');
  const { fyId } = c.req.valid('query');
  return c.json(rentalTransactionsRepo.listByPropertyAndFy(id, fyId));
});

propertiesRoute.post('/:id/transactions', zValidator('param', idParam), zValidator('json', createTxSchema), (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  if (!propertiesRepo.findById(id)) return c.json({ error: 'Property not found' }, 404);
  const tx = rentalTransactionsRepo.create({ property_id: id, ...body, notes: body.notes ?? null });
  return c.json(tx, 201);
});

propertiesRoute.delete('/:id/transactions/:txId', zValidator('param', txParam), (c) => {
  const { txId } = c.req.valid('param');
  const ok = rentalTransactionsRepo.delete(txId);
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ─── Depreciation Assets (Div 40) ─────────────────────────────────────────

const assetParam = z.object({ id: z.coerce.number().int().positive(), assetId: z.coerce.number().int().positive() });

const createAssetSchema = z.object({
  description: z.string().min(1).max(500),
  cost_cents: z.number().int().positive(),
  start_date: z.string().regex(dateRe),
  method: z.enum(['prime_cost', 'diminishing_value']),
  effective_life_years: z.number().positive(),
  notes: z.string().max(1000).optional().nullable(),
});

propertiesRoute.get('/:id/depreciation-assets', zValidator('param', idParam), (c) => {
  const { id } = c.req.valid('param');
  return c.json(depreciationAssetsRepo.listByProperty(id));
});

propertiesRoute.post('/:id/depreciation-assets', zValidator('param', idParam), zValidator('json', createAssetSchema), (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  if (!propertiesRepo.findById(id)) return c.json({ error: 'Property not found' }, 404);
  const asset = depreciationAssetsRepo.create({ property_id: id, ...body, notes: body.notes ?? null });
  return c.json(asset, 201);
});

propertiesRoute.delete('/:id/depreciation-assets/:assetId', zValidator('param', assetParam), (c) => {
  const { assetId } = c.req.valid('param');
  const ok = depreciationAssetsRepo.delete(assetId);
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ─── Building Allowances (Div 43) ─────────────────────────────────────────

const baParam = z.object({ id: z.coerce.number().int().positive(), baId: z.coerce.number().int().positive() });

const createBaSchema = z.object({
  description: z.string().max(500).optional(),
  construction_cost_cents: z.number().int().positive(),
  completion_date: z.string().regex(dateRe),
  rate: z.number().min(0).max(1).optional(),
  notes: z.string().max(1000).optional().nullable(),
});

propertiesRoute.get('/:id/building-allowances', zValidator('param', idParam), (c) => {
  const { id } = c.req.valid('param');
  return c.json(buildingAllowancesRepo.listByProperty(id));
});

propertiesRoute.post('/:id/building-allowances', zValidator('param', idParam), zValidator('json', createBaSchema), (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  if (!propertiesRepo.findById(id)) return c.json({ error: 'Property not found' }, 404);
  const ba = buildingAllowancesRepo.create({ property_id: id, ...body, notes: body.notes ?? null });
  return c.json(ba, 201);
});

propertiesRoute.delete('/:id/building-allowances/:baId', zValidator('param', baParam), (c) => {
  const { baId } = c.req.valid('param');
  const ok = buildingAllowancesRepo.delete(baId);
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ─── Property Summary ──────────────────────────────────────────────────────

const summaryQuery = z.object({ fyId: z.coerce.number().int().positive() });

propertiesRoute.get('/:id/summary', zValidator('param', idParam), zValidator('query', summaryQuery), (c) => {
  const { id } = c.req.valid('param');
  const { fyId } = c.req.valid('query');

  const property = propertiesRepo.findById(id);
  if (!property) return c.json({ error: 'Property not found' }, 404);

  const fy = financialYearsRepo.findById(fyId);
  if (!fy) return c.json({ error: 'Financial year not found' }, 404);

  const totals = rentalTransactionsRepo.totalsByPropertyAndFy(id, fyId);
  const depreciation = computeDepreciationForFy(id, fyId, property.sold_date);

  const income_cents = totals.income_cents;
  const total_expenses_cents = totals.expense_cents;
  const net_rental_income_cents = income_cents - total_expenses_cents - depreciation.total_cents;
  const ownership_adjusted_net_cents = Math.round(
    net_rental_income_cents * (property.ownership_percent / 100),
  );

  // CGT calculation if sold
  let cgt = null;
  if (property.sold_date && property.sale_proceeds_cents != null) {
    // Cost base: acquisition cost + total depreciation claimed (simplified: not adjusting for dep recapture)
    const totalDepreciation = depreciation.total_cents; // current FY only; a full calc would sum all FYs
    const costBaseCents = (property.acquisition_cost_cents ?? 0) + (property.selling_costs_cents ?? 0);
    const proceedsCents = property.sale_proceeds_cents;
    const sellingCostsCents = property.selling_costs_cents;
    const grossGainCents = proceedsCents - costBaseCents;

    // 50% discount if held > 12 months
    const acquiredDate = property.acquired_date;
    let eligible_for_discount = false;
    if (acquiredDate && property.sold_date) {
      const heldMs = new Date(property.sold_date).getTime() - new Date(acquiredDate).getTime();
      eligible_for_discount = heldMs >= 365 * 86_400_000;
    }
    const discountedGainCents = eligible_for_discount
      ? Math.round(Math.max(0, grossGainCents) * 0.5)
      : Math.max(0, grossGainCents);

    cgt = {
      eligible_for_discount,
      cost_base_cents: costBaseCents,
      proceeds_cents: proceedsCents,
      selling_costs_cents: sellingCostsCents,
      gross_gain_cents: grossGainCents,
      discounted_gain_cents: discountedGainCents,
    };
  }

  return c.json({
    property,
    fy,
    income_cents,
    expenses_by_category: totals.by_category,
    total_expenses_cents,
    depreciation,
    net_rental_income_cents,
    ownership_adjusted_net_cents,
    cgt,
  });
});
