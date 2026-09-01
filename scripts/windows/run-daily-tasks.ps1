<#
Daily pipeline: sync races, sync results + backfill predictions,
generate predictions, run backtest, settle paper bets, sync PuntersEdge odds.

Mirrors the exact steps defined in src/app/admin/admin-actions.tsx.

Note: PuntersEdge only prices a race close to its jump (~15-25 min out), so a single
daily run of the sync step will only ever catch whatever happens to be priced at that
moment - it is not a substitute for near-jump polling. Run this script more often (e.g.
via a separate, more frequent scheduled task calling only the two puntersedge steps) if
timely BET/WATCH recommendations across the racing day matter.
#>

param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$logDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "daily-tasks-$(Get-Date -Format 'yyyy-MM-dd').log"

function Write-Log {
    param([string]$Text)
    $line = "$(Get-Date -Format o) $Text"
    $line | Tee-Object -FilePath $logFile -Append
}

function Get-AdminSessionCookie {
    param([string]$ProjectRoot)

    $envFile = Join-Path $ProjectRoot ".env.local"
    if (-not (Test-Path $envFile)) { throw "Missing .env.local at $envFile; cannot authenticate admin requests." }

    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*ADMIN_API_KEY\s*=' } | Select-Object -First 1
    if (-not $line) { throw "ADMIN_API_KEY not found in .env.local" }
    $key = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
    if (-not $key) { throw "ADMIN_API_KEY is empty in .env.local" }

    # Must match sessionValue() in src/lib/admin-auth.ts exactly: HMAC-SHA256(key, fixed message).
    # Use ::new() rather than New-Object here - New-Object splats a byte-array argument into
    # separate positional parameters, which fails constructor overload resolution.
    $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($key))
    $hashBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("racing-predictor-admin-session"))
    return (($hashBytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

function New-AdminWebSession {
    param([string]$SessionCookieValue)

    # Invoke-RestMethod in Windows PowerShell 5.1 silently drops a manually-set "Cookie" header
    # (it's a restricted header on the underlying HttpWebRequest) - a WebRequestSession with the
    # cookie added to its container is the only reliable way to send it.
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $cookie = New-Object System.Net.Cookie("racing_admin_session", $SessionCookieValue, "/", "localhost")
    $session.Cookies.Add($cookie)
    return $session
}

function Invoke-Step {
    param(
        [string]$BaseUrl,
        [string]$Path,
        [string]$Label,
        [string]$Mode,
        $WebSession
    )

    $bodyObj = @{}
    if ($Mode) { $bodyObj.mode = $Mode }
    $body = $bodyObj | ConvertTo-Json
    $url = "$BaseUrl$Path"

    Write-Log "START $Label ($url)"

    try {
        $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json" `
            -WebSession $WebSession -TimeoutSec 3600
        # Defends against silently talking to the wrong service if URL resolution ever misfires again.
        if (-not $response -or -not ("success" -in $response.PSObject.Properties.Name)) {
            throw "Unexpected response shape from $url (not this app?): $($response | ConvertTo-Json -Compress -Depth 3)"
        }
        if (-not $response.success) {
            throw "Server reported failure: $($response.message)"
        }
        Write-Log "OK    $Label -> $($response.message)"
    } catch {
        Write-Log "FAIL  $Label -> $($_.Exception.Message)"
        throw
    }
}

try {
    Write-Log "Resolving app URL..."
    $app = & (Join-Path $PSScriptRoot "find-or-start-app.ps1") -ProjectRoot $ProjectRoot
    $baseUrl = $app.Url
    Write-Log "Using app URL: $baseUrl"
    $webSession = New-AdminWebSession -SessionCookieValue (Get-AdminSessionCookie -ProjectRoot $ProjectRoot)

    Invoke-Step -BaseUrl $baseUrl -Path "/api/admin/scrape" -Label "Sync Upcoming Races" -WebSession $webSession

    Invoke-Step -BaseUrl $baseUrl -Path "/api/admin/scrape-results" -Label "Sync Results" -WebSession $webSession
    Invoke-Step -BaseUrl $baseUrl -Path "/api/admin/predict" -Mode "retrospective" -Label "Backfill Predictions" -WebSession $webSession

    Invoke-Step -BaseUrl $baseUrl -Path "/api/admin/predict" -Mode "all" -Label "Generate Predictions" -WebSession $webSession

    Invoke-Step -BaseUrl $baseUrl -Path "/api/admin/backtest" -Label "Run Backtest" -WebSession $webSession

    Invoke-Step -BaseUrl $baseUrl -Path "/api/admin/puntersedge/settle" -Label "Settle Paper Bets" -WebSession $webSession
    Invoke-Step -BaseUrl $baseUrl -Path "/api/admin/puntersedge/sync" -Label "Sync PuntersEdge Odds & Recommendations" -WebSession $webSession

    Write-Log "ALL STEPS COMPLETED"
} catch {
    Write-Log "PIPELINE ABORTED: $($_.Exception.Message)"
    exit 1
} finally {
    # This is a one-shot daily batch job, not a long-lived server - if we started our own instance
    # of the app to run it, stop the whole process tree so it doesn't linger until the next run.
    if ($app -and $app.StartedProcessId) {
        Write-Log "Stopping app instance started for this run (PID $($app.StartedProcessId))"
        taskkill /T /F /PID $app.StartedProcessId 2>&1 | Out-Null
    }
}