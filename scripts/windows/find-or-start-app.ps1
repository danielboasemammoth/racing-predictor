<#
Finds the Racing Predictor app if it's already running on this machine and
returns its base URL. If it isn't running, starts it with `npm start`
(production build) and waits until it responds.

Returns a [PSCustomObject] with:
  Url               - base URL of the app
  StartedProcessId  - PID of the npm/node process this script started, or
                       $null if an already-running instance was reused
                       (callers should stop this process tree when done).

Usage:
    $app = & "$PSScriptRoot\find-or-start-app.ps1"
    $app.Url
#>

param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [int]$StartupTimeoutSeconds = 120
)

function Test-AppUrl {
    param([string]$Url)
    try {
        $resp = Invoke-RestMethod -Uri "$Url/api/health" -Method Get -TimeoutSec 3
        return $resp.app -eq 'racing-predictor' -and $resp.status -eq 'ok'
    } catch {
        return $false
    }
}

function Find-RunningAppUrl {
    # Only scan the small range Next.js uses when auto-incrementing past a busy default port,
    # rather than every listening port on the machine (which risks matching unrelated background
    # services/apps sharing the same host).
    foreach ($port in 3000..3010) {
        $url = "http://localhost:$port"
        if (Test-AppUrl -Url $url) {
            return $url
        }
    }
    return $null
}

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}

$existing = Find-RunningAppUrl
if ($existing) {
    [PSCustomObject]@{ Url = $existing; StartedProcessId = $null }
    return
}

Write-Host "App not detected on any local port. Starting it now..." -ForegroundColor Yellow

$logDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdOutLog = Join-Path $logDir "app-startup.out.log"
$stdErrLog = Join-Path $logDir "app-startup.err.log"

# `next start` (unlike `next dev`) does not auto-increment past a busy port, so this machine's
# other local projects (e.g. another Next.js app on 3000) would otherwise cause EADDRINUSE.
# Bind to an explicitly-chosen free port instead of relying on the framework default.
$targetPort = Get-FreeTcpPort
$targetUrl = "http://localhost:$targetPort"

Push-Location $ProjectRoot
try {
    $proc = Start-Process -FilePath "npm.cmd" `
        -ArgumentList "start", "--", "-p", "$targetPort" `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdOutLog `
        -RedirectStandardError $stdErrLog `
        -PassThru
} finally {
    Pop-Location
}

$elapsed = 0
$intervalSeconds = 2
$foundUrl = $null

while ($elapsed -lt $StartupTimeoutSeconds) {
    Start-Sleep -Seconds $intervalSeconds
    $elapsed += $intervalSeconds

    if (Test-AppUrl -Url $targetUrl) {
        $foundUrl = $targetUrl
        break
    }

    if ($proc.HasExited) {
        throw "App process exited unexpectedly during startup. Check log: $stdErrLog"
    }
}

if (-not $foundUrl) {
    throw "Timed out after $StartupTimeoutSeconds seconds waiting for app to become reachable. Check logs: $stdOutLog / $stdErrLog"
}

[PSCustomObject]@{ Url = $foundUrl; StartedProcessId = $proc.Id }

Write-Output $foundUrl