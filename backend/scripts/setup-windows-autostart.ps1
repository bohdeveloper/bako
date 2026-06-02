# BAKO - Configuracion de arranque automatico en Windows
# Ejecutar en PowerShell normal (NO administrador)
#
# Lo que hace este script:
#   1. Configura Cloudflare Tunnel para exponer Ollama a Render (OLLAMA_URL)
#   2. Configura OLLAMA_ORIGINS=* para que Ollama acepte peticiones externas
#   3. Crea una tarea programada que arranca el tunel al iniciar sesion
#
# Prerequisitos:
#   - cloudflared instalado: winget install Cloudflare.cloudflared
#   - Haber ejecutado: cloudflared tunnel login
#   - Haber ejecutado: cloudflared tunnel create bako-ollama
#   - Haber ejecutado: cloudflared tunnel route dns bako-ollama ollama.bohdeveloper.com
#   - Render con variable OLLAMA_URL=https://ollama.bohdeveloper.com

param(
  [string]$TunnelName   = "bako-ollama",
  [string]$TunnelHost   = "ollama.bohdeveloper.com",
  [string]$OllamaPort   = "11434",
  [string]$ConfigDir    = "$env:USERPROFILE\.cloudflared"
)

Write-Host ""
Write-Host "BAKO - Configurando arranque automatico en Windows" -ForegroundColor Cyan
Write-Host ""

# --- 1. Verificar cloudflared ---
Write-Host "1. Verificando cloudflared..." -ForegroundColor Yellow

$cfExe = (Get-Command cloudflared -ErrorAction SilentlyContinue)?.Source
if (-not $cfExe) {
  Write-Host "   ERROR: cloudflared no encontrado." -ForegroundColor Red
  Write-Host "   Instala con: winget install Cloudflare.cloudflared" -ForegroundColor Red
  exit 1
}
Write-Host "   OK: $cfExe" -ForegroundColor Green

# --- 2. Verificar tunnel y credenciales ---
Write-Host ""
Write-Host "2. Verificando tunel '$TunnelName'..." -ForegroundColor Yellow

$tunnelInfo = cloudflared tunnel info $TunnelName 2>&1
if ($tunnelInfo -match "does not exist") {
  Write-Host "   ERROR: El tunel '$TunnelName' no existe." -ForegroundColor Red
  Write-Host "   Crealo con: cloudflared tunnel create $TunnelName" -ForegroundColor Red
  exit 1
}

# Obtener el ID del tunel
$tunnelId = ($tunnelInfo | Select-String -Pattern "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").Matches.Value | Select-Object -First 1
if (-not $tunnelId) {
  Write-Host "   ERROR: No se pudo obtener el ID del tunel." -ForegroundColor Red
  exit 1
}
Write-Host "   OK: ID del tunel = $tunnelId" -ForegroundColor Green

$credFile = "$ConfigDir\$tunnelId.json"
if (-not (Test-Path $credFile)) {
  Write-Host "   ERROR: Credenciales no encontradas en $credFile" -ForegroundColor Red
  Write-Host "   Ejecuta: cloudflared tunnel login" -ForegroundColor Red
  exit 1
}

# --- 3. Crear/actualizar config.yml ---
Write-Host ""
Write-Host "3. Creando config.yml..." -ForegroundColor Yellow

$configPath = "$ConfigDir\config.yml"
$configContent = @"
tunnel: $tunnelId
credentials-file: $credFile

ingress:
  - hostname: $TunnelHost
    service: http://localhost:$OllamaPort
    originRequest:
      httpHostHeader: "localhost"
  - service: http_status:404
"@

Set-Content -Path $configPath -Value $configContent -Encoding UTF8
Write-Host "   OK: $configPath" -ForegroundColor Green

# --- 4. Configurar OLLAMA_ORIGINS ---
Write-Host ""
Write-Host "4. Configurando OLLAMA_ORIGINS=*..." -ForegroundColor Yellow
[System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
Write-Host "   OK: OLLAMA_ORIGINS=* (nivel usuario)" -ForegroundColor Green
Write-Host "   Reinicia Ollama para que aplique el cambio." -ForegroundColor DarkYellow

# --- 5. Task Scheduler ---
Write-Host ""
Write-Host "5. Configurando Task Scheduler para el tunel..." -ForegroundColor Yellow

$action   = New-ScheduledTaskAction -Execute $cfExe -Argument "tunnel --config `"$configPath`" run $TunnelName"
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName "BAKO-Ollama-Tunnel" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "   OK: Tarea 'BAKO-Ollama-Tunnel' registrada" -ForegroundColor Green

# Arrancarlo ahora
Stop-Process -Name "cloudflared" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName "BAKO-Ollama-Tunnel"
Start-Sleep -Seconds 6

$cf = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue
if ($cf) {
  Write-Host "   OK: Tunel arrancado (PID $($cf.Id))" -ForegroundColor Green
} else {
  Write-Host "   ADVERTENCIA: El proceso no arranco. Comprueba cloudflared tunnel info $TunnelName" -ForegroundColor Yellow
}

# --- 6. Resumen ---
Write-Host ""
Write-Host "-----------------------------------------" -ForegroundColor DarkGray
Write-Host "Configuracion completada" -ForegroundColor Green
Write-Host ""
Write-Host "Al iniciar sesion en Windows:" -ForegroundColor Cyan
Write-Host "  - Ollama arranca automaticamente (Startup folder)"
Write-Host "  - Cloudflare Tunnel arranca via Task Scheduler"
Write-Host "  - Render detecta Ollama y lo usa como LLM"
Write-Host ""
Write-Host "Cuando el PC se apaga:" -ForegroundColor Cyan
Write-Host "  - El tunel cae, Render vuelve a Groq automaticamente"
Write-Host ""
Write-Host "Comandos utiles:" -ForegroundColor Cyan
Write-Host "  cloudflared tunnel info $TunnelName    -> estado del tunel"
Write-Host "  Get-Process cloudflared                -> proceso activo"
Write-Host "  /servicio (Telegram)                   -> que LLM usa BAKO ahora"
Write-Host "  /llm ollama|groq|auto (Telegram)       -> cambiar LLM manualmente"
Write-Host ""
Write-Host "Variable en Render:" -ForegroundColor Cyan
Write-Host "  OLLAMA_URL=https://$TunnelHost"
Write-Host ""
