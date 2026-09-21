<#
Frequent PuntersEdge poll: settle paper bets, then sync odds/recommendations.

Scheduled hourly from 6am through midnight via register-puntersedge-poll-task.ps1.
The runtime guard uses local Windows time to match the scheduler and allows the midnight
hour for delayed starts. No scheduled runs occur from 1am through 5am.
PuntersEdge can price races only 15-25 minutes before jump, so hourly polling can miss them.
-ForceRun bypasses the hours guard for manual recovery.
#>

param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [int]$RacingHoursStartAest = 6,
    [int]$RacingHoursEndAest = 24,
    [switch]$ForceRun
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
        # 240s (not 120s): the sync route processes every currently-priced race and can legitimately
        # take a while during mid-morning meeting overlap even with the route's own batched
        # concurrency - a client timeout here silently aborts a still-healthy server-side sync.
        $response = Invoke-RestMethod -Uri $url -Method Post -Body "{}" -ContentType "application/json" `
            -WebSession $WebSession -TimeoutSec 240
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
    $aestNow = Get-Date
    if (-not $ForceRun -and -not ($RacingHoursEndAest -eq 24 -and $aestNow.Hour -eq 0) -and ($aestNow.Hour -lt $RacingHoursStartAest -or $aestNow.Hour -ge $RacingHoursEndAest)) {
        Write-Log "Outside scheduled hours ($($aestNow.ToString('HH:mm')) local time) - skipping poll to conserve API credits"
        exit 0
    }
    if ($ForceRun) {
        Write-Log "Force-run poll ($($aestNow.ToString('HH:mm')) local time)"
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
    if ($baseUrl -and $webSession) {
        if (-not (& (Join-Path $PSScriptRoot "refresh-page-cache.ps1") -BaseUrl $baseUrl -WebSession $webSession -PollOnly)) { $cacheFailed = $true }
    }
    if ($app -and $app.StartedProcessId) {
        Write-Log "Stopping app instance started for this run (PID $($app.StartedProcessId))"
        taskkill /T /F /PID $app.StartedProcessId 2>&1 | Out-Null
    }
}

if ($cacheFailed) { exit 1 }
