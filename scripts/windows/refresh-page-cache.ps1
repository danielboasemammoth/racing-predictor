param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $true)]$WebSession,
    [switch]$PollOnly
)

$keys = if ($PollOnly) { @('opportunities', 'validation', 'place-shadow') } else { @('home', 'opportunities', 'results', 'validation', 'place-shadow', 'picks-history', 'accuracy', 'analytics') }
$failed = $false
foreach ($key in $keys) {
    try {
        $response = Invoke-RestMethod -Uri "$BaseUrl/api/admin/page-cache" -Method Post -ContentType 'application/json' `
            -Body (@{ key = $key } | ConvertTo-Json) -WebSession $WebSession -TimeoutSec 300
        if (-not $response.success) { throw 'Snapshot publication failed' }
        Write-Log "OK    Page snapshot $key published" | Out-Host
    } catch {
        $failed = $true
        Write-Log "FAIL  Page snapshot $key -> $($_.Exception.Message); previous snapshot retained" | Out-Host
    }
}
return (-not $failed)