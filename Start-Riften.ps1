$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
New-Item -ItemType Directory -Path 'data' -Force | Out-Null
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) { throw 'Run the README setup steps first.' }
& '.venv/Scripts/python.exe' -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
try { $riftenHealth = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2 } catch { $riftenHealth = $null }
if ($riftenHealth -and $riftenHealth.mode -ne 'local single operator') { throw 'Port 8000 is in use by another application.' }
if (-not $riftenHealth) {
    Start-Process -FilePath (Join-Path $PSScriptRoot '.venv/Scripts/python.exe') -ArgumentList @('-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8000') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'data/backend.log') -RedirectStandardError (Join-Path $PSScriptRoot 'data/backend-error.log')
}
try { $riftenFrontend = Invoke-WebRequest 'http://127.0.0.1:5173' -TimeoutSec 2 -UseBasicParsing } catch { $riftenFrontend = $null }
if ($riftenFrontend -and $riftenFrontend.Content -notmatch '<title>Riften</title>') { throw 'Port 5173 is in use by another application.' }
if (-not $riftenFrontend) {
    $riftenNode = (Get-Command node).Source
    Start-Process -FilePath $riftenNode -ArgumentList @('node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'data/frontend.log') -RedirectStandardError (Join-Path $PSScriptRoot 'data/frontend-error.log')
}
Write-Output 'Riften: http://127.0.0.1:5173'
Write-Output 'API: http://127.0.0.1:8000/docs'
