$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$composeProjectName = "datafrota"
$backendTimeoutSeconds = 60
$frontendTimeoutSeconds = 120

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Wait-HttpReady {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Service,
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null
  $attempt = 0
  do {
    $attempt += 1
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        Write-Host "$Name respondeu em $Url" -ForegroundColor Green
        return
      }
      $lastError = "StatusCode=$($response.StatusCode)"
    } catch {
      $lastError = $_.Exception.Message
    }

    Start-Sleep -Milliseconds 1000
  } while ((Get-Date) -lt $deadline)

  Write-Warning "$Name indisponivel apos $attempt tentativa(s). Ultimo erro: $lastError"
  try {
    docker compose ps -a
  } catch {
    Write-Warning "Nao foi possivel coletar o estado dos containers: $($_.Exception.Message)"
  }

  if ($Service) {
    try {
      Write-Warning "Ultimos logs de ${Service}:"
      docker compose logs $Service --tail 120
    } catch {
      Write-Warning "Nao foi possivel coletar os logs de ${Service}: $($_.Exception.Message)"
    }
  }

  throw "$Name nao respondeu em $Url dentro de $TimeoutSeconds segundos."
}

function Invoke-Compose {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args
  )

  & docker compose -p $composeProjectName @Args
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Args -join ' ') falhou com codigo $LASTEXITCODE."
  }
}

function Invoke-ComposeWithTimeout {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args,
    [int]$TimeoutSeconds = 30
  )

  $dockerPath = (Get-Command docker -ErrorAction Stop).Source
  $argumentList = @("compose", "-p", $composeProjectName) + $Args
  $process = Start-Process -FilePath $dockerPath -ArgumentList $argumentList -WorkingDirectory $projectRoot -PassThru -NoNewWindow

  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    } catch {
      Write-Warning "Nao foi possivel encerrar o processo docker compose preso: $($_.Exception.Message)"
    }
    throw "docker compose $($Args -join ' ') excedeu o timeout de $TimeoutSeconds segundos."
  }

  if ($process.ExitCode -ne 0) {
    throw "docker compose $($Args -join ' ') falhou com codigo $($process.ExitCode)."
  }
}

function Remove-StaleContainers {
  $containerNames = @("datafrota-backend", "datafrota-frontend")
  $dockerPath = (Get-Command docker -ErrorAction Stop).Source
  foreach ($containerName in $containerNames) {
    try {
      $process = Start-Process -FilePath $dockerPath -ArgumentList @("rm", "-f", $containerName) -WorkingDirectory $projectRoot -PassThru -NoNewWindow
      if (-not $process.WaitForExit(15000)) {
        try {
          Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        } catch {
          Write-Warning "Nao foi possivel encerrar o docker rm preso para ${containerName}: $($_.Exception.Message)"
        }
        throw "docker rm -f ${containerName} excedeu o timeout de 15 segundos."
      }

      if ($process.ExitCode -eq 0) {
        Write-Host "Container $containerName removido a forca." -ForegroundColor Yellow
      } elseif ($process.ExitCode -ne 1) {
        throw "docker rm -f ${containerName} falhou com codigo $($process.ExitCode)."
      }
    } catch {
      Write-Warning "Falha ao remover ${containerName}: $($_.Exception.Message)"
      throw "Nao foi possivel remover os containers travados. Reinicie o Docker Desktop e execute o script novamente."
    }
  }
}

Write-Step "Reiniciando stack Docker do DATAFROTA"
Set-Location $projectRoot

Write-Step "Derrubando containers antigos"
try {
  Invoke-ComposeWithTimeout -Args @("down", "--remove-orphans", "--timeout", "10") -TimeoutSeconds 30
} catch {
  Write-Warning "$($_.Exception.Message) Aplicando fallback com remocao forcada dos containers."
  Remove-StaleContainers
}

Write-Step "Subindo frontend e backend com rebuild"
Invoke-Compose -Args @("up", "-d", "--build")

Write-Step "Aguardando backend"
Wait-HttpReady -Name "Backend" -Service "backend" -Url "http://127.0.0.1:3001/api/health" -TimeoutSeconds $backendTimeoutSeconds

Write-Step "Aguardando frontend"
Wait-HttpReady -Name "Frontend" -Service "frontend" -Url "http://127.0.0.1:8080" -TimeoutSeconds $frontendTimeoutSeconds

Write-Step "Aguardando proxy do frontend para a API"
Wait-HttpReady -Name "Frontend API Proxy" -Service "frontend" -Url "http://127.0.0.1:8080/api/health" -TimeoutSeconds $frontendTimeoutSeconds

Write-Step "Abrindo frontend no navegador"
Start-Process "http://127.0.0.1:8080"

Write-Host ""
Write-Host "Ambiente Docker pronto para teste." -ForegroundColor Green
