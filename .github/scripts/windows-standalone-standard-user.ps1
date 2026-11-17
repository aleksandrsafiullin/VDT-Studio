param(
  [Parameter(Mandatory)] [string] $Application,
  [Parameter(Mandatory)] [string] $SourceCommit,
  [Parameter(Mandatory)] [string] $Evidence
)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This smoke requires an isolated GitHub-hosted Windows runner.'
}
$Application = (Resolve-Path -LiteralPath $Application).Path
$Evidence = (Resolve-Path -LiteralPath $Evidence).Path
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
  # Stage the exact verified packaged bytes without changing the release output ACL.
  $copy = Join-Path $stage 'application'
  Copy-Item -LiteralPath $Application -Destination $copy -Recurse
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
    if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) { Remove-LocalUser -Name $name }
    $retained = [ordered]@{
      retainedStage = (Test-Path -LiteralPath $stage)
      retainedAccount = [bool](Get-LocalUser -Name $name -ErrorAction SilentlyContinue)
    }
    $retained | ConvertTo-Json | Set-Content (Join-Path $Evidence 'windows-standalone-smoke.cleanup.json')
    if ($retained.retainedStage -or $retained.retainedAccount) { throw 'Windows standalone smoke cleanup was incomplete.' }
  }
}
