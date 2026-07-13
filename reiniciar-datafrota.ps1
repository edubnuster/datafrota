$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$logsDir = Join-Path $projectRoot ".run"

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
  if (Get-Command python -ErrorAction SilentlyContinue) {
    return "python"
  }

  if (Get-Command py -ErrorAction SilentlyContinue) {
    return "py -3"
  }

  throw "Python nao encontrado no PATH."
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

  $quotedRoot = $projectRoot.Replace("'", "''")
  $quotedTitle = $Title.Replace("'", "''")
  $wrappedCommand = @"
$Host.UI.RawUI.WindowTitle = '$quotedTitle'
Set-Location '$quotedRoot'
$Command
"@

  return Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $wrappedCommand) `
    -WorkingDirectory $projectRoot `
    -PassThru
}

Write-Step "Reiniciando ambiente DATAFROTA"
Stop-DataFrotaProcesses -RootPath $projectRoot

$pythonLauncher = Get-PythonLauncher
$pythonApp = Join-Path $projectRoot "cashier_app\integracao_frota_app.py"

if (-not (Test-Path $pythonApp)) {
  throw "Arquivo do integrador nao encontrado em $pythonApp"
}

Write-Step "Subindo API"
$apiProcess = Start-DevWindow -Title "DATAFROTA API" -Command "npm.cmd run server:dev"
Wait-HttpReady -Name "API" -Url "http://127.0.0.1:3001/api/health"

Write-Step "Subindo gerador web"
$clientProcess = Start-DevWindow -Title "DATAFROTA WEB" -Command "npm.cmd run client:dev -- --host 127.0.0.1"
Wait-HttpReady -Name "Gerador web" -Url "http://127.0.0.1:5173"

Write-Step "Subindo integrador Python"
$pythonCommand = "$pythonLauncher `"$pythonApp`""
$pyProcess = Start-DevWindow -Title "DATAFROTA INTEGRADOR" -Command $pythonCommand

Write-Step "Abrindo gerador no navegador"
Start-Process "http://127.0.0.1:5173"

Write-Host ""
Write-Host "Ambiente pronto para teste." -ForegroundColor Green
Write-Host ("API PID: {0}" -f $apiProcess.Id)
Write-Host ("WEB PID: {0}" -f $clientProcess.Id)
Write-Host ("PY PID: {0}" -f $pyProcess.Id)
