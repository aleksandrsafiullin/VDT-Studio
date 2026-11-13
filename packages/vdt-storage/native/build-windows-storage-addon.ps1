param(
  [Parameter(Mandatory)] [string] $OutputDirectory
)
$ErrorActionPreference = 'Stop'
$version = '24.22.2'
if ((node --version) -ne "v$version") { throw "Expected Node $version" }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$out = (Resolve-Path -LiteralPath $OutputDirectory).Path
$nodeUri = "https://nodejs.org/dist/v$version"
$nodeHeaders = "node-v$version-headers.tar.gz"
$checksums = Join-Path $out 'SHASUMS256.txt'
Invoke-WebRequest "$nodeUri/SHASUMS256.txt" -OutFile $checksums
foreach ($file in @($nodeHeaders, 'win-x64/node.lib')) {
  $destination = Join-Path $out (Split-Path -Leaf $file)
  Invoke-WebRequest "$nodeUri/$file" -OutFile $destination
  $entry = (Get-Content -LiteralPath $checksums | Where-Object { ($_ -split '\s+')[1] -ceq $file })
  if (!$entry -or (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash -ine ($entry -split '\s+')[0]) {
    throw "Unexpected Node distribution digest for $file"
  }
}
& tar.exe -xzf (Join-Path $out $nodeHeaders) -C $out
if ($LASTEXITCODE) { throw 'Node header extraction failed' }
$native = $PSScriptRoot
& rustc --edition=2021 --crate-type=staticlib --cfg vdt_storage_addon --target=x86_64-pc-windows-msvc -C panic=abort (Join-Path $native 'windows-storage-addon.rs') -o (Join-Path $out 'vdt_storage.lib')
if ($LASTEXITCODE) { throw 'Windows storage Rust compilation failed' }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'MSVC x64 tools were not found' }
$developer = Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
$headers = Join-Path $out "node-v$version\include\node"
$source = Join-Path $native 'windows-storage-addon.c'
$build = Join-Path $out 'build-addon.cmd'
@"
@echo off
call "$developer" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 exit /b 1
cd /d "$out"
cl /nologo /std:c11 /W4 /WX /LD /DNAPI_VERSION=8 /I"$headers" "$source" vdt_storage.lib node.lib advapi32.lib ntdll.lib ws2_32.lib userenv.lib bcrypt.lib ncrypt.lib secur32.lib shell32.lib ole32.lib /link /OUT:windows-storage.node
if errorlevel 1 exit /b 1
dumpbin /DEPENDENTS windows-storage.node > windows-storage-dependents.txt
if errorlevel 1 exit /b 1
"@ | Set-Content -Encoding ascii -LiteralPath $build
& cmd.exe /d /c $build
if ($LASTEXITCODE) { throw 'Windows storage Node-API shim linking failed' }
