# BAKO — Configuración de arranque automático en Windows
# Ejecutar como Administrador: PowerShell → clic derecho → "Ejecutar como administrador"
# Luego: cd C:\Cursos\react\apps\ai-personal-os\backend && .\scripts\setup-windows-autostart.ps1

param(
  [string]$BackendPath = "C:\Cursos\react\apps\ai-personal-os\backend"
)

Write-Host "`n🤖 BAKO — Configurando arranque automático en Windows`n" -ForegroundColor Cyan

# ─── 1. OLLAMA como servicio de Windows ───────────────────────────────────────
Write-Host "1️⃣  Configurando Ollama como servicio..." -ForegroundColor Yellow

$ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
if (-not (Test-Path $ollamaExe)) {
  Write-Host "   ❌ Ollama no encontrado en $ollamaExe" -ForegroundColor Red
  Write-Host "   Descárgalo en https://ollama.ai e instálalo primero." -ForegroundColor Red
} else {
  $existingService = Get-Service -Name "Ollama" -ErrorAction SilentlyContinue
  if ($existingService) {
    Write-Host "   ✅ Servicio Ollama ya existe (estado: $($existingService.Status))" -ForegroundColor Green
  } else {
    sc.exe create Ollama binPath= "`"$ollamaExe`" serve" start= auto DisplayName= "Ollama LLM Service" | Out-Null
    sc.exe description Ollama "Servidor LLM local para BAKO — Borja's Autonomous Knowledge Operator" | Out-Null
    sc.exe start Ollama | Out-Null
    Write-Host "   ✅ Servicio Ollama creado y arrancado" -ForegroundColor Green
  }

  $status = (Get-Service -Name "Ollama").Status
  Write-Host "   Estado actual: $status" -ForegroundColor $(if ($status -eq "Running") { "Green" } else { "Yellow" })
}

# ─── 2. PM2 para el backend Node.js ───────────────────────────────────────────
Write-Host "`n2️⃣  Configurando BAKO backend con PM2..." -ForegroundColor Yellow

$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2) {
  Write-Host "   Instalando PM2 globalmente..." -ForegroundColor Gray
  npm install -g pm2 | Out-Null
  npm install -g pm2-windows-startup | Out-Null
}

Set-Location $BackendPath

# Compilar TypeScript
Write-Host "   Compilando TypeScript..." -ForegroundColor Gray
npm run build 2>&1 | Out-Null

# Registrar en PM2
pm2 delete bako-backend --silent 2>$null
pm2 start dist/index.js --name "bako-backend" --cwd $BackendPath
pm2 save

# Configurar arranque automático con Windows
pm2-startup install

Write-Host "   ✅ BAKO backend registrado en PM2 con arranque automático" -ForegroundColor Green

# ─── 3. Resumen ───────────────────────────────────────────────────────────────
Write-Host "`n─────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "✅ Configuración completada" -ForegroundColor Green
Write-Host ""
Write-Host "Próximo arranque de Windows:" -ForegroundColor Cyan
Write-Host "  • Ollama arrancará automáticamente (servicio Windows)"
Write-Host "  • BAKO backend arrancará automáticamente (PM2)"
Write-Host ""
Write-Host "Comandos útiles:" -ForegroundColor Cyan
Write-Host "  pm2 status              → ver estado de BAKO"
Write-Host "  pm2 logs bako-backend   → ver logs en tiempo real"
Write-Host "  pm2 restart bako-backend → reiniciar"
Write-Host "  sc.exe query Ollama     → estado del servicio Ollama"
Write-Host ""
