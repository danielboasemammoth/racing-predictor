<#
Local real-betting runner (provider: TAB). Dry-run scaffold only.

- Accepts only mode "disabled" (does nothing) or "dry-run" (reports one blocked attempt per
  15-minute slot to the local app). Any other mode, enabled=true, unknown fields or anything that
  looks like a credential is refused before any network call.
- Never contacts TAB. Invoke-TabProvider is a fail-closed placeholder that always throws.
- Only talks to a loopback app URL (localhost / 127.0.0.1) and never follows redirects.
- Never reads TAB credentials. They live outside the repo (see REAL_BETTING.md) and are not
  needed until a real provider integration exists.

Usage:
    .\run-real-betting.ps1 -ValidateOnly
    .\run-real-betting.ps1 -ConfigPath "$env:LOCALAPPDATA\RacingPredictor\real-betting-runner.json"
#>

param(
    [string]$ConfigPath,
    [string]$ProjectRoot,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$RunnerVersion = '1'
$RiskCeilings = @{ maxStake = 50; maxDailyStake = 200; maxOpenExposure = 200 }
$ConfigKeys = @('schema', 'provider', 'mode', 'enabled', 'configId', 'exportedAt', 'appUrl', 'strategy', 'limits')
$SensitiveKeyPattern = 'password|passwd|secret|token|api[_-]?key|credential|cookie|session|^pin$|^auth'

function Test-LoopbackAppUrl {
    param([string]$Url)
    $uri = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri)) { return $null }
    if ($uri.Scheme -notin @('http', 'https')) { return $null }
    if ($uri.Host -notin @('localhost', '127.0.0.1')) { return $null }
    if ($uri.UserInfo -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment) { return $null }
    return $uri.GetLeftPart([UriPartial]::Authority)
}

function Find-SensitiveKey {
    param($Node, [string]$Path = '')
    $found = @()
    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        foreach ($property in $Node.PSObject.Properties) {
            $childPath = if ($Path) { "$Path.$($property.Name)" } else { $property.Name }
            if ($property.Name -match $SensitiveKeyPattern) { $found += $childPath }
            $found += Find-SensitiveKey -Node $property.Value -Path $childPath
        }
    } elseif ($Node -is [System.Array]) {
        for ($index = 0; $index -lt $Node.Count; $index++) { $found += Find-SensitiveKey -Node $Node[$index] -Path "$Path[$index]" }
    }
    return $found
}

function Test-CentsAmount {
    param($Value, [double]$Ceiling)
    if ($Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [double] -and $Value -isnot [decimal]) { return $false }
    $amount = [double]$Value
    if ([double]::IsNaN($amount) -or $amount -le 0 -or $amount -gt $Ceiling) { return $false }
    return [Math]::Abs([Math]::Round($amount * 100) - ($amount * 100)) -lt 1e-6
}

function Assert-RunnerConfig {
    param($Config)
    if ($Config -isnot [System.Management.Automation.PSCustomObject]) { throw 'Runner config must be a JSON object' }
    $sensitive = @(Find-SensitiveKey -Node $Config)
    if ($sensitive.Count) { throw "Runner config must not contain credentials ($($sensitive -join ', '))" }
    $unknown = @($Config.PSObject.Properties.Name | Where-Object { $_ -notin $ConfigKeys })
    if ($unknown.Count) { throw "Unsupported runner config fields: $($unknown -join ', ')" }
    if ($Config.schema -ne 1) { throw 'Runner config schema must be 1' }
    if ($Config.provider -cne 'tab') { throw 'Provider must be tab' }
    if ($Config.mode -cnotin @('disabled', 'dry-run')) { throw "Mode '$($Config.mode)' refused: only disabled or dry-run are supported; live placement is not available" }
    if ($Config.enabled -isnot [bool] -or $Config.enabled) { throw 'enabled must be false; live placement is not available' }
    if ($Config.configId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'configId must be a lowercase UUID' }
    if (-not (Test-LoopbackAppUrl -Url $Config.appUrl)) { throw "appUrl must be a loopback origin such as http://localhost:3000 (got '$($Config.appUrl)')" }
    $strategy = $Config.strategy
    if ($strategy -isnot [System.Management.Automation.PSCustomObject] -or $strategy.schema -ne 1 -or -not $strategy.name -or -not $strategy.preferences) { throw 'Runner config must contain a schema 1 strategy with a name and preferences' }
    $limits = $Config.limits
    if ($limits -isnot [System.Management.Automation.PSCustomObject] -or $limits.currency -cne 'AUD') { throw 'Risk limits must be in AUD' }
    foreach ($key in $RiskCeilings.Keys) {
        if (-not (Test-CentsAmount -Value $limits.$key -Ceiling $RiskCeilings[$key])) { throw "$key must be a positive whole-cent amount no greater than $($RiskCeilings[$key])" }
    }
    if ($limits.maxStake -gt $limits.maxDailyStake -or $limits.maxStake -gt $limits.maxOpenExposure) { throw 'maxStake cannot exceed maxDailyStake or maxOpenExposure' }
}

function Invoke-TabProvider {
    throw 'TAB provider is not implemented. Live placement is disabled; no request was sent.'
}

function Get-DryRunSlot {
    param([datetime]$UtcNow, [int]$SlotMinutes = 15)
    $floored = $UtcNow.Date.AddMinutes([Math]::Floor($UtcNow.TimeOfDay.TotalMinutes / $SlotMinutes) * $SlotMinutes)
    return $floored.ToString('yyyyMMddHHmm', [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-AdminSessionCookie {
    param([string]$ProjectRoot)
    $envFile = Join-Path $ProjectRoot '.env.local'
    if (-not (Test-Path $envFile)) { throw "Missing .env.local at $envFile; cannot authenticate to the local app." }
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*ADMIN_API_KEY\s*=' } | Select-Object -First 1
    if (-not $line) { throw 'ADMIN_API_KEY not found in .env.local' }
    $key = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
    if (-not $key) { throw 'ADMIN_API_KEY is empty in .env.local' }
    # Must match sessionValue() in src/lib/admin-auth.ts.
    $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($key))
    try { $hash = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes('racing-predictor-admin-session')) } finally { $hmac.Dispose() }
    return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

if ($MyInvocation.InvocationName -ne '.') {
    if (-not $ProjectRoot) { $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
    if (-not $ConfigPath) { $ConfigPath = Join-Path $env:LOCALAPPDATA 'RacingPredictor\real-betting-runner.json' }
    $logDir = Join-Path $ProjectRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $logFile = Join-Path $logDir "real-betting-$(Get-Date -Format 'yyyy-MM-dd').log"
    function Write-Log { param([string]$Text) "$(Get-Date -Format o) $Text" | Tee-Object -FilePath $logFile -Append }

    $lock = $null
    try {
        try {
            $lock = [System.IO.File]::Open((Join-Path $logDir 'real-betting.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        } catch [System.IO.IOException] {
            Write-Log 'Another real-betting runner is active; skipping'
            exit 0
        }
        if (-not (Test-Path $ConfigPath)) { throw "Runner config not found at $ConfigPath" }
        $config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
        Assert-RunnerConfig -Config $config
        Write-Log "Config OK: strategy '$($config.strategy.name)', mode $($config.mode), configId $($config.configId)"
        if ($ValidateOnly) { exit 0 }
        if ($config.mode -ceq 'disabled') {
            Write-Log 'Runner disabled; nothing to do'
            exit 0
        }

        $appUrl = Test-LoopbackAppUrl -Url $config.appUrl
        $health = Invoke-RestMethod -Uri "$appUrl/api/health" -Method Get -TimeoutSec 15 -MaximumRedirection 0
        if ($health.app -ne 'racing-predictor') { throw "Service at $appUrl is not racing-predictor" }

        $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        $session.Cookies.Add((New-Object System.Net.Cookie('racing_admin_session', (Get-AdminSessionCookie -ProjectRoot $ProjectRoot), '/', ([Uri]$appUrl).Host)))
        $body = [ordered]@{
            kind = 'DRY_RUN'
            idempotencyKey = "dry-run:$($config.configId):$(Get-DryRunSlot -UtcNow (Get-Date).ToUniversalTime())"
            runnerVersion = $RunnerVersion
            config = $config
        } | ConvertTo-Json -Depth 20 -Compress
        $response = Invoke-RestMethod -Uri "$appUrl/api/real-betting/dry-run" -Method Post -Body $body -ContentType 'application/json' `
            -WebSession $session -TimeoutSec 60 -MaximumRedirection 0
        if (-not $response.success -or $response.placed -ne $false) { throw "Unexpected dry-run response: $($response.message)" }
        Write-Log "OK    $($response.message) ($($response.decision))"
        exit 0
    } catch {
        Write-Log "FAIL  $($_.Exception.Message)"
        exit 1
    } finally {
        if ($lock) { $lock.Dispose() }
    }
}
