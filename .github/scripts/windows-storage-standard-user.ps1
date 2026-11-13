$ErrorActionPreference = 'Stop'
$name = 'vdtprobe' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$stage = Join-Path 'C:\' $name
$account = "$env:COMPUTERNAME\$name"
$native = Join-Path $stage 'native'
$evidence = $env:VDT_STORAGE_PROBE_EVIDENCE
$password = ConvertTo-SecureString ("Aa9!" + [guid]::NewGuid().ToString('N')) -AsPlainText -Force
try {
  New-LocalUser -Name $name -Password $password | Out-Null
  Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $account
  New-Item -ItemType Directory -Path $stage | Out-Null
  New-Item -ItemType Directory -Path $native | Out-Null
  & icacls $stage /grant "$($account):(OI)(CI)(RX)" | Out-Null
  if ($LASTEXITCODE) { throw 'Could not grant probe binary read access' }
  & icacls $native /inheritance:r /grant:r "$($account):(OI)(CI)(F)" '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
  if ($LASTEXITCODE) { throw 'Could not configure protected probe directory' }
  & icacls $native /setowner $account | Out-Null
  if ($LASTEXITCODE) { throw 'Could not set probe directory owner' }
  & rustc --edition=2021 packages/vdt-storage/native/windows-storage-probe.rs -o (Join-Path $stage 'probe.exe')
  if ($LASTEXITCODE) { throw 'Probe compilation failed' }
  $credential = [pscredential]::new($account, $password)
  $report = Join-Path $evidence 'standard-user-native.json'
  $stderr = Join-Path $evidence 'standard-user-native.stderr.log'
  $process = Start-Process -FilePath (Join-Path $stage 'probe.exe') -ArgumentList $native -WorkingDirectory $stage -Credential $credential -RedirectStandardOutput $report -RedirectStandardError $stderr -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Standard user probe failed with exit code $($process.ExitCode)" }
  $probe = Get-Content -Raw $report | ConvertFrom-Json
  if ($probe.tokenElevated -or !$probe.ownerMatchesToken -or !$probe.daclProtected) {
    throw 'Probe did not use a non-elevated token and a user-owned protected directory'
  }
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) { Remove-LocalUser -Name $name }
}
