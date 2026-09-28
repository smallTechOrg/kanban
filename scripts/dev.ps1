<#
.SYNOPSIS
  Kan Ban -- start the API (:8000, --reload) and Vite (:5173) together.
.DESCRIPTION
  Thin wrapper over `npm run dev`; package.json owns the two commands. Resolves
  the repo root from its own location and checks that the venv interpreter the
  dev:api script calls actually exists before starting anything.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

$Python = Join-Path $Root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $Python)) {
    Write-Error "No virtualenv at $Root\.venv -- run .\scripts\setup.ps1 first."
}

Write-Host "==> API  http://127.0.0.1:8000  (interpreter: $Python)"
Write-Host "==> Web  http://127.0.0.1:5173"
npm run dev
exit $LASTEXITCODE
