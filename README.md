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
- Scrapes public race data (Racing.com, Breednet)
- Can integrate API feeds via RapidAPI or commercial providers
- All data stored in Supabase for model training

## Prediction Model
- Current: v2-heuristic (career form, condition preference, recency, barriers, and normalized probabilities)
- Backtesting scores winners, exact podiums, and finishing-time error by model version
- Future: ML model trained on historical race outcomes
- Confidence calibration is tracked against actual results
- Continuous improvement via backtesting
