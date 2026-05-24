@echo off
rem Wrapper that runs register-all.ps1 with execution policy bypass.
rem ASCII-only comments to avoid cmd.exe encoding issues on Japanese Windows (cp932).
rem All arguments (e.g. -DryRun, -BackstageUrl, -MaxParallel, -LogFile) are forwarded to PowerShell.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-all.ps1" %*
rem Propagate PowerShell exit code to the batch caller.
exit /b %ERRORLEVEL%
