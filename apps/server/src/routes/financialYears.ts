import { Hono } from 'hono';
import { financialYearsRepo } from '../db/repos/financialYears.js';

export const financialYearsRoute = new Hono();

financialYearsRoute.get('/', (c) => {
  return c.json(financialYearsRepo.list());
});
