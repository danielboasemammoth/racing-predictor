$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$runnerPath = Join-Path $PSScriptRoot 'run-real-betting.ps1'
$registerPath = Join-Path $PSScriptRoot 'register-real-betting-task.ps1'
$asts = @{}
foreach ($path in @($runnerPath, $registerPath)) {
    $asts[$path] = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Pattern, [string]$Label)
    try { & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "$Label threw unexpected message: $($_.Exception.Message)" }
        return
    }
    throw "$Label did not throw"
}

. $runnerPath

$validJson = @'
{"schema":1,"provider":"tab","mode":"disabled","enabled":false,"configId":"11111111-2222-4333-8444-555555555555","exportedAt":"2026-10-01T00:00:00.000Z",
 "appUrl":"http://localhost:3000","strategy":{"schema":1,"name":"Place value","savedAt":"2026-10-01T00:00:00.000Z","preferences":{"schema":1,"filters":{},"settings":{},"count":500,"sort":"start"}},
 "limits":{"currency":"AUD","maxStake":5,"maxDailyStake":20,"maxOpenExposure":20}}
'@
function New-Config { $validJson | ConvertFrom-Json }

Assert-RunnerConfig -Config (New-Config)
$dryRun = New-Config; $dryRun.mode = 'dry-run'; Assert-RunnerConfig -Config $dryRun
$fractional = New-Config; $fractional.limits.maxStake = 2.5; Assert-RunnerConfig -Config $fractional

foreach ($mode in @('live', 'LIVE', 'Dry-Run', '', $null)) {
    $config = New-Config; $config.mode = $mode
    Assert-Throws { Assert-RunnerConfig -Config $config } 'refused' "mode '$mode'"
}
foreach ($enabled in @($true, 'false', 0)) {
    $config = New-Config; $config.enabled = $enabled
    Assert-Throws { Assert-RunnerConfig -Config $config } 'enabled must be false' "enabled '$enabled'"
}
$config = New-Config; $config | Add-Member -NotePropertyName password -NotePropertyValue 'x'
Assert-Throws { Assert-RunnerConfig -Config $config } 'credentials' 'top-level credential'
$config = New-Config; $config.strategy | Add-Member -NotePropertyName apiKey -NotePropertyValue 'x'
Assert-Throws { Assert-RunnerConfig -Config $config } 'credentials' 'nested credential'
$config = New-Config; $config | Add-Member -NotePropertyName endpoint -NotePropertyValue 'https://example.com'
Assert-Throws { Assert-RunnerConfig -Config $config } 'Unsupported' 'unknown field'
$config = New-Config; $config.provider = 'betfair'
Assert-Throws { Assert-RunnerConfig -Config $config } 'Provider' 'provider'
foreach ($limit in @(@('maxStake', 0), @('maxStake', 51), @('maxStake', 1.005), @('maxDailyStake', 1000), @('maxOpenExposure', 'x'))) {
    $config = New-Config; $config.limits.($limit[0]) = $limit[1]
    Assert-Throws { Assert-RunnerConfig -Config $config } $limit[0] "limit $($limit -join '=')"
}
$config = New-Config; $config.limits.maxStake = 20; $config.limits.maxOpenExposure = 10
Assert-Throws { Assert-RunnerConfig -Config $config } 'maxStake cannot exceed' 'inconsistent limits'

foreach ($url in @('http://localhost:3000', 'http://127.0.0.1:3001/', 'https://localhost')) {
    if (-not (Test-LoopbackAppUrl -Url $url)) { throw "Loopback URL rejected: $url" }
}
foreach ($url in @('https://racing-predictor-topaz.vercel.app', 'https://api.beta.tab.com.au', 'http://localhost.evil.com', 'http://10.0.0.2:3000', 'http://user:pw@localhost:3000', 'http://localhost:3000/api', 'file:///c:/x', 'not a url')) {
    if (Test-LoopbackAppUrl -Url $url) { throw "Non-loopback URL accepted: $url" }
    $config = New-Config; $config.appUrl = $url
    Assert-Throws { Assert-RunnerConfig -Config $config } 'loopback' "appUrl $url"
}

Assert-Throws { Invoke-TabProvider } 'not implemented' 'provider placeholder'
$slotA = Get-DryRunSlot -UtcNow ([datetime]::new(2026, 10, 1, 2, 1, 0, [DateTimeKind]::Utc))
$slotB = Get-DryRunSlot -UtcNow ([datetime]::new(2026, 10, 1, 2, 14, 59, [DateTimeKind]::Utc))
$slotC = Get-DryRunSlot -UtcNow ([datetime]::new(2026, 10, 1, 2, 15, 0, [DateTimeKind]::Utc))
if ($slotA -ne '202610010200' -or $slotA -ne $slotB -or $slotC -ne '202610010215') { throw "Unexpected dry-run slots: $slotA $slotB $slotC" }

$runnerText = Get-Content -Raw $runnerPath
if ($runnerText -match 'tab\.com\.au|Import-Clixml|Get-Credential') { throw 'Runner must not contact TAB or read credentials' }
$runnerCalls = $asts[$runnerPath].FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() }
if ($runnerCalls -contains 'Invoke-TabProvider') { throw 'Runner must not invoke the provider placeholder in any mode' }
$requests = $asts[$runnerPath].FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -in @('Invoke-RestMethod', 'Invoke-WebRequest') }, $true)
foreach ($request in $requests) {
    if ($request.Extent.Text -notmatch '\$appUrl/api/' -or $request.Extent.Text -notmatch 'MaximumRedirection 0') { throw "Runner request must target the loopback app without redirects: $($request.Extent.Text)" }
}

$registerAst = $asts[$registerPath]
$firstStatement = $registerAst.EndBlock.Statements[0].Extent.Text
if ($firstStatement -notmatch 'IUnderstandDryRunOnly' -or $firstStatement -notmatch 'throw') { throw 'Registration must refuse without explicit opt-in before doing anything' }
$registerCalls = $registerAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)
$registerNames = $registerCalls | ForEach-Object { $_.GetCommandName() }
if ($registerNames -contains 'Enable-ScheduledTask' -or $registerNames -contains 'Start-ScheduledTask') { throw 'Registration must not enable or start the task' }
$settingsCall = $registerCalls | Where-Object { $_.GetCommandName() -eq 'New-ScheduledTaskSettingsSet' }
if (-not $settingsCall -or $settingsCall.Extent.Text -notmatch '-Disable\b') { throw 'Task must be registered disabled' }
if ((Get-Content -Raw $registerPath) -notmatch '-ValidateOnly[\s\S]*LASTEXITCODE[\s\S]*Register-ScheduledTask') { throw 'Registration must validate config before registering' }

Write-Host 'Real-betting runner checks passed' -ForegroundColor Green
