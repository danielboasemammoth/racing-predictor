# Racing Predictor — Project Brief

## Project Goal
Build an Australian horse race prediction app that uses historical race data to predict race outcomes with confidence levels. The app should continuously improve its accuracy by testing predictions against real results and iterating on the model.

## Core Features
1. **Upcoming Races Display** — Show upcoming races with predicted podium (1st, 2nd, 3rd), predicted times, and confidence percentages
2. **Race Detail View** — Full field of runners with jockeys, barriers, weights, and prediction vs actual comparison
3. **Accuracy Dashboard** — Track overall accuracy percentages over time to measure model improvement
4. **Admin Panel** — Data ingestion controls and model run triggers
5. **Data Ingestion** — Scrape public race data + integrate API feeds into unified database
6. **Prediction Engine** — Heuristic/ML model that outputs predictions with confidence scores
7. **Backtesting** — Compare predictions against actual results to measure accuracy

## Target Market
- Australian horse racing enthusiasts
- Starting with public preview, no paywall
- Mobile-first design
- Focus on metro and country races across AU

## Tech Stack
- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS
- **Database:** Supabase (PostgreSQL) — free tier for beta
- **Hosting:** Vercel — free tier for previews
- **Scraping:** Cheerio / Playwright for public data sources
- **Prediction:** Start with heuristic model, evolve to ML (Python/Node script)

## Current State
- ✅ Next.js project scaffolded at `/opt/data/racing-predictor`
- ✅ Supabase connected (credentials in `.env.local`, NOT committed to git)
- ✅ GitHub repo: https://github.com/danielboasemammoth/racing-predictor
- ✅ Database schema defined in `supabase/schema.sql`
- ✅ Pages scaffolded: `/`, `/races/[id]`, `/accuracy`, `/admin`
- ✅ Admin API routes protected by an HttpOnly session and server-only key
- ✅ Leakage-safe `v3-contextual-ranking` model with last-five context, speed, class, course, jockey/trainer, barrier, weight, and fitness features
- ✅ Win/place payout metadata and value signals kept separate from prediction features
- ✅ Ordered trifecta probability and model-fair return estimates
- ✅ Walk-forward probability metrics including Brier score and log loss
- ✅ Backtesting for winner, exact podium, and finishing-time error by model version
- ✅ Unit tests for prediction and backtest behavior
- ✅ Racing.com ingestion for Victorian meetings, fields, and results
- ✅ TypeScript types defined in `src/lib/types.ts`
- ✅ Supabase client wired up in `src/lib/supabase.ts`
- ⬜ Database schema NOT yet run in Supabase
- ✅ Initial real race data ingested into Supabase
- ⬜ Additional state and fallback data sources not implemented
- ⬜ No RapidAPI integration yet

## Database Schema (supabase/schema.sql)
Run this in Supabase SQL Editor after creating your project.

### Tables
- `racecourses` — racecourse names, states, regions
- `races` — upcoming and completed races with conditions, distance, class, prize money
- `horses` — horse profiles with career stats, form ratings, best times
- `race_entries` — horses in specific races with barrier, weight, jockey, finishing position/time
- `predictions` — model outputs with podium predictions, confidence scores, predicted times
- `accuracy_log` — aggregated accuracy metrics over time periods
- `data_sources` — track where data came from (scrape vs API vs manual)

### Key Relationships
- racecourses 1→∞ races
- races 1→∞ race_entries
- horses 1→∞ race_entries
- races 1→1 predictions (latest)
- races 1→∞ accuracy_log

### Important Notes
- All tables have RLS; public clients can read racing data, while writes require the server-only service role
- `predictions.predictions` and `confidence_scores` are JSONB for flexibility
- `race_entries.sectional_times` is JSONB for variable sectional time data
- Indexes on foreign keys and commonly queried fields

## File Structure
```
racing-predictor/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Home — upcoming races with predictions
│   │   ├── layout.tsx                  # Root layout
│   │   ├── races/[id]/page.tsx         # Race detail
│   │   ├── accuracy/page.tsx           # Accuracy dashboard
│   │   ├── admin/page.tsx              # Admin controls
│   │   └── api/admin/
│   │       ├── scrape/route.ts         # Scrape upcoming races
│   │       ├── scrape-results/route.ts # Scrape race results
│   │       ├── predict/route.ts        # Run prediction model
│   │       └── backtest/route.ts       # Score predictions vs results
│   ├── lib/
│   │   ├── supabase.ts                 # Supabase client
│   │   ├── types.ts                    # TypeScript interfaces
│   │   └── scrapers/
│   │       └── types.ts                # Scraper type definitions
│   └── components/                     # (empty — add UI components here)
├── supabase/
│   ├── schema.sql                      # Database schema
│   └── schema.txt                      # Same schema in .txt format
├── .env.local                          # Supabase credentials (NOT in git)
├── package.json
└── README.md
```

## Environment Variables
Create `.env.local` in project root:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_API_KEY=generate-a-strong-random-secret
```

Get the Supabase values from Supabase Dashboard → Settings → API. Never expose the service-role or admin keys to the browser.

## What Needs to Be Built Next

### Priority 1: Data Ingestion
**Goal:** Populate the database with real Australian race data.

**Tasks:**
1. Implement scraper for Racing.com upcoming races page
   - Extract: racecourse, race number, race name, distance, track condition, weather, race datetime
   - Store in `races` table
2. Implement scraper for Racing.com / Breednet race results
   - Extract: finishing positions, horse names, jockeys, barriers, weights, times
   - Update `race_entries` with results
3. Implement horse profile scraper
   - Extract: career stats, best times, form ratings, trainer, owner
   - Store in `horses` table
4. Build data importer API that:
   - Calls scrapers
   - Normalizes data
   - Upserts into Supabase
   - Handles duplicates via `external_id`

**Data Sources to Scrape:**
- Racing.com (primary) — https://racing.com
- Breednet (results) — https://breednet.com.au
- Punters.com.au (form guides) — CloudFront protected, may need headers

**Constraints:**
- Be respectful with scraping — add delays, use realistic headers
- Don't scrape during peak race times to avoid overloading sources
- Store raw HTML/snapshots for debugging if structure changes

### Priority 2: Prediction Model
**Current:** `v3-contextual-ranking` in `src/lib/prediction-v3.ts` — last-five starts are weighted by recency and similarity in class, distance, condition, and course, then combined with speed, jockey/trainer, barrier, weight, and fitness features. Odds are excluded from ranking and used only for payout/value display.

**Tasks:**
1. Improve heuristic model with more features:
   - Jockey strike rate at venue/distance
   - Trainer strike rate at venue/distance
   - Barrier draw bias at specific racecourses
   - Weight carried vs career average
   - Days since last race (fitness)
   - Class drop/rise indicators
   - Track condition preference (wet/heavy/dry ratings)
   - Sectional times if available
2. Add feature engineering script:
   - Calculate speed figures from finishing times
   - Normalize by track condition and distance
   - Compute rolling averages (last 3, last 5 runs)
3. Build proper ML model (Phase 2):
   - Python script using scikit-learn/XGBoost
   - Train on historical race data
   - Features: all above + interactions
   - Output: probability distribution for each horse
   - Calibrate confidence scores
4. Model versioning:
   - Store model version in `predictions.model_version`
   - Track which model version generated each prediction
   - Allow running multiple model versions for comparison

### Priority 3: Backtesting & Accuracy
**Goal:** Measure prediction accuracy and track improvement over time.

**Tasks:**
1. Implement `/api/admin/backtest`:
   - Query completed races with predictions
   - Compare predicted podium vs actual podium
   - Calculate winner accuracy, podium accuracy
   - Compute time prediction error (MAE, RMSE)
   - Store results in `accuracy_log`
2. Accuracy dashboard improvements:
   - Chart showing accuracy trend over time
   - Breakdown by race type/distance/track condition
   - Confidence calibration curve
   - Model comparison view
3. Post-race comparison view:
   - Show prediction vs actual side-by-side
   - Highlight which predictions were correct/incorrect
   - Show confidence level vs outcome

### Priority 4: UI/UX Improvements
1. Mobile responsiveness audit
2. Loading states and skeleton screens
3. Error handling and user-friendly messages
4. Race filtering (by racecourse, date, status)
5. Search functionality
6. Favorites/watchlist for races/horses
7. Notifications for upcoming races
8. Dark mode

### Priority 5: Data API Integration
**Goal:** Supplement scraped data with API feeds for better coverage and reliability.

**Tasks:**
1. Check RapidAPI for AU racing APIs with free tiers
   - Search: "Australian horse racing API"
   - Test free tier limits
   - Integrate alongside scrapers
2. If no free tier available:
   - Contact TAB/Racing Australia about data partnerships
   - Consider paid API if model proves accurate
3. Build unified data layer:
   - Abstract data source (scrape vs API)
   - Both write to same Supabase tables
   - Track source in `data_sources` table

## Development Constraints
- **No spending** on paid services until explicitly told to
- Use free tiers only for beta/prototype
- Mobile-first design
- Keep it simple — one feature working perfectly > five half-built features
- Respect scraping targets — add delays, don't overload servers
- All data must be stored in Australia (Supabase ap-southeast-2)

## Key Design Decisions
1. **Single Supabase database** for both scraped and API data
2. **JSONB for flexible prediction outputs** — allows model structure to evolve without schema migrations
3. **Heuristic model first** — prove the concept before investing in ML
4. **Admin-triggered actions** — no cron jobs yet, manual triggers from admin panel
5. **Public predictions, protected operations** — viewing is public; admin mutations require `ADMIN_API_KEY`

## Known Issues / TODOs
- Scrapers not implemented yet
- RapidAPI integration not started
- No real data in database yet
- Sectional split coverage is still limited by source availability
- No error handling in scrapers
- No rate limiting on scrapers

## Getting Started
1. Create Supabase project at https://supabase.com/dashboard
2. Run `supabase/schema.sql` in SQL Editor
3. Add env vars to `.env.local`
4. Run `npm run dev` locally
5. Deploy to Vercel by connecting GitHub repo

## AI Agent Instructions
If you're an AI agent continuing this project:

1. **Start by reading this file completely** — it contains all context
2. **Check current state** — what's built vs what's TODO
3. **Follow priorities** — data ingestion first, then model, then backtesting, then UI
4. **Respect constraints** — no paid services, mobile-first, simple over complex
5. **Commit often** — push to GitHub after each working feature
6. **Update this file** — if you make significant changes, update the "Current State" section
7. **Ask if unsure** — if something is ambiguous, ask the user before building

## Contact
- GitHub: https://github.com/danielboasemammoth/racing-predictor
- Business: danielboasemammoth@gmail.com
