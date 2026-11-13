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
  $addon = Join-Path $stage 'addon'
  & ./packages/vdt-storage/native/build-windows-storage-addon.ps1 -OutputDirectory $addon
  Copy-Item (Join-Path $addon 'windows-storage-dependents.txt') $evidence
  & icacls $addon /grant "$($account):(OI)(CI)(M)" | Out-Null
  if ($LASTEXITCODE) { throw 'Could not grant disposable runtime manifest access' }
  Copy-Item (Get-Command node.exe).Source (Join-Path $stage 'node.exe')
  Copy-Item ./packages/vdt-storage/native/windows-storage-addon.test.cjs (Join-Path $stage 'addon.test.cjs')
  $arguments = @((Join-Path $stage 'addon.test.cjs'), (Join-Path $addon 'windows-storage.node'), $native)
  $addonReport = Join-Path $evidence 'standard-user-addon.json'
  $addonStderr = Join-Path $evidence 'standard-user-addon.stderr.log'
  $addonProcess = Start-Process -FilePath (Join-Path $stage 'node.exe') -ArgumentList $arguments -WorkingDirectory $stage -Credential $credential -RedirectStandardOutput $addonReport -RedirectStandardError $addonStderr -Wait -PassThru
  if ($addonProcess.ExitCode -ne 0) { throw "Standard user addon failed with exit code $($addonProcess.ExitCode)" }
  $repository = (Get-Location).Path
  & icacls $repository /grant "$($account):(OI)(CI)(RX)" /T /Q | Out-Null
  if ($LASTEXITCODE) { throw 'Could not grant probe repository read access' }
  $env:VDT_WINDOWS_DATA_TEST_RUNTIME = $addon
  $env:VDT_WINDOWS_DATA_TEST_PRIVATE_PARENT = $native
  $env:TEMP = $native
  $env:TMP = $native
  $env:NO_COLOR = '1'
  $env:GITHUB_ACTIONS = 'false'
  $testReport = Join-Path $evidence 'standard-user-vitest.log'
  $testStderr = Join-Path $evidence 'standard-user-vitest.stderr.log'
  $vitest = Join-Path $repository 'node_modules\vitest\vitest.mjs'
  $arguments = @($vitest, 'run', 'packages/vdt-storage/src/windows-storage.native.test.ts',  'apps/web/app/api/data/store.windows-native.test.ts', 'apps/web/app/api/agent/runs/supervisor-controller-owner-native.test.ts', 'scripts/windows-packaged-bootstrap.native.test.ts', '--maxWorkers=1', '--retry=0', '--cache=false', '--reporter=dot')
  $testProcess = Start-Process -FilePath (Join-Path $stage 'node.exe') -ArgumentList $arguments -WorkingDirectory $repository -Credential $credential -RedirectStandardOutput $testReport -RedirectStandardError $testStderr -Wait -PassThru
  if ($testProcess.ExitCode -ne 0) { throw "Standard user storage tests failed with exit code $($testProcess.ExitCode)" }
  if ((Get-Content -Raw $testReport) -notmatch 'Tests\s+28 passed') { throw 'All native tests must execute without skips' }
  $matrixOutput = Join-Path $native 'sequence-3-windows-evidence.json'
  $matrixReport = Join-Path $evidence 'sequence-3-windows-matrix.log'
  $matrixStderr = Join-Path $evidence 'sequence-3-windows-matrix.stderr.log'
  $matrix = Join-Path $repository 'packages\vdt-storage\src\sequence-3-windows-matrix.ts'
  $matrixArgs = @('--import', 'tsx', $matrix, $addon, $native, $matrixOutput)
  $matrixProcess = Start-Process -FilePath (Join-Path $stage 'node.exe') -ArgumentList $matrixArgs -WorkingDirectory $repository -Credential $credential -RedirectStandardOutput $matrixReport -RedirectStandardError $matrixStderr -Wait -PassThru
  Get-ChildItem -LiteralPath $native -Filter 'sequence-3-windows-evidence.json*' | Copy-Item -Destination $evidence
  if ($matrixProcess.ExitCode -ne 0) { throw "Native frozen Sequence 3 matrix failed with exit code $($matrixProcess.ExitCode)" }
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) { Remove-LocalUser -Name $name }
}
