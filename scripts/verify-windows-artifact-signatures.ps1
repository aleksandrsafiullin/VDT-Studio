param(
  [Parameter(Mandatory = $true)][string]$ArtifactDirectory,
  [Parameter(Mandatory = $true)][string]$InstallerFile,
  [switch]$VerifyCursorWorker
)
$ErrorActionPreference = 'Stop'
if ([System.IO.Path]::GetFileName($InstallerFile) -ne $InstallerFile) {
  throw 'Installer must be a filename within the artifact directory.'
}
$paths = @(
  (Join-Path $ArtifactDirectory $InstallerFile),
  (Join-Path $ArtifactDirectory 'application/vdt-studio-desktop.exe'),
  (Join-Path $ArtifactDirectory 'application/runtime/node.exe'),
  (Join-Path $ArtifactDirectory 'application/runtime/windows-storage.node')
)
if ($VerifyCursorWorker) {
  $paths += Join-Path $ArtifactDirectory 'application/windows-cursor-worker/vdt-windows-cursor-worker.exe'
}
$publisher = $null
foreach ($artifactPath in $paths) {
  $signature = Get-AuthenticodeSignature -LiteralPath $artifactPath
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
    throw "Authenticode validation failed for $([System.IO.Path]::GetFileName($artifactPath)): $($signature.Status)"
  }
  if ($artifactPath -ne $paths[2]) {
    if ($null -eq $publisher) { $publisher = $signature.SignerCertificate.Thumbprint }
    elseif ($signature.SignerCertificate.Thumbprint -ne $publisher) { throw 'Installer, application and native resource publishers differ.' }
  }
}
Write-Output 'All requested Authenticode signatures are valid.'
