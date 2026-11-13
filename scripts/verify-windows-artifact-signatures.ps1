param(
  [Parameter(Mandatory = $true)][string]$ArtifactDirectory,
  [Parameter(Mandatory = $true)][string]$InstallerFile
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
$publisher = $null
foreach ($artifactPath in $paths) {
  $signature = Get-AuthenticodeSignature -LiteralPath $artifactPath
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
    throw "Authenticode validation failed for $([System.IO.Path]::GetFileName($artifactPath)): $($signature.Status)"
  }
  if ($artifactPath -ne $paths[2]) {
    if ($null -eq $publisher) { $publisher = $signature.SignerCertificate.Thumbprint }
    elseif ($signature.SignerCertificate.Thumbprint -ne $publisher) { throw 'Installer, application and native storage addon publishers differ.' }
  }
}
Write-Output 'Installer, application, native storage addon and embedded Node Authenticode signatures are valid.'
