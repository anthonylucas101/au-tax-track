-- AU Tax Tracker schema. All money columns are INTEGER cents.
-- All dates are ISO YYYY-MM-DD TEXT.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS financial_years (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT    NOT NULL UNIQUE,
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_brackets (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  fy_id                 INTEGER NOT NULL REFERENCES financial_years(id) ON DELETE CASCADE,
  threshold_from_cents  INTEGER NOT NULL,
  threshold_to_cents    INTEGER,
  base_tax_cents        INTEGER NOT NULL,
  marginal_rate         REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tax_brackets_fy ON tax_brackets(fy_id);

CREATE TABLE IF NOT EXISTS tax_config (
  fy_id                          INTEGER PRIMARY KEY REFERENCES financial_years(id) ON DELETE CASCADE,
  medicare_levy_rate             REAL    NOT NULL,
  lito_max_cents                 INTEGER NOT NULL,
  lito_taper1_threshold_cents    INTEGER NOT NULL,
  lito_taper1_rate               REAL    NOT NULL,
  lito_taper2_threshold_cents    INTEGER NOT NULL,
  lito_taper2_rate               REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS employers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  abn         TEXT,
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payslips (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id         INTEGER NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  fy_id               INTEGER NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT,
  pay_date            TEXT    NOT NULL,
  gross_cents         INTEGER NOT NULL,
  tax_withheld_cents  INTEGER NOT NULL,
  super_cents         INTEGER NOT NULL DEFAULT 0,
  allowances_cents    INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payslips_fy ON payslips(fy_id);
CREATE INDEX IF NOT EXISTS idx_payslips_employer_date ON payslips(employer_id, pay_date);

-- Securities: AU/US shares and ETFs. asset_type stays simple ('share'|'etf');
-- exchange ('ASX','NASDAQ','NYSE','OTHER') + currency distinguish AU vs foreign.
CREATE TABLE IF NOT EXISTS securities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker      TEXT    NOT NULL UNIQUE,
  name        TEXT,
  asset_type  TEXT    NOT NULL CHECK (asset_type IN ('share','etf')),
  currency    TEXT    NOT NULL DEFAULT 'AUD',
  exchange    TEXT
);

CREATE TABLE IF NOT EXISTS share_trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  fy_id           INTEGER NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT,
  trade_date      TEXT    NOT NULL,
  settlement_date TEXT,
  side            TEXT    NOT NULL CHECK (side IN ('buy','sell')),
  units           REAL    NOT NULL,
  price_cents     INTEGER NOT NULL,
  brokerage_cents INTEGER NOT NULL DEFAULT 0,
  gst_cents       INTEGER NOT NULL DEFAULT 0,
  currency        TEXT    NOT NULL DEFAULT 'AUD',
  aud_fx_rate     REAL,                              -- AUD per unit of foreign currency; NULL for AUD trades
  external_id     TEXT,                              -- e.g. Stake Trade Identifier
  is_opening      INTEGER NOT NULL DEFAULT 0,        -- 1 = opening parcel (not a real trade in the FY)
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_share_trades_fy ON share_trades(fy_id);
CREATE INDEX IF NOT EXISTS idx_share_trades_security_date ON share_trades(security_id, trade_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_share_trades_external
  ON share_trades(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dividends (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  security_id              INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  fy_id                    INTEGER NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT,
  payment_date             TEXT    NOT NULL,
  ex_date                  TEXT,
  unfranked_cents          INTEGER NOT NULL DEFAULT 0,
  franked_cents            INTEGER NOT NULL DEFAULT 0,
  franking_credits_cents   INTEGER NOT NULL DEFAULT 0,
  withholding_tax_cents    INTEGER NOT NULL DEFAULT 0,
  drp_units                REAL    NOT NULL DEFAULT 0,
  currency                 TEXT    NOT NULL DEFAULT 'AUD',
  aud_fx_rate              REAL,
  dividend_type            TEXT,
  external_id              TEXT,
  notes                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_dividends_fy ON dividends(fy_id);
CREATE INDEX IF NOT EXISTS idx_dividends_security_date ON dividends(security_id, payment_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dividends_external
  ON dividends(external_id) WHERE external_id IS NOT NULL;

-- Cash transactions imported from broker (Stake AUD/USD wallets, etc.)
CREATE TABLE IF NOT EXISTS cash_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fy_id         INTEGER NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT,
  tx_date       TEXT    NOT NULL,
  description   TEXT    NOT NULL,
  debit_cents   INTEGER NOT NULL DEFAULT 0,
  credit_cents  INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER,
  currency      TEXT    NOT NULL,
  category      TEXT,                                -- dividend|withholding_tax|settlement|withdrawal|deposit|fee|other
  external_id   TEXT,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_tx_fy_date ON cash_transactions(fy_id, tx_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_tx_external
  ON cash_transactions(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crypto_assets (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol  TEXT    NOT NULL UNIQUE,
  name    TEXT
);

CREATE TABLE IF NOT EXISTS crypto_trades (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id         INTEGER NOT NULL REFERENCES crypto_assets(id) ON DELETE CASCADE,
  fy_id            INTEGER NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT,
  trade_date       TEXT    NOT NULL,
  side             TEXT    NOT NULL CHECK (side IN ('buy','sell','income')),
  units            REAL    NOT NULL,
  aud_value_cents  INTEGER NOT NULL,
  fee_cents        INTEGER NOT NULL DEFAULT 0,
  income_type      TEXT,
  notes            TEXT
);
CREATE INDEX IF NOT EXISTS idx_crypto_trades_fy ON crypto_trades(fy_id);

CREATE TABLE IF NOT EXISTS properties (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  address                 TEXT    NOT NULL,
  ownership_percent       REAL    NOT NULL DEFAULT 100,
  acquired_date           TEXT,
  acquisition_cost_cents  INTEGER,
  sold_date               TEXT,
  sale_proceeds_cents     INTEGER,
  selling_costs_cents     INTEGER NOT NULL DEFAULT 0,
  notes                   TEXT
);

CREATE TABLE IF NOT EXISTS rental_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  fy_id         INTEGER NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT,
  tx_date       TEXT    NOT NULL,
  category      TEXT    NOT NULL,
  amount_cents  INTEGER NOT NULL,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_rental_tx_fy ON rental_transactions(fy_id);

-- Division 40: plant & equipment items (depreciable assets)
CREATE TABLE IF NOT EXISTS depreciation_assets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id      INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  description      TEXT    NOT NULL,
  cost_cents       INTEGER NOT NULL,
  start_date       TEXT    NOT NULL,
  method           TEXT    NOT NULL CHECK (method IN ('prime_cost','diminishing_value')),
  effective_life_years REAL NOT NULL,
  notes            TEXT
);
CREATE INDEX IF NOT EXISTS idx_dep_assets_property ON depreciation_assets(property_id);

-- Division 43: building/structural allowance (2.5%/yr on construction cost)
CREATE TABLE IF NOT EXISTS building_allowances (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id             INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  description             TEXT    NOT NULL DEFAULT 'Building allowance',
  construction_cost_cents INTEGER NOT NULL,
  completion_date         TEXT    NOT NULL,
  rate                    REAL    NOT NULL DEFAULT 0.025,
  notes                   TEXT
);
CREATE INDEX IF NOT EXISTS idx_building_allow_property ON building_allowances(property_id);
