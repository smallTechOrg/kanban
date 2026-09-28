<#
.SYNOPSIS
  Kan Ban -- one-time setup (Windows PowerShell).
.DESCRIPTION
  Thin wrapper over `npm run setup`; package.json owns what setup actually does
  (create .venv with uv, install backend[dev] into it, install the frontend
  toolchain). Resolves the repo root from its own location, so it works from any
  directory even though the repo path contains a space.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Error "'uv' is required to create the virtualenv and install the backend. Install it from https://docs.astral.sh/uv/ then re-run this script."
}

Write-Host "==> Setting up Kan Ban in $Root"
npm run setup
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Done. Next: .\scripts\dev.ps1 for the dev loop, or 'npm run build' then 'npm start' for production."
