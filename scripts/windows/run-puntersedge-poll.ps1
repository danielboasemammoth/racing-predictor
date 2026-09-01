<#
Frequent PuntersEdge poll: settle paper bets, then sync odds/recommendations.

Intended to run every 10-15 minutes via Task Scheduler (see the trigger example in
register-puntersedge-poll-task.ps1) - separate from run-daily-tasks.ps1's once-daily
6am pipeline, because PuntersEdge only prices a race close to its jump (~15-25 min out),
so timely BET/WATCH recommendations need much more frequent polling than the daily
prediction pipeline.

Credit-conscious: exits immediately without calling the API at all outside AU racing
hours (6am-11pm AEST/AEDT, DST-safe via the Windows timezone database) - a 24/7 15-minute
schedule would otherwise burn through the free tier's 1,500 monthly credits in about a
week for no benefit, since there is nothing to price overnight.
#>

param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [int]$RacingHoursStartAest = 6,
    [int]$RacingHoursEndAest = 23
)

$logDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "puntersedge-poll-$(Get-Date -Format 'yyyy-MM-dd').log"

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

    $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($key))
    $hashBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("racing-predictor-admin-session"))
    return (($hashBytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

function New-AdminWebSession {
    param([string]$SessionCookieValue)

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
        $WebSession
    )

    $url = "$BaseUrl$Path"
    Write-Log "START $Label ($url)"
    try {
        $response = Invoke-RestMethod -Uri $url -Method Post -Body "{}" -ContentType "application/json" `
            -WebSession $WebSession -TimeoutSec 120
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
    $aestNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, "AUS Eastern Standard Time")
    if ($aestNow.Hour -lt $RacingHoursStartAest -or $aestNow.Hour -ge $RacingHoursEndAest) {
        Write-Log "Outside AU racing hours ($($aestNow.ToString('HH:mm')) AEST/AEDT) - skipping poll to conserve API credits"
        exit 0
    }

    $app = & (Join-Path $PSScriptRoot "find-or-start-app.ps1") -ProjectRoot $ProjectRoot
    $baseUrl = $app.Url
    $webSession = New-AdminWebSession -SessionCookieValue (Get-AdminSessionCookie -ProjectRoot $ProjectRoot)

    Invoke-Step -BaseUrl $baseUrl -Path "/api/admin/puntersedge/settle" -Label "Settle Paper Bets" -WebSession $webSession
    Invoke-Step -BaseUrl $baseUrl -Path "/api/admin/puntersedge/sync" -Label "Sync PuntersEdge Odds & Recommendations" -WebSession $webSession

    Write-Log "POLL COMPLETED"
} catch {
    Write-Log "POLL ABORTED: $($_.Exception.Message)"
    exit 1
} finally {
    if ($app -and $app.StartedProcessId) {
        Write-Log "Stopping app instance started for this run (PID $($app.StartedProcessId))"
        taskkill /T /F /PID $app.StartedProcessId 2>&1 | Out-Null
    }
}
