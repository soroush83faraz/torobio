# Contracts between parallel workers

## Ownership (a worker edits only its own paths; shared files via the conductor)
| Path | Owner unit |
|---|---|
| scripts/data/**, packages/core/src/normalize/**, packages/core/src/extract/** | U2 data build |
| packages/core/src/{types,requirement,compat,plan,questions}/**, packages/core/src/index.ts (re-exports only) | U3 engine |
| apps/server/** | U1 ops/server skeleton (later U3/U4 add routes under apps/server/src/routes/**) |
| apps/web/** | U5/U6 web |
| docs/**, root configs | conductor |

## Dataset
Raw CSVs live OUTSIDE git in `starcoach-dataset-v16-cap300-csv/` (read-only, ~273 MB). Never commit data or *.sqlite.
Snapshot date: 2026-10-13. Output of the data build: `data/market.sqlite` (gitignored) + `data/quality-report.json`.

## Language
All user-facing strings Persian (RTL). Code, docs, comments English.

## Product rules the data layer must enforce
- NEVER include shop phone numbers, instagram or website in the output DB.
- price_clean = NULL when raw price is null, < 10000 or > 1e12 (keep price_flag reason).
- Hours: drop the 00:00–00:00 sentinel shift; missing hours => NULL (never "closed").
- Unreadable attributes stay NULL (never guessed).
