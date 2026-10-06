$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "Le compilateur C# de Windows est introuvable." }

$outDir = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir "Atelier Witchfire.exe"

$files = @()
$files += Get-ChildItem -File -Path (Join-Path $root "*") -Include *.html, *.js, *.css
$files += Get-ChildItem -File -Path (Join-Path $root "images") -Filter *.png
if (-not ($files | Where-Object { $_.Name -eq "index.html" })) { throw "index.html est introuvable." }

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("/nologo")
$lines.Add("/target:winexe")
$lines.Add("/optimize+")
$lines.Add("/utf8output")
$lines.Add('/out:"' + $exe + '"')
$lines.Add("/reference:System.dll")
$lines.Add("/reference:System.Windows.Forms.dll")
$lines.Add("/reference:System.Drawing.dll")
foreach ($file in $files) {
    $logical = $file.FullName.Substring($root.Length + 1).Replace("\", "/")
    $lines.Add('/resource:"' + $file.FullName + '","' + $logical + '"')
}
$lines.Add('"' + (Join-Path $root "launcher\Launcher.cs") + '"')

$rsp = Join-Path $env:TEMP "witchfire-atelier.rsp"
[System.IO.File]::WriteAllLines($rsp, $lines.ToArray(), [System.Text.UTF8Encoding]::new($false))
& $csc "@$rsp"
if ($LASTEXITCODE -ne 0) { throw "La compilation a échoué." }
Copy-Item -LiteralPath $exe -Destination (Join-Path $root "Atelier Witchfire.exe") -Force
Get-Item -LiteralPath (Join-Path $root "Atelier Witchfire.exe") | Select-Object FullName, Length
