export const INCOME_CATEGORIES = ['rent', 'bond_forfeited', 'other_income'] as const;
export const EXPENSE_CATEGORIES = [
  'interest',
  'council_rates',
  'water_rates',
  'land_tax',
  'insurance',
  'body_corporate',
  'agent_fees',
  'repairs_maintenance',
  'advertising',
  'pest_control',
  'gardening_cleaning',
  'accounting',
  'depreciation',
  'other_expense',
] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type RentalCategory = IncomeCategory | ExpenseCategory;

export const ALL_CATEGORIES: readonly RentalCategory[] = [
  ...INCOME_CATEGORIES,
  ...EXPENSE_CATEGORIES,
];

export const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent',
  bond_forfeited: 'Bond forfeited',
  other_income: 'Other income',
  interest: 'Interest on loan',
  council_rates: 'Council rates',
  water_rates: 'Water rates',
  land_tax: 'Land tax',
  insurance: 'Insurance',
  body_corporate: 'Body corporate fees',
  agent_fees: 'Agent fees (mgmt/letting)',
  repairs_maintenance: 'Repairs & maintenance',
  advertising: 'Advertising',
  pest_control: 'Pest control',
  gardening_cleaning: 'Gardening & cleaning',
  accounting: 'Accounting fees',
  depreciation: 'Depreciation',
  other_expense: 'Other expense',
};

export function isIncomeCategory(cat: string): cat is IncomeCategory {
  return (INCOME_CATEGORIES as readonly string[]).includes(cat);
}

export function isExpenseCategory(cat: string): cat is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(cat);
}
