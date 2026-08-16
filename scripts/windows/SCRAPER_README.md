# Victoria Race Data Automation

## Option 1: Windows Task Scheduler (Recommended)

1. Edit `scripts/windows/run-scraper.bat` and update the path to your racing-predictor folder
2. Open Task Scheduler
3. Create Basic Task → "Victoria Race Scraper"
4. Trigger: Daily at 6:00 AM
5. Action: Start a program → `C:\path\to\racing-predictor\scripts\windows\run-scraper.bat`
6. Check "Run whether user is logged on or not"
7. Save

The scraper will:
- Fetch upcoming Victoria races from Racing.com
- Fetch recent results from Racing.com
- Write directly to Supabase

## Option 2: Manual Run

Double-click `scripts/windows/run-scraper.bat` or run from Command Prompt:

```cmd
cd C:\path\to\racing-predictor
npx tsx scripts/scrape-racing-com.ts
npx tsx scripts/scrape-results-racing-com.ts
```

## Option 3: Full Pipeline (scrape + evaluate)

```cmd
cd C:\path\to\racing-predictor
npx tsx scripts/scrape-full-pipeline.ts
```

## Environment Variables

Create `.env.local` in the racing-predictor folder:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## What Gets Scraped

- **Upcoming races**: Racecourse, datetime, distance, class
- **Results**: Finishing positions, times, margins, horses
- **Victoria only**: Flemington, Caulfield, Moonee Valley, Sandown, Ballarat, Bendigo, Geelong, etc.

## After Scraping

1. Visit `/admin` → Run Prediction Model
2. Visit `/results` to see predicted vs actual
