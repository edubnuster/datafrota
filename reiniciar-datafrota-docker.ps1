$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Wait-HttpReady {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Name,
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Host "$Name respondeu em $Url" -ForegroundColor Green
        return
      }
    } catch {
    }

    Start-Sleep -Milliseconds 1000
  } while ((Get-Date) -lt $deadline)

  throw "$Name nao respondeu em $Url dentro de $TimeoutSeconds segundos."
}

Write-Step "Reiniciando stack Docker do DATAFROTA"
Set-Location $projectRoot

Write-Step "Derrubando containers antigos"
docker compose down

Write-Step "Subindo frontend e backend com rebuild"
docker compose up -d --build

Write-Step "Aguardando backend"
Wait-HttpReady -Name "Backend" -Url "http://127.0.0.1:3001/api/health"

Write-Step "Aguardando frontend"
Wait-HttpReady -Name "Frontend" -Url "http://127.0.0.1:8080"

Write-Step "Abrindo frontend no navegador"
Start-Process "http://127.0.0.1:8080"

Write-Host ""
Write-Host "Ambiente Docker pronto para teste." -ForegroundColor Green
