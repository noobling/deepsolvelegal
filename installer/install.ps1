# Quantum Law Group — per-user installer (no administrator rights required).
# Copies the app into %LOCALAPPDATA%\Programs and creates Start Menu + Desktop shortcuts.

$ErrorActionPreference = 'Stop'
$appName = 'Quantum Law Group'
$exeName = 'Quantum Law Group.exe'

# The app payload sits in a sibling folder named "Quantum Law Group".
$src = Join-Path $PSScriptRoot $appName
if (-not (Test-Path (Join-Path $src $exeName))) {
  Write-Host "Could not find '$exeName' next to this installer. Make sure you extracted the whole zip." -ForegroundColor Red
  exit 1
}

$dest = Join-Path $env:LOCALAPPDATA "Programs\$appName"

Write-Host "Installing $appName ..." -ForegroundColor Cyan

# Stop any running instance so files aren't locked.
Get-Process -Name 'Quantum Law Group' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# Fresh copy.
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item (Join-Path $src '*') -Destination $dest -Recurse -Force

$exePath = Join-Path $dest $exeName

# Shortcuts (Start Menu + Desktop).
$ws = New-Object -ComObject WScript.Shell
foreach ($lnkDir in @(
  [Environment]::GetFolderPath('Programs'),
  [Environment]::GetFolderPath('Desktop')
)) {
  $lnk = Join-Path $lnkDir "$appName.lnk"
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $exePath
  $sc.WorkingDirectory = $dest
  $sc.Description = 'Quantum Law Group — AI legal workflows'
  $sc.Save()
}

Write-Host ""
Write-Host "Installed to: $dest" -ForegroundColor Green
Write-Host "You'll find 'Quantum Law Group' in the Start Menu and on your Desktop." -ForegroundColor Green
Write-Host ""

$launch = Read-Host "Launch Quantum Law Group now? (Y/n)"
if ($launch -eq '' -or $launch -match '^[Yy]') { Start-Process $exePath }
