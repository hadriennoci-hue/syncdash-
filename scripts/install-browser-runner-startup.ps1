$ErrorActionPreference = "Stop"

$taskName = "SyncDash Browser Runner"
$startScript = Join-Path $PSScriptRoot "start-browser-runner-control.ps1"

if (!(Test-Path $startScript)) {
  throw "Start script not found: $startScript"
}

try {
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Runs SyncDash browser runner control service in background at logon." -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Host "Installed and started scheduled task: $taskName"
} catch {
  $startupDir = [Environment]::GetFolderPath("Startup")
  $shortcutPath = Join-Path $startupDir "SyncDash Browser Runner.lnk"
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
  $shortcut.WorkingDirectory = Split-Path -Parent $startScript
  $shortcut.Save()
  Write-Host "ScheduledTask denied. Installed Startup shortcut instead: $shortcutPath"
}
