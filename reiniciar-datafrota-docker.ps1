param(
  [string]$SaasRoot = "C:\databrev"
)

$ErrorActionPreference = "Stop"

$projectRoot = $SaasRoot
$composeProjectName = "datafrota"
$backendTimeoutSeconds = 60
$frontendTimeoutSeconds = 120
$composeUpTimeoutSeconds = 180

if (-not (Test-Path $projectRoot)) {
  throw "Diretorio do SaaS web nao encontrado: $projectRoot"
}

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

function Invoke-ComposeWithEnvironment {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args,
    [hashtable]$EnvironmentOverrides = @{},
    [int]$TimeoutSeconds = 0
  )

  $previousValues = @{}
  foreach ($key in $EnvironmentOverrides.Keys) {
    $previousValues[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, [string]$EnvironmentOverrides[$key], "Process")
  }

  try {
    if ($TimeoutSeconds -gt 0) {
      $result = Invoke-DockerProcess -Args (@("compose", "-p", $composeProjectName) + $Args) -TimeoutSeconds $TimeoutSeconds -EnvironmentOverrides $EnvironmentOverrides
      if ($result.ExitCode -ne 0) {
        throw "docker compose $($Args -join ' ') falhou com codigo $($result.ExitCode)."
      }
    } else {
      Invoke-Compose -Args $Args
    }
  } finally {
    foreach ($key in $EnvironmentOverrides.Keys) {
      [Environment]::SetEnvironmentVariable($key, $previousValues[$key], "Process")
    }
  }
}

function Invoke-ComposeCapturingOutput {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args,
    [hashtable]$EnvironmentOverrides = @{},
    [int]$TimeoutSeconds = 0
  )

  $result = Invoke-DockerProcess -Args (@("compose", "-p", $composeProjectName) + $Args) -EnvironmentOverrides $EnvironmentOverrides -TimeoutSeconds $TimeoutSeconds
  return @{
    ExitCode = $result.ExitCode
    Output = (($result.StdOut, $result.StdErr | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "`n")
  }
}

function Invoke-DockerProcess {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args,
    [int]$TimeoutSeconds = 0,
    [hashtable]$EnvironmentOverrides = @{}
  )

  $dockerCommand = Get-Command docker -ErrorAction Stop
  $dockerPath = if ($dockerCommand.Path) { $dockerCommand.Path } else { $dockerCommand.Source }
  if ([string]::IsNullOrWhiteSpace($dockerPath)) {
    throw "Nao foi possivel localizar o executavel do Docker."
  }
  $commandPreview = "docker " + ($Args -join " ")
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $dockerPath
  $escapedArgs = $Args | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }
  $startInfo.Arguments = ($escapedArgs -join ' ')
  $startInfo.WorkingDirectory = $projectRoot
  $startInfo.UseShellExecute = $false
  $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  foreach ($key in $EnvironmentOverrides.Keys) {
    $startInfo.EnvironmentVariables[$key] = [string]$EnvironmentOverrides[$key]
  }

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  Write-Host "[debug] Iniciando comando: $commandPreview" -ForegroundColor DarkGray

  try {
    [void]$process.Start()
    Write-Host "[debug] PID docker: $($process.Id)" -ForegroundColor DarkGray
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    if ($TimeoutSeconds -gt 0) {
      if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try {
          $process.Kill()
        } catch {
          Write-Warning "Nao foi possivel encerrar o processo docker preso: $($_.Exception.Message)"
        }
        throw "docker $($Args -join ' ') excedeu o timeout de $TimeoutSeconds segundos."
      }
    } else {
      $process.WaitForExit()
    }

    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $process.WaitForExit()
    $stopwatch.Stop()
    Write-Host "[debug] Comando finalizado em $([math]::Round($stopwatch.Elapsed.TotalSeconds, 2))s com exit code $($process.ExitCode)" -ForegroundColor DarkGray

    if (-not [string]::IsNullOrWhiteSpace($stdout)) {
      Write-Host $stdout.TrimEnd()
    }
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
      Write-Host $stderr.TrimEnd()
    }

    return @{
      ExitCode = $process.ExitCode
      StdOut = $stdout
      StdErr = $stderr
    }
  } finally {
    try {
      if ($process) {
        $process.Dispose()
      }
    } catch {
    }
  }
}

function Invoke-ComposeWithTimeout {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args,
    [int]$TimeoutSeconds = 30
  )

  $result = Invoke-DockerProcess -Args (@("compose", "-p", $composeProjectName) + $Args) -TimeoutSeconds $TimeoutSeconds
  if ($result.ExitCode -ne 0) {
    throw "docker compose $($Args -join ' ') falhou com codigo $($result.ExitCode)."
  }
}

function Invoke-ComposeUpWithBuildFallback {
  $primaryEnv = @{
    BUILDKIT_PROGRESS = "plain"
  }
  $fallbackEnv = @{
    BUILDKIT_PROGRESS = "plain"
    COMPOSE_BAKE = "false"
    DOCKER_BUILDKIT = "0"
    COMPOSE_DOCKER_CLI_BUILD = "0"
  }

  $primaryResult = Invoke-ComposeCapturingOutput -Args @("up", "-d", "--build") -EnvironmentOverrides $primaryEnv -TimeoutSeconds $composeUpTimeoutSeconds
  if ($primaryResult.ExitCode -eq 0) {
    return
  }

  if ($primaryResult.Output -match [regex]::Escape("failed to execute bake: read |0: file already closed")) {
    Write-Warning "Docker Compose falhou no caminho Buildx/Bake. Repetindo com fallback sem BuildKit."
    Invoke-ComposeWithEnvironment -Args @("up", "-d", "--build") -EnvironmentOverrides $fallbackEnv -TimeoutSeconds $composeUpTimeoutSeconds
    return
  }

  throw "docker compose up -d --build falhou com codigo $($primaryResult.ExitCode)."
}

function Remove-StaleContainers {
  $containerNames = @("datafrota-backend", "datafrota-frontend")
  foreach ($containerName in $containerNames) {
    try {
      $result = Invoke-DockerProcess -Args @("rm", "-f", $containerName) -TimeoutSeconds 15
      if ($result.ExitCode -eq 0) {
        Write-Host "Container $containerName removido a forca." -ForegroundColor Yellow
      } elseif (($result.StdErr + $result.StdOut) -match "No such container") {
        Write-Host "Container $containerName ja nao existe." -ForegroundColor DarkYellow
      } else {
        throw "docker rm -f ${containerName} falhou com codigo $($result.ExitCode)."
      }
    } catch {
      Write-Warning "Falha ao remover ${containerName}: $($_.Exception.Message)"
      throw "Nao foi possivel remover os containers travados. Reinicie o Docker Desktop e execute o script novamente."
    }
  }
}

Write-Step "Reiniciando stack Docker do DATAFROTA"
Set-Location $projectRoot
$scriptInfo = Get-Item -LiteralPath $MyInvocation.MyCommand.Path
Write-Host "[debug] Script em execucao: $($scriptInfo.FullName)" -ForegroundColor DarkGray
Write-Host "[debug] Ultima modificacao: $($scriptInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor DarkGray
Write-Host "[debug] Diretorio SaaS/Docker: $projectRoot" -ForegroundColor DarkGray

Write-Step "Derrubando containers antigos"
try {
  Invoke-ComposeWithTimeout -Args @("down", "--remove-orphans", "--timeout", "10") -TimeoutSeconds 30
} catch {
  Write-Warning "$($_.Exception.Message) Aplicando fallback com remocao forcada dos containers."
  Remove-StaleContainers
}

Write-Step "Subindo frontend e backend com rebuild"
Invoke-ComposeUpWithBuildFallback

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
