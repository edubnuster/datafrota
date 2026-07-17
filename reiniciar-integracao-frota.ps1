param(
  [switch]$NoConsole,
  [string]$Python
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cashierAppDir = Join-Path $projectRoot "cashier_app"
$cacheFile = Join-Path $cashierAppDir "pdv_promotions_cache.json"
$pyCacheDir = Join-Path $cashierAppDir "__pycache__"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-PythonExecutable {
  param([switch]$NoConsole, [string]$Override)

  if ($Override) {
    return $Override
  }

  if ($NoConsole) {
    $pythonw = Get-Command pythonw -ErrorAction SilentlyContinue
    if ($pythonw) {
      return $pythonw.Source
    }
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return $python.Source
  }

  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return $py.Source
  }

  throw "Nao foi possivel localizar python/pythonw/py no PATH. Informe -Python com o caminho do executavel."
}

function Stop-IntegrationProcess {
  Write-Step "Encerrando integracao_frota_app.py (se estiver em execucao)"

  $targets = @()
  try {
    $targets = Get-CimInstance Win32_Process |
      Where-Object {
        ($_.Name -in @("python.exe", "pythonw.exe", "py.exe")) -and
        ($_.CommandLine -and $_.CommandLine -match "integracao_frota_app\.py")
      }
  } catch {
    $targets = @()
  }

  if ($targets.Count -gt 0) {
    $pids = $targets | ForEach-Object { $_.ProcessId } | Sort-Object -Unique
    foreach ($procId in $pids) {
      try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
      } catch {
        Write-Warning "Nao foi possivel encerrar o processo PID=${procId}: $($_.Exception.Message)"
      }
    }
    return
  }

  $fallback = @()
  try {
    $fallback = Get-Process python, pythonw -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowTitle -match "integra(c|ç)ao\\s+frota|integracao\\s+frota" }
  } catch {
    $fallback = @()
  }

  foreach ($proc in $fallback) {
    try {
      Stop-Process -Id $proc.Id -Force -ErrorAction Stop
    } catch {
      Write-Warning "Nao foi possivel encerrar o processo PID=$($proc.Id): $($_.Exception.Message)"
    }
  }
}

function Clear-IntegrationCache {
  Write-Step "Limpando cache local do PDV"

  if (Test-Path $cacheFile) {
    Remove-Item $cacheFile -Force
    Write-Host "Cache removido: $cacheFile" -ForegroundColor Green
  } else {
    Write-Host "Cache nao encontrado: $cacheFile" -ForegroundColor DarkGray
  }

  if (Test-Path $pyCacheDir) {
    Remove-Item $pyCacheDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Start-IntegrationProcess {
  param([string]$PythonExe, [switch]$NoConsole)

  Write-Step "Iniciando integracao frota"
  if (!(Test-Path $cashierAppDir)) {
    throw "Pasta nao encontrada: $cashierAppDir"
  }

  $scriptPath = Join-Path $cashierAppDir "integracao_frota_app.py"
  if (!(Test-Path $scriptPath)) {
    throw "Arquivo nao encontrado: $scriptPath"
  }

  if ((Split-Path -Leaf $PythonExe).ToLower() -eq "py.exe") {
    Start-Process -WorkingDirectory $cashierAppDir -FilePath $PythonExe -ArgumentList @("-3", ".\\integracao_frota_app.py")
  } else {
    Start-Process -WorkingDirectory $cashierAppDir -FilePath $PythonExe -ArgumentList @(".\\integracao_frota_app.py")
  }

  Write-Host "Integracao iniciada." -ForegroundColor Green
}

Write-Step "Reiniciando integracao frota (limpeza de cache + restart)"
Set-Location $projectRoot

Stop-IntegrationProcess
Clear-IntegrationCache

$pythonExe = Resolve-PythonExecutable -NoConsole:$NoConsole -Override $Python
Start-IntegrationProcess -PythonExe $pythonExe -NoConsole:$NoConsole
