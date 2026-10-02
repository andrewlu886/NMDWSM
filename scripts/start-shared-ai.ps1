$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$logsDir = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
$statePath = Join-Path $logsDir 'shared-ai-processes.json'
if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if (Get-Process -Id $state.gatewayPid,$state.tunnelPid -ErrorAction SilentlyContinue) {
        throw '共用 AI 程序仍在執行。先執行 scripts\stop-shared-ai.ps1 再重新啟動。'
    }
}
$cloudflaredPath = Join-Path $projectRoot 'tools\cloudflared.exe'
if (-not (Test-Path -LiteralPath $cloudflaredPath)) {
    $installed = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $installed) { throw '請先安裝 cloudflared，參考 docs/shared-ai.md。' }
    $cloudflaredPath = $installed.Source
}
$nodePath = (Get-Command node -ErrorAction Stop).Source
& $nodePath (Join-Path $PSScriptRoot 'setup-ai-gateway.js')
if ($LASTEXITCODE -ne 0) { throw '建立密鑰失敗。' }
$tokenLine = Get-Content -LiteralPath (Join-Path $projectRoot '.env.ai-gateway') | Where-Object { $_ -match '^AI_GATEWAY_TOKEN=' } | Select-Object -First 1
$token = $tokenLine.Substring('AI_GATEWAY_TOKEN='.Length).Trim()
$gateway = $null
$tunnel = $null
try {
    $gateway = Start-Process -FilePath $nodePath -ArgumentList 'scripts/ai-gateway.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir 'ai-gateway.out.log') -RedirectStandardError (Join-Path $logsDir 'ai-gateway.err.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $gateway.Refresh()
        if ($gateway.HasExited) { throw '轉接服務啟動失敗，請查看 logs/ai-gateway.err.log。' }
        try {
            $models = Invoke-RestMethod -Uri 'http://127.0.0.1:11435/api/tags' -Headers @{ Authorization = 'Bearer ' + $token } -TimeoutSec 2
            $names = @($models.models | ForEach-Object name)
            if ('llama3.1:8b' -notin $names -or 'gemma3:4b' -notin $names) { throw 'MODEL_MISSING' }
            $ready = $true
            break
        } catch { if ($_.Exception.Message -eq 'MODEL_MISSING') { throw '請先下載 llama3.1:8b 與 gemma3:4b。' } }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw '無法連線到本機模型。' }
    $tunnelLog = Join-Path $logsDir 'ai-tunnel.err.log'
    $tunnel = Start-Process -FilePath $cloudflaredPath -ArgumentList @('tunnel','--url','http://127.0.0.1:11435','--no-autoupdate') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir 'ai-tunnel.out.log') -RedirectStandardError $tunnelLog
    $publicUrl = $null
    for ($attempt = 0; $attempt -lt 150; $attempt++) {
        $tunnel.Refresh()
        if ($tunnel.HasExited) { throw '通道啟動失敗，請查看 logs/ai-tunnel.err.log。' }
        if (Test-Path -LiteralPath $tunnelLog) {
            $tunnelContents = Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue
            if ($tunnelContents) {
                $urlMatch = [regex]::Match($tunnelContents, 'https://[a-z0-9-]+\.trycloudflare\.com')
                if ($urlMatch.Success) { $publicUrl = $urlMatch.Value; break }
            }
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $publicUrl) { throw '尚未取得通道網址。' }
    $renderConfig = "OLLAMA_BASE_URL=$publicUrl`nOLLAMA_API_KEY=$token`nOLLAMA_MODEL=llama3.1:8b`nOLLAMA_VISION_MODEL=gemma3:4b`nOLLAMA_TIMEOUT_MS=90000`nOLLAMA_STATUS_TIMEOUT_MS=5000`n"
    [System.IO.File]::WriteAllText((Join-Path $projectRoot '.env.render-ai'), $renderConfig, [System.Text.UTF8Encoding]::new($false))
    @{ gatewayPid=$gateway.Id; tunnelPid=$tunnel.Id; gatewayStartTicks=$gateway.StartTime.ToUniversalTime().Ticks; tunnelStartTicks=$tunnel.StartTime.ToUniversalTime().Ticks; publicUrl=$publicUrl } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    Write-Output "共用 AI 通道：$publicUrl"
    Write-Output 'Render 設定已存入 .env.render-ai（含密鑰，請勿公開或提交 GitHub）。'
} catch {
    if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id }
    if ($gateway -and -not $gateway.HasExited) { Stop-Process -Id $gateway.Id }
    throw
}