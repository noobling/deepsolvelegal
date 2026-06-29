# Builds the full Windows distribution: compiles the app, packages a self-contained
# folder with @electron/packager, stages the installer scripts, and zips it.
#
# Usage:  npm run dist:win          (arm64, the dev machine's arch)
#         npm run dist:win -- x64   (Intel/AMD build)
#
# Produces: dist\Quantum-Law-Group-<version>-win-<arch>.zip
param([string]$Arch = 'arm64')

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$appName = 'Quantum Law Group'

Write-Host "==> Compiling renderer + main (electron-vite)..." -ForegroundColor Cyan
npx electron-vite build

# Build a clean PRODUCTION-only node_modules in a temp dir. We inject this into
# the package ourselves (with robocopy) because packager's own copy/prune was
# dropping deep files (e.g. docx/dist) and leaving dev deps behind.
Write-Host "==> Building production node_modules..." -ForegroundColor Cyan
$nmTemp = Join-Path $env:TEMP 'dsl-prod-nm'
if (Test-Path $nmTemp) { Remove-Item $nmTemp -Recurse -Force }
New-Item -ItemType Directory -Path $nmTemp | Out-Null
Copy-Item package.json -Destination $nmTemp
if (Test-Path package-lock.json) { Copy-Item package-lock.json -Destination $nmTemp }
Push-Location $nmTemp
npm install --omit=dev --no-audit --no-fund --ignore-scripts --silent
Pop-Location

Write-Host "==> Packaging self-contained app ($Arch)..." -ForegroundColor Cyan
if (Test-Path app-build) { Remove-Item app-build -Recurse -Force }
# Package the app shell + electron runtime, but EXCLUDE node_modules (we inject our own).
npx @electron/packager . $appName --platform=win32 --arch=$Arch --out=app-build --overwrite --prune=false `
  --ignore="/release" --ignore="/app-build" --ignore="/dist" --ignore="/src" --ignore="/installer" --ignore="/scripts" `
  --ignore="\.log$" --ignore="/\.git" --ignore="bundled\.key" --ignore="(^|/)node_modules($|/)"

$appDir = "app-build\$appName-win32-$Arch\resources\app"
$pkgResources = "app-build\$appName-win32-$Arch\resources"

Write-Host "==> Injecting production node_modules (robocopy handles deep paths)..." -ForegroundColor Cyan
$dest = Join-Path $appDir 'node_modules'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
# robocopy exit codes 0-7 are success; treat >=8 as failure.
robocopy (Join-Path $nmTemp 'node_modules') $dest /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying node_modules (exit $LASTEXITCODE)" }
$global:LASTEXITCODE = 0

# Sanity check a couple of deps that must resolve at runtime.
foreach ($d in @('docx\dist\index.mjs', '@anthropic-ai\sdk\package.json', 'exceljs\package.json', 'pdfjs-dist\package.json')) {
  if (-not (Test-Path (Join-Path $dest $d))) { throw "Missing dependency file in package: $d" }
}
Write-Host "    node_modules verified (docx, @anthropic-ai/sdk, exceljs, pdfjs-dist present)" -ForegroundColor DarkGreen

# Embed the bundled API key (if present) so the distributed app works out of the box.
# Placed in resources/ and read at runtime by getBundledKey().
if (Test-Path (Join-Path $root 'bundled.key')) {
  Copy-Item (Join-Path $root 'bundled.key') -Destination (Join-Path $pkgResources 'bundled.key') -Force
  Write-Host "    embedded bundled.key (app ships with a working API key)" -ForegroundColor Yellow
} else {
  Write-Host "    no bundled.key found - users will paste their own key in Settings" -ForegroundColor DarkGray
}

Write-Host "==> Staging installer + payload..." -ForegroundColor Cyan
$stage = "dist\Quantum-Law-Group"
if (Test-Path dist) { Remove-Item dist -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item "app-build\$appName-win32-$Arch" -Destination "$stage\$appName" -Recurse
Copy-Item installer\install.ps1, installer\uninstall.ps1, "installer\Install Quantum Law Group.bat", installer\INSTALL.md -Destination $stage

Write-Host "==> Zipping..." -ForegroundColor Cyan
$zip = "dist\Quantum-Law-Group-$version-win-$Arch.zip"
$sevenZip = "node_modules\7zip-bin\win\$Arch\7za.exe"
if (-not (Test-Path $sevenZip)) { $sevenZip = "node_modules\7zip-bin\win\x64\7za.exe" }
& $sevenZip a -tzip -mx=7 -bso0 -bsp0 $zip "$stage" | Out-Null

$size = [math]::Round((Get-Item $zip).Length / 1MB, 0)
Write-Host ""
Write-Host "Done. $zip ($size MB)" -ForegroundColor Green
