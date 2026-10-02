$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $projectRoot 'logs\shared-ai-processes.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output '沒有記錄中的共用 AI 程序。'; exit }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
foreach ($kind in @('gateway','tunnel')) {
    $processId = $state.($kind + 'Pid')
    $recordedStart = $state.($kind + 'StartTicks')
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process -and  $process.StartTime.ToUniversalTime().Ticks -eq [long]$recordedStart) {
        Stop-Process -Id $processId
    }
}
Remove-Item -LiteralPath $statePath
Write-Output '已停止共用 AI 轉接服務與通道；Ollama 保持原狀。'