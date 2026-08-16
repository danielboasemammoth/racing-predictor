@echo off
chcp 65001 >nul
echo ========================================
echo Racing Predictor - Victoria Auto-Scraper
echo ========================================
echo.

cd /d C:\path\to\racing-predictor

echo Running full pipeline (scrape + evaluate)...
npx tsx scripts/scrape-full-pipeline.ts
if %errorlevel% neq 0 (
  echo.
  echo Pipeline failed. Check the error above.
  pause
  exit /b 1
)

echo.
echo ========================================
echo Scraping complete
echo ========================================
timeout /t 3
