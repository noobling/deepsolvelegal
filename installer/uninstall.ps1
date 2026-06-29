# Quantum Law Group — uninstaller. Removes the app and shortcuts (leaves your matters/settings).
$ErrorActionPreference = 'SilentlyContinue'
$appName = 'Quantum Law Group'
Get-Process -Name 'Quantum Law Group' | Stop-Process -Force
Start-Sleep -Milliseconds 500
Remove-Item (Join-Path $env:LOCALAPPDATA "Programs\$appName") -Recurse -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) "$appName.lnk") -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk") -Force
Write-Host "$appName uninstalled. Your matters and API key in %APPDATA%\quantumlawgroup were left intact." -ForegroundColor Green
Write-Host "Delete that folder too if you want a full wipe." -ForegroundColor DarkGray
