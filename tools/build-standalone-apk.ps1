$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = Join-Path $projectRoot '.android-sdk'
$buildTools = Join-Path $sdkRoot 'build-tools\36.0.0'
$androidJar = Join-Path $sdkRoot 'platforms\android-36\android.jar'
$work = Join-Path $projectRoot 'manual-apk\out'
$assets = Join-Path $work 'assets\public'
$classes = Join-Path $work 'classes'
$dex = Join-Path $work 'dex'
$res = Join-Path $work 'res'
$generated = Join-Path $work 'generated'

if (!(Test-Path (Join-Path $buildTools 'aapt2.exe'))) { throw "Android build-tools are missing: $buildTools" }
if (!(Test-Path $androidJar)) { throw "Android platform is missing: $androidJar" }

New-Item -ItemType Directory -Force -Path $assets,$classes,$dex,$res,$generated | Out-Null
& python (Join-Path $PSScriptRoot 'prepare-web-assets.py') (Join-Path $projectRoot 'dist') $assets
Copy-Item -Path (Join-Path $PSScriptRoot 'manual-apk\res\*') -Destination $res -Recurse -Force

$srcRoot = Join-Path $PSScriptRoot 'manual-apk\src'
$manifest = Join-Path $PSScriptRoot 'manual-apk\AndroidManifest.xml'
$assetsForAapt = $assets.Replace('\\', '/')
& (Join-Path $env:JAVA_HOME 'bin\javac.exe') -source 8 -target 8 -classpath $androidJar -d $classes (Join-Path $srcRoot 'com\pathlens\standalone\MainActivity.java')
& (Join-Path $buildTools 'd8.bat') --lib $androidJar --output $dex (Get-ChildItem $classes -Filter '*.class' -Recurse | Select-Object -ExpandProperty FullName)
& (Join-Path $buildTools 'aapt2.exe') compile --dir $res -o (Join-Path $work 'resources.zip')
& (Join-Path $buildTools 'aapt2.exe') link -o (Join-Path $work 'unsigned.apk') --manifest $manifest -I $androidJar --auto-add-overlay --no-version-vectors --java $generated --version-code 1 --version-name 1.0 -A $assetsForAapt (Join-Path $work 'resources.zip')
& python (Join-Path $PSScriptRoot 'normalize-apk-zip.py') (Join-Path $work 'unsigned.apk')
& (Join-Path $env:JAVA_HOME 'bin\jar.exe') uf (Join-Path $work 'unsigned.apk') -C $dex classes.dex
& (Join-Path $buildTools 'zipalign.exe') -f 4 (Join-Path $work 'unsigned.apk') (Join-Path $work 'aligned.apk')

$keystore = Join-Path $work 'pathlens-debug.keystore'
if (!(Test-Path $keystore)) {
  & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -v -keystore $keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=PathLens,O=PathLens,C=CN'
}
$output = Join-Path $projectRoot 'PathLens-debug.apk'
& (Join-Path $buildTools 'apksigner.bat') sign --ks $keystore --ks-pass pass:android --key-pass pass:android --out $output (Join-Path $work 'aligned.apk')
& (Join-Path $buildTools 'apksigner.bat') verify --verbose $output
Write-Output "APK: $output"
