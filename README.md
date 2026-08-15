# Racing Predictor

Australian horse race prediction app powered by historical data.

## Tech Stack
- Next.js (App Router) + TypeScript + Tailwind
- Supabase (PostgreSQL) — database + auth
- Vercel — hosting

## Database Schema
See `supabase/schema.sql` — run this in Supabase SQL Editor after creating your project.

## Pages
- `/` — Upcoming races with predicted podium
- `/races/[id]` — Race detail with full field + prediction
- `/accuracy` — Accuracy dashboard tracking model performance
- `/admin` — Data ingestion + model run controls

## Getting Started
1. Create Supabase project at https://supabase.com/dashboard
2. Run `supabase/schema.sql` in SQL Editor
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a strong server-only `ADMIN_API_KEY`
4. Run `npm run lint`, `npm test`, and `npm run build`
5. Deploy to Vercel

## Data Sources
- Imports Victorian race fields and results from Racing.com's public form data
- Can integrate API feeds via RapidAPI or commercial providers
- All data stored in Supabase for model training

Run a bounded manual import with `npm run ingest`, or use the protected actions in `/admin`.

## Prediction Model
- Current: v3.1 contextual ranking (last-five form weighted by class, distance, condition, and course; speed, jockey/trainer form, barrier, weight, fitness, and temperature-calibrated probabilities)
- Win/place prices are captured only to calculate possible returns and model-value signals; they are never prediction inputs
- Trifecta probabilities use an ordered Plackett-Luce calculation; displayed returns are model-fair estimates, not guaranteed pool dividends
- Backtesting scores winners, exact podiums, and finishing-time error by model version
- Future: ML model trained on historical race outcomes
- Confidence calibration is tracked against actual results
- Continuous improvement via backtesting

Use `npm run ingest:history` to refresh the 60-day historical form window used by the contextual model.
