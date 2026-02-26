$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$runnerDir = Join-Path $projectRoot ".runner"
if (!(Test-Path $runnerDir)) {
  New-Item -ItemType Directory -Path $runnerDir | Out-Null
}

$logFile = Join-Path $runnerDir "browser-runner.log"
$devVarsPath = Join-Path $projectRoot ".dev.vars"

if (!(Test-Path $devVarsPath)) {
  throw ".dev.vars not found at $devVarsPath"
}

$vars = @{}
Get-Content $devVarsPath | ForEach-Object {
  if ($_ -match '^([A-Z0-9_]+)=(.*)$') {
    $vars[$matches[1]] = $matches[2].Trim()
  }
}

if (-not $vars.ContainsKey("WIZHARD_URL") -or [string]::IsNullOrWhiteSpace($vars["WIZHARD_URL"])) {
  throw "WIZHARD_URL is missing in .dev.vars"
}

if ($vars["WIZHARD_URL"] -ne "https://wizhard.store") {
  throw "WIZHARD_URL must be https://wizhard.store for production runner. Current: $($vars["WIZHARD_URL"])"
}

if (-not $vars.ContainsKey("AGENT_BEARER_TOKEN") -or [string]::IsNullOrWhiteSpace($vars["AGENT_BEARER_TOKEN"])) {
  throw "AGENT_BEARER_TOKEN is missing in .dev.vars"
}

$hasAccessPair =
  (
    $vars.ContainsKey("CF_ACCESS_CLIENT_ID") -and
    $vars.ContainsKey("CF_ACCESS_CLIENT_SECRET") -and
    -not [string]::IsNullOrWhiteSpace($vars["CF_ACCESS_CLIENT_ID"]) -and
    -not [string]::IsNullOrWhiteSpace($vars["CF_ACCESS_CLIENT_SECRET"])
  ) -or
  (
    $vars.ContainsKey("CLOUDFLARE_ACCESS_CLIENT_ID") -and
    $vars.ContainsKey("CLOUDFLARE_ACCESS_CLIENT_SECRET") -and
    -not [string]::IsNullOrWhiteSpace($vars["CLOUDFLARE_ACCESS_CLIENT_ID"]) -and
    -not [string]::IsNullOrWhiteSpace($vars["CLOUDFLARE_ACCESS_CLIENT_SECRET"])
  )

if (-not $hasAccessPair) {
  throw "Missing Cloudflare Access service token vars in .dev.vars (CF_ACCESS_CLIENT_ID/SECRET or CLOUDFLARE_ACCESS_CLIENT_ID/SECRET)."
}

$args = @(
  "tsx",
  "scripts/local-browser-runner.ts",
  "--interval-min=30",
  "--wake-poll-sec=10",
  "--prod",
  "--headed"
)

& npx @args *>> $logFile
