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
3. Add env vars to Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy to Vercel

## Data Sources
- Scrapes public race data (Racing.com, Breednet)
- Can integrate API feeds via RapidAPI or commercial providers
- All data stored in Supabase for model training

## Prediction Model
- Current: v1-heuristic (simple scoring based on form, barriers, track conditions)
- Future: ML model trained on historical race outcomes
- Confidence scores calibrated against actual results
- Continuous improvement via backtesting
