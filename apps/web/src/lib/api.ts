export interface FinancialYear {
  id: number;
  label: string;
  start_date: string;
  end_date: string;
}

export interface Employer {
  id: number;
  name: string;
  abn: string | null;
  created_at: string;
}

export interface Payslip {
  id: number;
  employer_id: number;
  fy_id: number;
  pay_date: string;
  gross_cents: number;
  tax_withheld_cents: number;
  super_cents: number;
  allowances_cents: number;
  notes: string | null;
  created_at: string;
  employer_name: string;
}

export interface TaxEstimateLine {
  label: string;
  amount_cents: number;
  formula: string;
}

export interface BracketBreakdown {
  threshold_from_cents: number;
  threshold_to_cents: number | null;
  base_tax_cents: number;
  marginal_rate: number;
  applied: boolean;
  taxable_in_bracket_cents: number;
  tax_in_bracket_cents: number;
}

export interface TaxConfig {
  fy_id: number;
  medicare_levy_rate: number;
  lito_max_cents: number;
  lito_taper1_threshold_cents: number;
  lito_taper1_rate: number;
  lito_taper2_threshold_cents: number;
  lito_taper2_rate: number;
}

export interface DividendTotalsAud {
  unfranked_cents: number;
  franked_cents: number;
  franking_credits_cents: number;
  withholding_tax_cents: number;
  au_total_cents: number;
  foreign_total_cents: number;
}

export interface CgtSummary {
  total_gain_cents: number;
  total_loss_cents: number;
  net_gain_cents: number;
  discounted_net_gain_cents: number;
  loss_carryforward_cents: number;
  event_count: number;
  orphan_count: number;
}

export interface RentalPropertySummary {
  id: number;
  address: string;
  net_cents: number;
  ownership_adjusted_net_cents: number;
}

export interface RentalBlock {
  properties: RentalPropertySummary[];
  total_net_cents: number;
}

export interface TaxEstimate {
  fy: FinancialYear;
  payslip_count: number;
  gross_cents: number;
  allowances_cents: number;
  tax_withheld_cents: number;
  super_cents: number;
  taxable_income_cents: number;
  income_tax_cents: number;
  medicare_levy_cents: number;
  lito_cents: number;
  franking_credits_cents: number;
  fito_cents: number;
  dividend_totals: DividendTotalsAud;
  cgt: CgtSummary;
  rental: RentalBlock;
  estimated_tax_payable_cents: number;
  refund_or_bill_cents: number;
  bracket_breakdown: BracketBreakdown[];
  lines: TaxEstimateLine[];
  config: TaxConfig;
}

export interface Security {
  id: number;
  ticker: string;
  name: string | null;
  asset_type: 'share' | 'etf';
  currency: string;
  exchange: string | null;
}

export interface ShareTrade {
  id: number;
  security_id: number;
  fy_id: number;
  trade_date: string;
  settlement_date: string | null;
  side: 'buy' | 'sell';
  units: number;
  price_cents: number;
  brokerage_cents: number;
  gst_cents: number;
  currency: string;
  aud_fx_rate: number | null;
  external_id: string | null;
  is_opening: number;
  notes: string | null;
  ticker: string;
  security_name: string | null;
  exchange: string | null;
}

export interface Dividend {
  id: number;
  security_id: number;
  fy_id: number;
  payment_date: string;
  ex_date: string | null;
  unfranked_cents: number;
  franked_cents: number;
  franking_credits_cents: number;
  withholding_tax_cents: number;
  drp_units: number;
  currency: string;
  aud_fx_rate: number | null;
  dividend_type: string | null;
  external_id: string | null;
  notes: string | null;
  ticker: string;
  security_name: string | null;
  exchange: string | null;
}

export interface Holding {
  security_id: number;
  ticker: string;
  security_name: string | null;
  exchange: string | null;
  units: number;
  cost_base_aud_cents: number;
  buy_count: number;
  sell_count: number;
}

export interface CgtEvent {
  sell_trade_id: number;
  ticker: string;
  security_name: string | null;
  sell_date: string;
  acquired_date: string;
  units: number;
  proceeds_aud_cents: number;
  cost_base_aud_cents: number;
  gain_aud_cents: number;
  held_days: number;
  discount_eligible: boolean;
}

export interface CgtOrphan {
  sell_trade_id: number;
  ticker: string;
  sell_date: string;
  units_unmatched: number;
  reason: string;
}

export interface CgtResult {
  fy: FinancialYear;
  events: CgtEvent[];
  totalGainCents: number;
  totalLossCents: number;
  netGainCents: number;
  discountedNetGainCents: number;
  loss_carryforward_cents: number;
  orphans: CgtOrphan[];
}

export interface ImportSheetSummary {
  sheet: string;
  total: number;
  newRows: number;
  duplicate: number;
}

export interface ImportFilePreview {
  filename: string;
  kind: 'activity' | 'income' | 'cash';
  sheetSummaries: ImportSheetSummary[];
}

export interface PreviewTrade {
  source_file: string;
  source_sheet: string;
  source_row: number;
  trade_date: string;
  settlement_date: string | null;
  ticker: string;
  security_name: string | null;
  asset_type: 'share' | 'etf';
  exchange: string;
  side: 'buy' | 'sell';
  units: number;
  price_cents: number;
  brokerage_cents: number;
  gst_cents: number;
  currency: string;
  aud_fx_rate: number | null;
  external_id: string;
  duplicate: boolean;
  security_will_be_created: boolean;
}

export interface PreviewDividend {
  source_file: string;
  source_sheet: string;
  source_row: number;
  ticker: string;
  security_name: string | null;
  asset_type: 'share' | 'etf';
  exchange: string;
  payment_date: string;
  ex_date: string | null;
  unfranked_cents: number;
  franked_cents: number;
  franking_credits_cents: number;
  withholding_tax_cents: number;
  currency: string;
  aud_fx_rate: number | null;
  dividend_type: string | null;
  external_id: string;
  duplicate: boolean;
  security_will_be_created: boolean;
}

export interface PreviewCash {
  source_file: string;
  source_sheet: string;
  source_row: number;
  tx_date: string;
  description: string;
  debit_cents: number;
  credit_cents: number;
  balance_cents: number | null;
  currency: string;
  category: string;
  external_id: string;
  duplicate: boolean;
}

export interface ImportError {
  file: string;
  sheet: string;
  row: number;
  message: string;
}

export interface ImportPreview {
  files: ImportFilePreview[];
  preview: {
    trades: PreviewTrade[];
    dividends: PreviewDividend[];
    cashTransactions: PreviewCash[];
  };
  errors: ImportError[];
}

export interface CommitResult {
  result: {
    inserted: { securities: number; trades: number; dividends: number; cashTransactions: number };
    skippedDuplicates: { trades: number; dividends: number; cashTransactions: number };
  };
  preview: ImportPreview;
}

// ─── Property types ───────────────────────────────────────────────────────

export interface Property {
  id: number;
  address: string;
  ownership_percent: number;
  acquired_date: string | null;
  acquisition_cost_cents: number | null;
  sold_date: string | null;
  sale_proceeds_cents: number | null;
  selling_costs_cents: number;
  notes: string | null;
}

export interface RentalTransaction {
  id: number;
  property_id: number;
  fy_id: number;
  tx_date: string;
  category: string;
  amount_cents: number;
  notes: string | null;
}

export interface DepreciationAsset {
  id: number;
  property_id: number;
  description: string;
  cost_cents: number;
  start_date: string;
  method: 'prime_cost' | 'diminishing_value';
  effective_life_years: number;
  notes: string | null;
}

export interface BuildingAllowance {
  id: number;
  property_id: number;
  description: string;
  construction_cost_cents: number;
  completion_date: string;
  rate: number;
  notes: string | null;
}

export interface Div40Item {
  asset_id: number;
  description: string;
  method: string;
  deduction_cents: number;
}

export interface Div43Item {
  allowance_id: number;
  description: string;
  deduction_cents: number;
}

export interface DepreciationResult {
  div40: Div40Item[];
  div43: Div43Item[];
  total_cents: number;
}

export interface PropertyCgt {
  eligible_for_discount: boolean;
  cost_base_cents: number;
  proceeds_cents: number;
  selling_costs_cents: number;
  gross_gain_cents: number;
  discounted_gain_cents: number;
}

export interface PropertySummary {
  property: Property;
  fy: FinancialYear;
  income_cents: number;
  expenses_by_category: Record<string, number>;
  total_expenses_cents: number;
  depreciation: DepreciationResult;
  net_rental_income_cents: number;
  ownership_adjusted_net_cents: number;
  cgt: PropertyCgt | null;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ?? '';
    } catch {
      // ignore
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function uploadFiles<T>(path: string, files: File[]): Promise<T> {
  const fd = new FormData();
  for (const f of files) fd.append('files', f, f.name);
  const res = await fetch(path, { method: 'POST', body: fd });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ?? '';
    } catch {
      // ignore
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listFinancialYears: () => request<FinancialYear[]>('/api/financial-years'),

  listEmployers: () => request<Employer[]>('/api/employers'),
  createEmployer: (input: { name: string; abn?: string | null }) =>
    request<Employer>('/api/employers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteEmployer: (id: number) =>
    request<{ ok: true }>(`/api/employers/${id}`, { method: 'DELETE' }),

  listPayslips: (fyId: number) =>
    request<Payslip[]>(`/api/payslips?fyId=${encodeURIComponent(fyId)}`),
  createPayslip: (input: {
    employer_id: number;
    fy_id: number;
    pay_date: string;
    gross_cents: number;
    tax_withheld_cents: number;
    super_cents: number;
    allowances_cents: number;
    notes: string | null;
  }) =>
    request<Payslip>('/api/payslips', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deletePayslip: (id: number) =>
    request<{ ok: true }>(`/api/payslips/${id}`, { method: 'DELETE' }),

  taxEstimate: (fyId: number) =>
    request<TaxEstimate>(`/api/tax-estimate?fyId=${encodeURIComponent(fyId)}`),

  listSecurities: () => request<Security[]>('/api/securities'),

  listShareTrades: (fyId: number) =>
    request<ShareTrade[]>(`/api/share-trades?fyId=${encodeURIComponent(fyId)}`),
  createShareTrade: (input: {
    ticker: string;
    trade_date: string;
    settlement_date?: string | null;
    side: 'buy' | 'sell';
    units: number;
    price_cents: number;
    brokerage_cents?: number;
    gst_cents?: number;
    currency?: string;
    aud_fx_rate?: number | null;
    is_opening?: boolean;
    notes?: string | null;
    security_name?: string | null;
    asset_type?: 'share' | 'etf';
    exchange?: string;
  }) =>
    request<ShareTrade>('/api/share-trades', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteShareTrade: (id: number) =>
    request<{ ok: true }>(`/api/share-trades/${id}`, { method: 'DELETE' }),

  listDividends: (fyId: number) =>
    request<Dividend[]>(`/api/dividends?fyId=${encodeURIComponent(fyId)}`),
  createDividend: (input: {
    ticker: string;
    payment_date: string;
    ex_date?: string | null;
    unfranked_cents?: number;
    franked_cents?: number;
    franking_credits_cents?: number;
    withholding_tax_cents?: number;
    currency?: string;
    aud_fx_rate?: number | null;
    dividend_type?: string | null;
    notes?: string | null;
    security_name?: string | null;
    asset_type?: 'share' | 'etf';
    exchange?: string;
  }) =>
    request<Dividend>('/api/dividends', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteDividend: (id: number) =>
    request<{ ok: true }>(`/api/dividends/${id}`, { method: 'DELETE' }),

  listHoldings: () => request<Holding[]>('/api/holdings'),

  cgt: (fyId: number) => request<CgtResult>(`/api/cgt?fyId=${encodeURIComponent(fyId)}`),

  importPreview: (files: File[]) => uploadFiles<ImportPreview>('/api/import/stake/preview', files),
  importCommit: (files: File[]) => uploadFiles<CommitResult>('/api/import/stake/commit', files),

  // ─── Properties ───────────────────────────────────────────────────────
  listProperties: () => request<Property[]>('/api/properties'),
  createProperty: (input: {
    address: string;
    ownership_percent?: number;
    acquired_date?: string | null;
    acquisition_cost_cents?: number | null;
    notes?: string | null;
  }) => request<Property>('/api/properties', { method: 'POST', body: JSON.stringify(input) }),
  updateProperty: (id: number, input: {
    address?: string;
    ownership_percent?: number;
    acquired_date?: string | null;
    acquisition_cost_cents?: number | null;
    sold_date?: string | null;
    sale_proceeds_cents?: number | null;
    selling_costs_cents?: number;
    notes?: string | null;
  }) => request<Property>(`/api/properties/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteProperty: (id: number) =>
    request<{ ok: true }>(`/api/properties/${id}`, { method: 'DELETE' }),

  listRentalTransactions: (propertyId: number, fyId: number) =>
    request<RentalTransaction[]>(`/api/properties/${propertyId}/transactions?fyId=${fyId}`),
  createRentalTransaction: (propertyId: number, input: {
    fy_id: number;
    tx_date: string;
    category: string;
    amount_cents: number;
    notes?: string | null;
  }) =>
    request<RentalTransaction>(`/api/properties/${propertyId}/transactions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteRentalTransaction: (propertyId: number, txId: number) =>
    request<{ ok: true }>(`/api/properties/${propertyId}/transactions/${txId}`, { method: 'DELETE' }),

  listDepreciationAssets: (propertyId: number) =>
    request<DepreciationAsset[]>(`/api/properties/${propertyId}/depreciation-assets`),
  createDepreciationAsset: (propertyId: number, input: {
    description: string;
    cost_cents: number;
    start_date: string;
    method: 'prime_cost' | 'diminishing_value';
    effective_life_years: number;
    notes?: string | null;
  }) =>
    request<DepreciationAsset>(`/api/properties/${propertyId}/depreciation-assets`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteDepreciationAsset: (propertyId: number, assetId: number) =>
    request<{ ok: true }>(`/api/properties/${propertyId}/depreciation-assets/${assetId}`, { method: 'DELETE' }),

  listBuildingAllowances: (propertyId: number) =>
    request<BuildingAllowance[]>(`/api/properties/${propertyId}/building-allowances`),
  createBuildingAllowance: (propertyId: number, input: {
    description?: string;
    construction_cost_cents: number;
    completion_date: string;
    rate?: number;
    notes?: string | null;
  }) =>
    request<BuildingAllowance>(`/api/properties/${propertyId}/building-allowances`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteBuildingAllowance: (propertyId: number, baId: number) =>
    request<{ ok: true }>(`/api/properties/${propertyId}/building-allowances/${baId}`, { method: 'DELETE' }),

  propertySummary: (propertyId: number, fyId: number) =>
    request<PropertySummary>(`/api/properties/${propertyId}/summary?fyId=${fyId}`),
};
