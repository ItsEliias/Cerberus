#Requires -Version 5.1
<#
  Build Cerberus as a standalone Windows program (PyInstaller + pywebview),
  mirroring .github/workflows/build-windows.yml so you get the same result
  locally. Run from a checkout of the repo.

  Usage:
    powershell -ExecutionPolicy Bypass -File .\build-windows-app.ps1
    powershell -ExecutionPolicy Bypass -File .\build-windows-app.ps1 -Profile full
    powershell -ExecutionPolicy Bypass -File .\build-windows-app.ps1 -Profile lean -SkipInstaller

  Profiles:
    lean (default) - small, robust; heavy ML + sandbox run on your Docker server
    full           - offline-capable; bundles the ML stack (CPU-only torch)

  Produces:
    dist\Cerberus\Cerberus.exe              - the app (portable onedir)
    dist-installer\Cerberus-Setup-*.exe     - installer (needs Inno Setup 6)

  Prereqs: Python 3.12 (py launcher or python on PATH). Inno Setup 6 is optional
  (https://jrsoftware.org/ or `choco install innosetup`); without it the script
  still produces the portable onedir and skips the installer.
#>
param(
    [ValidateSet("lean", "full")]
    [string]$Profile = "lean",
    [string]$AppVersion = "0.1.0-dev",
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($m) { Write-Host ""; Write-Host ("==> " + $m) -ForegroundColor Cyan }
function Fail($m) { Write-Host ("ERROR: " + $m) -ForegroundColor Red; exit 1 }

# Run an external command via the call operator (handles spaces in paths) and
# fail on a non-zero exit code (external commands don't trip $ErrorActionPreference).
function Run($exe, [string[]]$cmdArgs) {
    & $exe @cmdArgs
    if ($LASTEXITCODE -ne 0) { Fail "command failed ($LASTEXITCODE): $exe $($cmdArgs -join ' ')" }
}

# ── Python ──────────────────────────────────────────────────────────────────
Step "Locating Python 3.12"
$pyExe = $null; $pyArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) { $pyExe = "py"; $pyArgs = @("-3.12") }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $pyExe = "python" }
else { Fail "Python not found. Install Python 3.12 (py launcher) and re-run." }

# ── venv ────────────────────────────────────────────────────────────────────
$venv = Join-Path $PSScriptRoot ".venv"
$vpy = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $vpy)) {
    Step "Creating virtualenv (.venv)"
    Run $pyExe ($pyArgs + @("-m", "venv", $venv))
}

Step "Upgrading pip"
Run $vpy @("-m", "pip", "install", "--upgrade", "pip", "wheel")

# Full profile ships torch — install the CPU-only wheel to avoid multi-GB CUDA.
if ($Profile -eq "full") {
    Step "Installing CPU-only torch (full profile)"
    Run $vpy @("-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cpu")
}

Step "Installing dependencies"
Run $vpy @("-m", "pip", "install", "-r", "requirements.txt", "-r", "requirements-desktop.txt")

# ── Icons (from docs\cerberus.jpg) ──────────────────────────────────────────
Step "Rendering window icons"
$iconScript = @'
import os
from PIL import Image
os.makedirs("desktop_assets", exist_ok=True)
img = Image.open("docs/cerberus.jpg").convert("RGBA")
side = min(img.size)
left = (img.width - side) // 2
top = (img.height - side) // 2
sq = img.crop((left, top, left + side, top + side))
sq.resize((512, 512)).save("desktop_assets/cerberus.png")
sq.save("desktop_assets/cerberus.ico",
        sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
print("icons -> desktop_assets/")
'@
$iconScript | & $vpy -
if ($LASTEXITCODE -ne 0) { Fail "icon rendering failed" }

# ── Build ───────────────────────────────────────────────────────────────────
Step "Building with PyInstaller (profile: $Profile)"
$env:CERBERUS_DESKTOP_PROFILE = $Profile
Run $vpy @("-m", "PyInstaller", "--noconfirm", "--clean", "cerberus.spec")

# ── Smoke test the frozen bundle ────────────────────────────────────────────
Step "Smoke-testing the frozen app"
$env:CERBERUS_DESKTOP_SMOKE = "1"
$exe = Join-Path $PSScriptRoot "dist\Cerberus\Cerberus.exe"
if (-not (Test-Path $exe)) { Fail "Build did not produce $exe" }
$p = Start-Process -FilePath $exe -ArgumentList "--smoke" -PassThru
if (-not $p.WaitForExit(180000)) { $p.Kill(); Fail "smoke test timed out" }
Remove-Item Env:\CERBERUS_DESKTOP_SMOKE -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) {
    $log = Join-Path $env:APPDATA "Cerberus\desktop.log"
    if (Test-Path $log) { Write-Host "---- desktop.log (tail) ----"; Get-Content $log -Tail 40 }
    Fail "smoke test failed (exit $($p.ExitCode))"
}
Write-Host "smoke OK" -ForegroundColor Green

# ── Installer (optional) ────────────────────────────────────────────────────
$iscc = $null
if (Get-Command iscc -ErrorAction SilentlyContinue) { $iscc = "iscc" }
else {
    $candidate = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    if (Test-Path $candidate) { $iscc = $candidate }
}
if ($SkipInstaller) {
    Write-Host "Skipping installer (-SkipInstaller)." -ForegroundColor Yellow
} elseif ($iscc) {
    Step "Building installer (Inno Setup)"
    Run $iscc @("/DAppVersion=$AppVersion", "installer\cerberus.iss")
} else {
    Write-Host "Inno Setup not found - skipping installer. Install it to build Cerberus-Setup.exe." -ForegroundColor Yellow
}

# ── Done ────────────────────────────────────────────────────────────────────
Step "Done"
Write-Host ("  Portable app : " + (Join-Path $PSScriptRoot "dist\Cerberus\Cerberus.exe"))
$setup = Get-ChildItem (Join-Path $PSScriptRoot "dist-installer") -Filter "Cerberus-Setup-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($setup) { Write-Host ("  Installer    : " + $setup.FullName) }
