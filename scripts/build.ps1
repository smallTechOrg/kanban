<#
.SYNOPSIS
  My Day -- production build: compile the SPA into frontend/dist.
.DESCRIPTION
  Thin wrapper over `npm run build`; package.json owns the build command.
  Resolves the repo root from its own location so it works from any directory.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host "==> Building the SPA into $Root\frontend\dist"
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Done. Start the server with 'npm start' (runs .venv\Scripts\python -m kanban)."
