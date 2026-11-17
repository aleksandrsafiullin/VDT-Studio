$ErrorActionPreference = 'Stop'
if ($env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This smoke requires an isolated GitHub-hosted Windows runner.'
}
$SourceCommit = 'ebfad678759f5c0e98c2082519fb5b552aa24bb6'
$expectedInstaller = '6beb81e5dc397d999a04ebdae1097c42846bd1d26f52f0ba2ce0291667b69db4'
$Evidence = (New-Item -ItemType Directory -Force output/windows-diagnostic/evidence).FullName
$installers = @(Get-ChildItem output/windows-diagnostic/input -Recurse -File -Filter 'VDT-Studio-0.1.0-alpha.2-x64-setup.exe')
if ($installers.Count -ne 1 -or (Get-FileHash -LiteralPath $installers[0].FullName).Hash.ToLowerInvariant() -ne $expectedInstaller) {
  throw 'Prior installer identity did not match.'
}
$name = 'vdtsmoke' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$stage = Join-Path 'C:\' $name
$private = Join-Path $stage 'private'
$account = "$env:COMPUTERNAME\$name"
$password = ConvertTo-SecureString ("Aa9!" + [guid]::NewGuid().ToString('N')) -AsPlainText -Force
try {
  New-LocalUser -Name $name -Password $password | Out-Null
  Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $account
  New-Item -ItemType Directory -Path $stage, $private | Out-Null
  & icacls $stage /grant "$($account):(OI)(CI)(RX)" | Out-Null
  if ($LASTEXITCODE) { throw 'Could not grant smoke read access.' }
  & icacls $private /inheritance:r /grant:r "$($account):(OI)(CI)(F)" '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
  if ($LASTEXITCODE) { throw 'Could not protect the smoke profile parent.' }
  & icacls $private /setowner $account | Out-Null
  if ($LASTEXITCODE) { throw 'Could not set smoke profile owner.' }
  $installer = Join-Path $stage 'verified-setup.exe'
  Copy-Item -LiteralPath $installers[0].FullName -Destination $installer
  $copy = Join-Path $private 'application'
  $credential = [pscredential]::new($account, $password)
  $install = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$copy") -WorkingDirectory $stage -Credential $credential -PassThru
  if (!$install.WaitForExit(90000)) {
    try { $install.Kill($true) } catch { if (!$install.HasExited) { throw } }
    $install.WaitForExit()
    throw 'The verified installer exceeded its diagnostic deadline.'
  }
  if ($install.ExitCode -ne 0) { throw "Verified installer exited with $($install.ExitCode)." }
  $launcher = Join-Path $copy 'windows-runtime.cjs'
  $original = (Get-FileHash -LiteralPath $launcher).Hash.ToLowerInvariant()
  $text = Get-Content -LiteralPath $launcher -Raw
  $needle = '}).catch(() => {'
  if ([regex]::Matches($text, [regex]::Escape($needle)).Count -ne 1) { throw 'Unexpected installed launcher shape.' }
  $replacement = @'
}).catch((error) => {
    const diagnostic = String(error?.stack ?? error).replace(/[\x00-\x08\x0b-\x1f]/g, " ").slice(0, 8192);
    process.stderr.write(diagnostic + "\n");
'@
  Set-Content -LiteralPath $launcher -Value $text.Replace($needle, $replacement) -Encoding utf8NoBOM -NoNewline
  [ordered]@{
    installerSha256 = $expectedInstaller
    sourceCommit = $SourceCommit
    diagnosticOnly = $true
    changedFile = 'windows-runtime.cjs'
    originalLauncherSha256 = $original
    diagnosticLauncherSha256 = (Get-FileHash -LiteralPath $launcher).Hash.ToLowerInvariant()
  } | ConvertTo-Json | Set-Content (Join-Path $Evidence 'diagnostic-identity.json')
  $script = Join-Path $stage 'verify-windows-standalone-smoke.mjs'
  Copy-Item -LiteralPath scripts/verify-windows-standalone-smoke.mjs -Destination $script
  $env:TEMP = $private
  $env:TMP = $private
  $env:NODE_DISABLE_COMPILE_CACHE = '1'
  $args = @($script, $copy, $SourceCommit, $private)
  $process = Start-Process -FilePath (Join-Path $copy 'runtime/node.exe') -ArgumentList $args -WorkingDirectory $stage -Credential ([pscredential]::new($account, $password)) -RedirectStandardOutput (Join-Path $Evidence 'windows-standalone-smoke.json') -RedirectStandardError (Join-Path $Evidence 'windows-standalone-smoke.stderr.log') -PassThru
  if (!$process.WaitForExit(120000)) {
    try { $process.Kill($true) } catch {
      if (!$process.HasExited) { throw }
    }
    $process.WaitForExit()
    throw 'Windows standalone smoke exceeded 120 seconds. The owned process tree was terminated.'
  }
  if ($process.ExitCode -ne 0) { throw "Windows standalone smoke failed with exit code $($process.ExitCode). See the standalone smoke logs." }
} finally {
  try {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  } finally {
    $user = Get-LocalUser -Name $name -ErrorAction SilentlyContinue
    if ($user) {
      $sid = $user.SID.Value
      Get-CimInstance Win32_UserProfile -Filter "SID='$sid'" | Remove-CimInstance
      Remove-LocalUser -Name $name
    }
    $retained = [ordered]@{
      retainedStage = (Test-Path -LiteralPath $stage)
      retainedAccount = [bool](Get-LocalUser -Name $name -ErrorAction SilentlyContinue)
    }
    $retained | ConvertTo-Json | Set-Content (Join-Path $Evidence 'windows-standalone-smoke.cleanup.json')
    if ($retained.retainedStage -or $retained.retainedAccount) { throw 'Windows standalone smoke cleanup was incomplete.' }
  }
}
