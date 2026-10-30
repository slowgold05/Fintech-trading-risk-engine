$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pythonPath = (Get-Command python -ErrorAction Stop).Source
$taskName = 'SentinelMarketsLedgerReconciliation'
$action = New-ScheduledTaskAction -Execute $pythonPath -Argument '-m app.scripts.reconcile_ledger' -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Nightly Sentinel Markets ledger reconciliation and evidence collection' -Force | Out-Null
Write-Output "Registered $taskName for 02:00 local time"
