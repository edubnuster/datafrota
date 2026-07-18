param(
  [string]$SaasRoot = "C:\databrev",
  [string]$CashierAppDir = "C:\Program Files\Datafrota",
  [string]$CashierDataDir
)

$ErrorActionPreference = "Stop"

$cashierDataRoot = if ([string]::IsNullOrWhiteSpace($env:ProgramData)) { "C:\ProgramData" } else { $env:ProgramData }
$cashierDataDir = if ([string]::IsNullOrWhiteSpace($CashierDataDir)) { Join-Path $cashierDataRoot "Datafrota" } else { $CashierDataDir }
$logsDir = Join-Path $SaasRoot ".run"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-DataFrotaProcesses {
  param([string]$RootPath)

  $normalizedRoot = $RootPath.ToLowerInvariant()
  $idsToStop = New-Object System.Collections.Generic.HashSet[int]

  Write-Step "Encerrando processos presos nas portas 3001 e 5173"
  foreach ($port in @(3001, 5173)) {
    try {
      $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
      foreach ($connection in $connections) {
        if ($connection.OwningProcess -gt 0) {
          [void]$idsToStop.Add([int]$connection.OwningProcess)
        }
      }
    } catch {
    }
  }

  Write-Step "Localizando processos do projeto DATAFROTA"
  try {
    $processes = Get-CimInstance Win32_Process -ErrorAction Stop
    foreach ($process in $processes) {
      $commandLine = [string]$process.CommandLine
      $name = [string]$process.Name
      $matchesRoot = $commandLine.ToLowerInvariant().Contains($normalizedRoot)
      $matchesPythonUi = $commandLine.ToLowerInvariant().Contains("integracao_frota_app.py")
      $matchesNodeDev = $commandLine.ToLowerInvariant().Contains("server:dev") -or
        $commandLine.ToLowerInvariant().Contains("client:dev") -or
        $commandLine.ToLowerInvariant().Contains("vite") -or
        $commandLine.ToLowerInvariant().Contains("nodemon") -or
        $commandLine.ToLowerInvariant().Contains("tsx api/server.ts")

      if ($matchesRoot -or $matchesPythonUi -or (($name -match "^(node|npm|python|py|powershell|pwsh)(\.exe)?$") -and $matchesNodeDev)) {
        if ($process.ProcessId -gt 0 -and $process.ProcessId -ne $PID) {
          [void]$idsToStop.Add([int]$process.ProcessId)
        }
      }
    }
  } catch {
    Write-Warning "Nao foi possivel listar todos os processos via CIM: $($_.Exception.Message)"
  }

  if ($idsToStop.Count -eq 0) {
    Write-Host "Nenhum processo ativo do DATAFROTA foi encontrado." -ForegroundColor DarkGray
    return
  }

  foreach ($processId in ($idsToStop | Sort-Object -Descending)) {
    try {
      $processInfo = Get-Process -Id $processId -ErrorAction Stop
      Write-Host ("Encerrando PID {0} ({1})" -f $processId, $processInfo.ProcessName) -ForegroundColor Yellow
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      Write-Host ("PID {0} ja estava encerrado ou inacessivel." -f $processId) -ForegroundColor DarkGray
    }
  }

  Start-Sleep -Seconds 2
}

function Get-PythonLauncher {
  $pythonw = Get-Command pythonw -ErrorAction SilentlyContinue
  if ($pythonw) {
    return $pythonw.Source
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return $python.Source
  }

  if (Get-Command py -ErrorAction SilentlyContinue) {
    return (Get-Command py -ErrorAction SilentlyContinue).Source
  }

  throw "Python nao encontrado no PATH."
}

function Start-BackgroundPython {
  param(
    [Parameter(Mandatory = $true)][string]$PythonExe,
    [Parameter(Mandatory = $true)][string]$ScriptPath
  )

  $pythonLeaf = (Split-Path -Leaf $PythonExe).ToLowerInvariant()
  $args = if ($pythonLeaf -eq "py.exe") {
    @("-3", $ScriptPath)
  } else {
    @($ScriptPath)
  }

  return Start-Process -FilePath $PythonExe `
    -ArgumentList $args `
    -WorkingDirectory (Split-Path -Parent $ScriptPath) `
    -WindowStyle Hidden `
    -PassThru
}

function Wait-HttpReady {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Name,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Host "$Name respondeu em $Url" -ForegroundColor Green
        return
      }
    } catch {
    }

    Start-Sleep -Milliseconds 800
  } while ((Get-Date) -lt $deadline)

  throw "$Name nao respondeu em $Url dentro de $TimeoutSeconds segundos."
}

function Start-DevWindow {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Command
  )

  $quotedRoot = $SaasRoot.Replace("'", "''")
  $quotedTitle = $Title.Replace("'", "''")
  $wrappedCommand = @"
$Host.UI.RawUI.WindowTitle = '$quotedTitle'
Set-Location '$quotedRoot'
$Command
"@

  return Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $wrappedCommand) `
    -WorkingDirectory $SaasRoot `
    -PassThru
}

Write-Step "Reiniciando ambiente DATAFROTA"
if (-not (Test-Path $SaasRoot)) {
  throw "Diretorio do SaaS web nao encontrado: $SaasRoot"
}

if (-not (Test-Path $CashierAppDir)) {
  throw "Diretorio do app do caixa nao encontrado: $CashierAppDir"
}

if (!(Test-Path $cashierDataDir)) {
  New-Item -ItemType Directory -Path $cashierDataDir -Force | Out-Null
}

Stop-DataFrotaProcesses -RootPath $SaasRoot

$pythonLauncher = Get-PythonLauncher
$pythonApp = Join-Path $CashierAppDir "integracao_frota_app.py"

if (-not (Test-Path $pythonApp)) {
  throw "Arquivo do integrador nao encontrado em $pythonApp"
}

[Environment]::SetEnvironmentVariable("FROTA_APP_DATA_DIR", $cashierDataDir, "Process")

Write-Step "Subindo API"
$apiProcess = Start-DevWindow -Title "DATAFROTA API" -Command "npm.cmd run server:dev"
Wait-HttpReady -Name "API" -Url "http://127.0.0.1:3001/api/health"

Write-Step "Subindo gerador web"
$clientProcess = Start-DevWindow -Title "DATAFROTA WEB" -Command "npm.cmd run client:dev -- --host 127.0.0.1"
Wait-HttpReady -Name "Gerador web" -Url "http://127.0.0.1:5173"

Write-Step "Subindo integrador Python"
$pyProcess = Start-BackgroundPython -PythonExe $pythonLauncher -ScriptPath $pythonApp

Write-Step "Abrindo gerador no navegador"
Start-Process "http://127.0.0.1:5173"

Write-Host ""
Write-Host "Ambiente pronto para teste." -ForegroundColor Green
Write-Host ("API PID: {0}" -f $apiProcess.Id)
Write-Host ("WEB PID: {0}" -f $clientProcess.Id)
Write-Host ("PY PID: {0}" -f $pyProcess.Id)
