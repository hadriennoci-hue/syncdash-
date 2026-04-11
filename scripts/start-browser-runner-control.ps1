$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$runnerDir = Join-Path $projectRoot ".runner"
if (!(Test-Path $runnerDir)) {
  New-Item -ItemType Directory -Path $runnerDir | Out-Null
}

$logFile = Join-Path $runnerDir "browser-runner-control.log"
$devVarsPath = Join-Path $projectRoot ".dev.vars"

if (!(Test-Path $devVarsPath)) {
  throw ".dev.vars not found at $devVarsPath"
}

& npx tsx scripts/browser-runner-control.ts *>> $logFile
