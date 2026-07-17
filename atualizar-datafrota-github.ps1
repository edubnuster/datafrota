param(
  [string]$Mensagem,
  [string]$Remote,
  [string]$Branch,
  [switch]$NoPull,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args,
    [switch]$AllowFailure
  )

  $output = @()
  $exitCode = 0
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& git @Args 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  foreach ($line in $output) {
    if ($line -is [System.Management.Automation.ErrorRecord]) {
      Write-Host $line.ToString() -ForegroundColor Yellow
    } else {
      Write-Host $line
    }
  }

  if (-not $AllowFailure -and $exitCode -ne 0) {
    throw "git $($Args -join ' ') falhou com codigo $exitCode."
  }

  return [PSCustomObject]@{
    Output = @($output | ForEach-Object { $_.ToString() })
    ExitCode = $exitCode
  }
}

function Get-TrackingInfo {
  $trackingResult = Invoke-Git -Args @("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}") -AllowFailure
  if ($trackingResult.ExitCode -ne 0 -or -not $trackingResult.Output -or -not $trackingResult.Output[0]) {
    return $null
  }

  $trackingRef = [string]$trackingResult.Output[0]
  $parts = $trackingRef.Split("/", 2)
  if ($parts.Count -ne 2) {
    return $null
  }

  return [PSCustomObject]@{
    Remote = $parts[0]
    Branch = $parts[1]
  }
}

Set-Location $projectRoot

Write-Step "Validando ambiente Git"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git nao encontrado no PATH."
}

$insideWorkTree = (Invoke-Git -Args @("rev-parse", "--is-inside-work-tree")).Output[0]
if ($insideWorkTree -ne "true") {
  throw "A pasta $projectRoot nao faz parte de um repositorio Git."
}

$currentBranch = ((Invoke-Git -Args @("branch", "--show-current")).Output | Select-Object -First 1).Trim()
if ([string]::IsNullOrWhiteSpace($currentBranch)) {
  throw "HEAD destacado detectado. Troque para uma branch antes de enviar para o GitHub."
}

$trackingInfo = Get-TrackingInfo
if (-not $Remote) {
  if ($trackingInfo) {
    $Remote = $trackingInfo.Remote
  } else {
    $Remote = "origin"
  }
}

if (-not $Branch) {
  if ($trackingInfo) {
    $Branch = $trackingInfo.Branch
  } else {
    $Branch = $currentBranch
  }
}

Write-Host "Projeto: $projectRoot" -ForegroundColor DarkGray
Write-Host "Branch atual: $currentBranch" -ForegroundColor DarkGray
Write-Host "Destino: $Remote/$Branch" -ForegroundColor DarkGray

Write-Step "Status atual"
$null = Invoke-Git -Args @("status", "--short")

Write-Step "Verificando remoto configurado"
$remoteCheck = Invoke-Git -Args @("remote", "get-url", $Remote) -AllowFailure
if ($remoteCheck.ExitCode -ne 0) {
  throw "O remoto '$Remote' nao esta configurado neste repositorio."
}

Write-Step "Adicionando todas as alteracoes"
$null = Invoke-Git -Args @("add", "-A")

$hasStagedChanges = $false
$cachedDiffResult = Invoke-Git -Args @("diff", "--cached", "--quiet") -AllowFailure
if ($cachedDiffResult.ExitCode -eq 1) {
  $hasStagedChanges = $true
} elseif ($cachedDiffResult.ExitCode -ne 0) {
  throw "Nao foi possivel verificar se existem alteracoes staged."
}

if ($hasStagedChanges) {
  if ([string]::IsNullOrWhiteSpace($Mensagem)) {
    $Mensagem = "chore: atualiza projeto $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  }

  Write-Step "Criando commit"
  $null = Invoke-Git -Args @("commit", "-m", $Mensagem)
} else {
  Write-Step "Nenhuma alteracao para commit"
  Write-Host "A arvore de trabalho ja esta sincronizada localmente." -ForegroundColor Yellow
}

if (-not $NoPull) {
  Write-Step "Atualizando com o remoto (pull --rebase)"
  $null = Invoke-Git -Args @("pull", "--rebase", $Remote, $Branch)
} else {
  Write-Step "Pull ignorado por parametro"
}

if (-not $NoPush) {
  Write-Step "Enviando para o GitHub"
  $null = Invoke-Git -Args @("push", $Remote, $Branch)
} else {
  Write-Step "Push ignorado por parametro"
}

Write-Step "Status final"
$null = Invoke-Git -Args @("status", "--short", "--branch")

Write-Host ""
Write-Host "Atualizacao concluida com sucesso." -ForegroundColor Green
