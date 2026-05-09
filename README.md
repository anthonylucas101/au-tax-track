# AU Tax Tracker

Local-first Australian personal tax / accounting tracker. Runs entirely on your machine — no cloud, no accounts, data stored in a local SQLite file. Built for an AU resident lodging via ATO myTax.

## What it tracks

| Module | What's covered |
|---|---|
| **Salary / PAYG** | Multiple employers, gross income, tax withheld |
| **Shares & ETFs** | ASX + US trades, FIFO CGT, dividends with franking credits, foreign income & FITO |
| **Rental property** | Income, expenses (ATO categories), depreciation, negative gearing, sale & CGT |
| **Tax estimate** | ATO resident brackets (FY 2024-25 and 2025-26), Medicare levy 2%, LITO, negative gearing offset |
| **Exports** | Accountant-ready Excel (6 sheets) + myTax lodgement guide (HTML) |

## Prerequisites

- **Node.js 20+** (tested on Node 24) — download from [nodejs.org](https://nodejs.org)
- **npm 10+** (ships with Node)
- Windows, macOS, or Linux

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/au-tax-tracker.git
cd au-tax-tracker

# 2. Install dependencies
npm install

# 3. Start the app
npm run dev
```

This starts two servers:
- **API** → http://localhost:3000
- **Web UI** → http://localhost:5173

Open http://localhost:5173 in your browser. The SQLite database is auto-created on first boot at `./data/accounting.db` with seed data for FY 2024-25 and 2025-26 (tax brackets, LITO, Medicare levy config).

## Importing share data from Stake

Export three reports from the Stake app/website:

| Report | Stake name |
|---|---|
| Trade history | Investment Activity |
| Dividends | Investment Income |
| Cash | Cash Transactions |

Go to **Investments → Import** in the app, upload each `.xlsx` file, and click Import. Duplicate trades are safely skipped on re-import.

## Backing up your data

All data lives in one file:

```powershell
# Windows
Copy-Item .\data\accounting.db ".\data\accounting.backup-$(Get-Date -Format yyyyMMdd).db"
```

```bash
# macOS / Linux
cp data/accounting.db "data/accounting.backup-$(date +%Y%m%d).db"
```

To restore: replace `data/accounting.db` with the backup and restart `npm run dev`.

## Project layout

```
apps/
  server/   Hono + better-sqlite3 API (TypeScript, ESM)
  web/      Vite + React + TypeScript SPA
data/       SQLite DB — gitignored, auto-created on first run
```

## Australian tax rules implemented

- ATO resident income tax brackets (FY 2024-25 and 2025-26)
- Medicare levy 2%
- Low Income Tax Offset (LITO)
- CGT 50% discount for assets held > 12 months (FIFO parcel matching)
- Franking credit gross-up and offset (Item T9)
- Foreign Income Tax Offset (FITO / Item T12)
- Negative gearing: rental net loss reduces taxable income
- Depreciation (dollar input per FY)
- Div 43 building allowance

## Disclaimer

This tool computes estimates based on published ATO resident tax rates. It is **not** tax advice. Verify all numbers with a registered tax agent before lodging your return.
