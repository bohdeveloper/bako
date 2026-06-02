# BAKO - Configuracion de arranque automatico en Windows
# Ejecutar como Administrador

param(
  [string]$BackendPath = "C:\aplic\ai-personal-os\backend"
)

Write-Host ""
Write-Host "BAKO - Configurando arranque automatico en Windows" -ForegroundColor Cyan
Write-Host ""

# --- 1. OLLAMA como servicio de Windows ---
Write-Host "1. Configurando Ollama como servicio..." -ForegroundColor Yellow

$ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
if (-not (Test-Path $ollamaExe)) {
  Write-Host "   ERROR: Ollama no encontrado en $ollamaExe" -ForegroundColor Red
  Write-Host "   Descargalo en https://ollama.ai e instalalo primero." -ForegroundColor Red
} else {
  $existingService = Get-Service -Name "Ollama" -ErrorAction SilentlyContinue
  if ($existingService) {
    Write-Host "   OK: Servicio Ollama ya existe (estado: $($existingService.Status))" -ForegroundColor Green
  } else {
    sc.exe create Ollama binPath= "`"$ollamaExe`" serve" start= auto DisplayName= "Ollama LLM Service" | Out-Null
    sc.exe description Ollama "Servidor LLM local para BAKO" | Out-Null
    sc.exe start Ollama | Out-Null
    Write-Host "   OK: Servicio Ollama creado y arrancado" -ForegroundColor Green
  }

  $status = (Get-Service -Name "Ollama").Status
  if ($status -eq "Running") {
    Write-Host "   Estado actual: $status" -ForegroundColor Green
  } else {
    Write-Host "   Estado actual: $status" -ForegroundColor Yellow
  }
}

# --- 2. PM2 para el backend Node.js ---
Write-Host ""
Write-Host "2. Configurando BAKO backend con PM2..." -ForegroundColor Yellow

$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2) {
  Write-Host "   Instalando PM2 globalmente..." -ForegroundColor Gray
  npm install -g pm2 | Out-Null
  npm install -g pm2-windows-startup | Out-Null
}

Set-Location $BackendPath

Write-Host "   Compilando TypeScript..." -ForegroundColor Gray
npm run build 2>&1 | Out-Null

pm2 delete bako-backend --silent 2>$null
pm2 start dist/index.js --name "bako-backend" --cwd $BackendPath
pm2 save

pm2-startup install

Write-Host "   OK: BAKO backend registrado en PM2 con arranque automatico" -ForegroundColor Green

# --- 3. Resumen ---
Write-Host ""
Write-Host "-----------------------------------------" -ForegroundColor DarkGray
Write-Host "Configuracion completada" -ForegroundColor Green
Write-Host ""
Write-Host "Proximo arranque de Windows:" -ForegroundColor Cyan
Write-Host "  - Ollama arrancara automaticamente (servicio Windows)"
Write-Host "  - BAKO backend arrancara automaticamente (PM2)"
Write-Host ""
Write-Host "Comandos utiles:" -ForegroundColor Cyan
Write-Host "  pm2 status               -> ver estado de BAKO"
Write-Host "  pm2 logs bako-backend    -> ver logs en tiempo real"
Write-Host "  pm2 restart bako-backend -> reiniciar"
Write-Host "  sc.exe query Ollama      -> estado del servicio Ollama"
Write-Host ""
