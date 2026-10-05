@echo off
REM ==========================================================================
REM  SharkTracker - Prueba C0 del motor de clips
REM  1) Doble clic ANTES de entrar a una partida (pide permiso de administrador
REM     para poder medir los FPS).
REM  2) Juega normal: la prueba empieza sola y dura unos 6 minutos de partida.
REM  3) Al final deja resultados-clips-C0.txt y clip-prueba-C0.mp4 en esta carpeta.
REM  No instala nada. Herramientas en %LOCALAPPDATA%\SharkTracker-prueba-clips
REM  (se puede borrar esa carpeta despues).
REM ==========================================================================
setlocal
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 (
  echo Pidiendo permiso de administrador para medir los FPS...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title SharkTracker - Prueba de clips (C0)
set "ST_BAT=%~f0"
set "ST_SALIDA=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = [IO.File]::ReadAllText($env:ST_BAT, [Text.Encoding]::UTF8); $i = $t.IndexOf('#' + 'PS-INICIO'); Invoke-Expression $t.Substring($i)"
echo.
echo Listo. Puedes cerrar esta ventana.
pause >nul
exit /b
#PS-INICIO
# ============================================================================
#  SharkTracker - Prueba C0 del motor de clips
#  Mide cuanto cuesta grabar (FPS, CPU, RAM, GPU) en una partida real de LoL.
#  No instala nada: baja FFmpeg y PresentMon a una carpeta propia y al terminar
#  deja "resultados-clips-C0.txt" y un clip de prueba junto a este .bat.
#  No toca el juego ni la cuenta: solo graba la pantalla, como OBS.
# ============================================================================
$ErrorActionPreference = 'Continue'   # FFmpeg escribe avisos por stderr: en 'Stop' PowerShell 5.1 los toma como error
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Carpeta = Join-Path $env:LOCALAPPDATA 'SharkTracker-prueba-clips'
$Salida  = $env:ST_SALIDA
if (-not $Salida) { $Salida = [Environment]::GetFolderPath('Desktop') }
$Buf     = Join-Path $Carpeta 'bufer'
$Res     = Join-Path $Salida 'resultados-clips-C0.txt'
New-Item -ItemType Directory -Force -Path $Carpeta, $Buf | Out-Null
Get-ChildItem $Buf -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Set-Content -Path $Res -Value '' -Encoding UTF8

function Log([string]$t) { Write-Host $t; Add-Content -Path $Res -Value $t -Encoding UTF8 }
function Titulo([string]$t) { Log ''; Log ('== ' + $t + ' ' + ('=' * [Math]::Max(3, 60 - $t.Length))) }
function Aviso([string]$t) { Write-Host $t -ForegroundColor Cyan }

Log 'SharkTracker - Prueba C0 del motor de clips'
Log ('Fecha: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm'))

# ---------------------------------------------------------------- 1. El equipo
Titulo 'Equipo'
$os  = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ramGB = [Math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
Log ("Windows: {0} (compilacion {1})" -f $os.Caption, $os.BuildNumber)
Log ("CPU: {0} ({1} nucleos / {2} hilos)" -f $cpu.Name.Trim(), $cpu.NumberOfCores, $cpu.NumberOfLogicalProcessors)
Log ("RAM: {0} GB" -f $ramGB)
$gpus = @(Get-CimInstance Win32_VideoController)
foreach ($g in $gpus) {
  $res = ''
  if ($g.CurrentHorizontalResolution) { $res = " - pantalla {0}x{1} a {2} Hz" -f $g.CurrentHorizontalResolution, $g.CurrentVerticalResolution, $g.CurrentRefreshRate }
  Log ("GPU: {0} (driver {1}){2}" -f $g.Name, $g.DriverVersion, $res)
}
$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
if ($bat) {
  $enchufada = ($bat.BatteryStatus -eq 2 -or $bat.BatteryStatus -ge 6)
  if ($enchufada) { Log 'Tipo: laptop, ENCHUFADA (bien)' }
  else { Log 'Tipo: laptop, CON BATERIA (los resultados salen peores: mejor repetir enchufada)' }
} else { Log 'Tipo: escritorio' }
$nombresGpu = ($gpus | ForEach-Object { $_.Name }) -join ' | '
$hayNvidia = $nombresGpu -match 'NVIDIA'
$hayAmd    = $nombresGpu -match 'AMD|Radeon'
$hayIntel  = $nombresGpu -match 'Intel'
if ([int]$os.BuildNumber -ge 19041) { Log 'Audio por programa (juego / Discord por separado): compatible con este Windows' }
else { Log 'Audio por programa: NO compatible (hace falta Windows 10 2004 o mas nuevo)' }

# ------------------------------------------------------- 2. Herramientas (una vez)
Titulo 'Herramientas'
$ffmpeg = Get-ChildItem $Carpeta -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ffmpeg) {
  Aviso 'Bajando FFmpeg (solo la primera vez, unos 80 MB)...'
  $zip = Join-Path $Carpeta 'ffmpeg.zip'
  try {
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip' -OutFile $zip -ErrorAction Stop
  Expand-Archive -Path $zip -DestinationPath (Join-Path $Carpeta 'ffmpeg') -Force -ErrorAction Stop
  Remove-Item $zip -Force
  } catch { Log ('Error bajando FFmpeg: ' + $_.Exception.Message) }
  $ffmpeg = Get-ChildItem $Carpeta -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $ffmpeg) { Log 'No se pudo bajar FFmpeg (revisa la conexion y vuelve a abrir el .bat).'; return }
$FF = $ffmpeg.FullName
Log ('FFmpeg: ' + ((& $FF -hide_banner -version 2>&1 | Select-Object -First 1) -replace '^ffmpeg version ', ''))

$PM = $null
$pmExe = Get-ChildItem $Carpeta -Filter 'PresentMon*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pmExe) {
  try {
    Aviso 'Bajando PresentMon (mide los FPS, solo la primera vez)...'
    $rel = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/GameTechDev/PresentMon/releases/latest' -Headers @{ 'User-Agent' = 'SharkTracker' } -ErrorAction Stop
    $asset = $rel.assets | Where-Object { $_.name -match '^PresentMon-[\d\.]+-x64\.exe$' } | Select-Object -First 1
    if (-not $asset) { $asset = $rel.assets | Where-Object { $_.name -match 'x64\.exe$' -and $_.name -notmatch 'Service|DLL|arm' } | Select-Object -First 1 }
    if ($asset) {
      $pmPath = Join-Path $Carpeta $asset.name
      Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $pmPath -ErrorAction Stop
      $pmExe = Get-Item $pmPath
    }
  } catch { Log ('PresentMon no se pudo bajar: ' + $_.Exception.Message) }
}
if ($pmExe) { $PM = $pmExe.FullName; Log ('PresentMon: ' + $pmExe.Name) }
else { Log 'PresentMon: no disponible (se mide CPU/GPU/RAM, pero no los FPS)' }

# ---------------------------------------------- 3. Que codificador funciona aqui
Titulo 'Codificadores (prueba de 3 s en el escritorio)'
$calidad = @('-b:v', '15M', '-maxrate', '25M', '-bufsize', '30M', '-g', '120')
$cands = @()
if ($hayNvidia) {
  $cands += @{ n = 'NVIDIA NVENC (directo en la GPU)'; vf = @(); c = @('-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr') }
  $cands += @{ n = 'NVIDIA NVENC (con copia a memoria, laptops)'; vf = @('-vf', 'hwdownload,format=bgra'); c = @('-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr') }
}
if ($hayAmd) {
  $cands += @{ n = 'AMD AMF (directo en la GPU)'; vf = @(); c = @('-c:v', 'h264_amf', '-usage', 'lowlatency', '-quality', 'balanced', '-rc', 'vbr_peak') }
  $cands += @{ n = 'AMD AMF (con copia a memoria)'; vf = @('-vf', 'hwdownload,format=bgra'); c = @('-c:v', 'h264_amf', '-usage', 'lowlatency', '-quality', 'balanced', '-rc', 'vbr_peak') }
}
if ($hayIntel) {
  $cands += @{ n = 'Intel QuickSync'; vf = @('-vf', 'hwmap=derive_device=qsv,format=qsv'); c = @('-c:v', 'h264_qsv', '-preset', 'faster') }
}
$elegido = $null
$prueba = Join-Path $Carpeta 'prueba.mp4'
foreach ($c in $cands) {
  Remove-Item $prueba -Force -ErrorAction SilentlyContinue
  $a = @('-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'ddagrab=output_idx=0:framerate=60', '-t', '3') + $c.vf + $c.c + $calidad + @($prueba)
  $err = & $FF @a 2>&1 | Out-String
  $ok = (Test-Path $prueba) -and ((Get-Item $prueba).Length -gt 20KB)
  if ($ok) {
    Log ("OK    " + $c.n)
    if (-not $elegido) { $elegido = $c }
  } else {
    $linea = ($err -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1)
    Log ("FALLA " + $c.n + "  (" + ($linea -replace '\s+', ' ').Trim() + ")")
  }
}
Remove-Item $prueba -Force -ErrorAction SilentlyContinue
if (-not $elegido) {
  Log ''
  Log 'Ningun codificador por hardware funciono en este equipo. Pasale este archivo a Alex.'
  return
}
Log ('Se usa: ' + $elegido.n)

# ------------------------------------------------------------ 4. Esperar partida
Titulo 'Partida'
Add-Type @'
using System.Net; using System.Security.Cryptography.X509Certificates;
public class StConfiar : ICertificatePolicy { public bool CheckValidationResult(ServicePoint a, X509Certificate b, WebRequest c, int d) { return true; } }
'@ -ErrorAction SilentlyContinue
[Net.ServicePointManager]::CertificatePolicy = New-Object StConfiar
function TiempoDeJuego {
  try { (Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 -Uri 'https://127.0.0.1:2999/liveclientdata/gamestats').gameTime } catch { $null }
}
Aviso ''
Aviso 'Listo. Ahora entra a una partida (normal, ARAM o practica sirven).'
Aviso 'Consejo: usa el modo de pantalla "Sin bordes" en las opciones de video de LoL.'
Aviso 'La prueba empieza sola cuando pasa la pantalla de carga. No cierres esta ventana.'
while ($true) {
  $t = TiempoDeJuego
  if ($t -and $t -gt 15) { break }
  Start-Sleep -Seconds 3
}
Log ('Partida detectada (minuto {0:N1}).' -f ($t / 60))

# ------------------------------------------------------------------- 5. Medir
function EnPartida { [bool](Get-Process -Name 'League of Legends' -ErrorAction SilentlyContinue) }

function IniciarGrabacion {
  $a = @('-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'ddagrab=output_idx=0:framerate=60') + $elegido.vf + $elegido.c + $calidad +
       @('-f', 'segment', '-segment_time', '2', '-segment_wrap', '30', '-reset_timestamps', '1', '-segment_format', 'mpegts', (Join-Path $Buf 'trozo%03d.ts'))
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $FF
  $psi.Arguments = ($a | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = [Diagnostics.Process]::Start($psi)
  Start-Sleep -Milliseconds 300
  try { $p.PriorityClass = 'BelowNormal' } catch {}
  return $p
}
function DetenerGrabacion($p) {
  try { $p.StandardInput.Write('q'); $p.StandardInput.Flush() } catch {}
  if (-not $p.WaitForExit(5000)) { try { $p.Kill() } catch {} }
}

function Fps([string]$csv) {
  if (-not (Test-Path $csv)) { return $null }
  $filas = Import-Csv $csv | Where-Object { $_.Application -match 'League of Legends' }
  if (-not $filas) { return $null }
  $col = @('MsBetweenPresents', 'FrameTime', 'msBetweenPresents') | Where-Object { $filas[0].PSObject.Properties.Name -contains $_ } | Select-Object -First 1
  if (-not $col) { return $null }
  $inv = [Globalization.CultureInfo]::InvariantCulture
  $ms = @($filas | ForEach-Object { $v = 0.0; if ([double]::TryParse($_.$col, [Globalization.NumberStyles]::Float, $inv, [ref]$v)) { $v } } | Where-Object { $_ -gt 0 })
  if ($ms.Count -lt 50) { return $null }
  $media = ($ms | Measure-Object -Average).Average
  $orden = $ms | Sort-Object -Descending
  $peor1 = ($orden | Select-Object -First ([Math]::Max(1, [int]($ms.Count / 100))) | Measure-Object -Average).Average
  return @{ fps = 1000 / $media; bajo1 = 1000 / $peor1 }
}

function Bloque([string]$nombre, [bool]$grabar, [int]$seg) {
  $ff = $null
  if ($grabar) { $ff = IniciarGrabacion; Start-Sleep -Seconds 3 }
  $csv = Join-Path $Carpeta ("fps-" + $nombre + ".csv")
  Remove-Item $csv -Force -ErrorAction SilentlyContinue
  $pm = $null
  if ($PM) {
    $pm = Start-Process -FilePath $PM -WindowStyle Hidden -PassThru -ArgumentList @(
      '--process_name', '"League of Legends.exe"', '--output_file', ('"' + $csv + '"'),
      '--timed', $seg, '--terminate_after_timed', '--no_console_stats', '--stop_existing_session')
  }
  $cpuT = @(); $g3d = @(); $genc = @()
  $cpuFfIni = $null; if ($ff) { try { $ff.Refresh(); $cpuFfIni = $ff.TotalProcessorTime } catch {} }
  $reloj = [Diagnostics.Stopwatch]::StartNew()
  $ramFf = 0
  while ($reloj.Elapsed.TotalSeconds -lt $seg) {
    if (-not (EnPartida)) { break }
    try { $cpuT += [double](Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime } catch {}
    try {
      $eng = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine
      $g3d  += [double](($eng | Where-Object { $_.Name -match 'engtype_3D$' } | Measure-Object UtilizationPercentage -Sum).Sum)
      $genc += [double](($eng | Where-Object { $_.Name -match 'engtype_VideoEncode$' } | Measure-Object UtilizationPercentage -Sum).Sum)
    } catch {}
    if ($ff) { try { $ff.Refresh(); $ramFf = [Math]::Max($ramFf, $ff.WorkingSet64) } catch {} }
    Start-Sleep -Seconds 2
  }
  $dur = $reloj.Elapsed.TotalSeconds
  $cpuFf = $null
  if ($ff -and $cpuFfIni) { try { $ff.Refresh(); $cpuFf = 100 * ($ff.TotalProcessorTime - $cpuFfIni).TotalSeconds / $dur / [Environment]::ProcessorCount } catch {} }
  if ($pm) { try { $pm.WaitForExit(15000) | Out-Null } catch {} }
  if ($ff) { DetenerGrabacion $ff }
  $prom = { param($l) if ($l.Count) { ($l | Measure-Object -Average).Average } else { $null } }
  return [pscustomobject]@{
    Bloque = $nombre; Graba = $grabar; Segundos = [int]$dur
    Fps = (Fps $csv); Cpu = (& $prom $cpuT); Gpu3D = (& $prom $g3d); GpuEnc = (& $prom $genc)
    CpuFfmpeg = $cpuFf; RamFfmpegMB = [Math]::Round($ramFf / 1MB)
  }
}

Aviso 'Midiendo: 4 tramos de 75 s (sin grabar / grabando / sin grabar / grabando). Juega normal.'
$tramos = @()
$plan = @(@('1-sin', $false), @('2-con', $true), @('3-sin', $false), @('4-con', $true))
foreach ($p in $plan) {
  if (-not (EnPartida)) { break }
  Aviso ("Tramo " + $p[0] + "...")
  $tramos += Bloque $p[0] $p[1] 75
}

# ---------------------------------------------- 6. Guardar un clip (sin recodificar)
Titulo 'Clip de prueba'
$trozos = @(Get-ChildItem $Buf -Filter 'trozo*.ts' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 15)
if ($trozos.Count -ge 3) {
  $lista = Join-Path $Carpeta 'lista.txt'
  Set-Content -Path $lista -Encoding ASCII -Value ($trozos | ForEach-Object { "file '" + ($_.FullName -replace "'", "'\''") + "'" })
  $clip = Join-Path $Salida 'clip-prueba-C0.mp4'
  $t0 = [Diagnostics.Stopwatch]::StartNew()
  & $FF -hide_banner -loglevel error -y -f concat -safe 0 -i $lista -c copy $clip 2>&1 | Out-Null
  $t0.Stop()
  if (Test-Path $clip) {
    Log ("Guardado clip-prueba-C0.mp4 ({0:N1} MB) en {1:N2} s, sin recodificar." -f ((Get-Item $clip).Length / 1MB), $t0.Elapsed.TotalSeconds)
    Log 'Abrelo: si se ve el juego (no negro) y fluido, la captura funciona.'
  } else { Log 'No se pudo armar el clip de prueba.' }
} else { Log 'No hubo grabacion suficiente para armar un clip (la partida termino antes?).' }

# ------------------------------------------------------------------ 7. Resumen
Titulo 'Resultados'
$f = { param($v, $fmt) if ($null -eq $v) { '   -  ' } else { $fmt -f $v } }
Log 'Tramo   Graba   FPS    1%bajo  CPU%   GPU3D%  Codif%  FFmpeg CPU%  FFmpeg RAM'
foreach ($r in $tramos) {
  $fps = $null; $baj = $null; if ($r.Fps) { $fps = $r.Fps.fps; $baj = $r.Fps.bajo1 }
  $ram = '   -'; if ($r.Graba) { $ram = ('{0,5} MB' -f $r.RamFfmpegMB) }
  Log ('{0,-7} {1,-6} {2} {3} {4} {5} {6} {7}      {8}' -f $r.Bloque, ($(if ($r.Graba) { 'si' } else { 'no' })),
    (& $f $fps '{0,6:N1}'), (& $f $baj '{0,6:N1}'), (& $f $r.Cpu '{0,6:N1}'), (& $f $r.Gpu3D '{0,6:N1}'), (& $f $r.GpuEnc '{0,6:N1}'),
    (& $f $r.CpuFfmpeg '{0,6:N2}'), $ram)
}
$sin = @($tramos | Where-Object { -not $_.Graba }); $con = @($tramos | Where-Object { $_.Graba })
function Media($lista, [scriptblock]$sel) { $v = @($lista | ForEach-Object $sel | Where-Object { $null -ne $_ }); if ($v.Count) { ($v | Measure-Object -Average).Average } else { $null } }
$fpsSin = Media $sin { if ($_.Fps) { $_.Fps.fps } }; $fpsCon = Media $con { if ($_.Fps) { $_.Fps.fps } }
$cpuSin = Media $sin { $_.Cpu }; $cpuCon = Media $con { $_.Cpu }
$ramMax = ($con | Measure-Object RamFfmpegMB -Maximum).Maximum
Log ''
Log 'Meta: perder menos de 3 % de FPS, menos de 5 puntos de CPU y menos de 150 MB de RAM.'
if ($fpsSin -and $fpsCon) {
  $perd = 100 * ($fpsSin - $fpsCon) / $fpsSin
  Log ('FPS: {0:N1} sin grabar -> {1:N1} grabando ({2:N1} % menos)  {3}' -f $fpsSin, $fpsCon, $perd, $(if ($perd -lt 3) { 'CUMPLE' } else { 'NO CUMPLE' }))
} else { Log 'FPS: sin datos (PresentMon no pudo medir)' }
if ($null -ne $cpuSin -and $null -ne $cpuCon) {
  $d = $cpuCon - $cpuSin
  Log ('CPU: {0:N1} % -> {1:N1} % (+{2:N1} puntos)  {3}' -f $cpuSin, $cpuCon, $d, $(if ($d -lt 5) { 'CUMPLE' } else { 'NO CUMPLE' }))
}
if ($ramMax) { Log ('RAM de la grabacion: {0} MB  {1}' -f $ramMax, $(if ($ramMax -lt 150) { 'CUMPLE' } else { 'NO CUMPLE' })) }
if ($tramos.Count -lt 4) { Log ('Ojo: solo se midieron {0} de 4 tramos (la partida termino antes). Mejor repetir en una partida larga.' -f $tramos.Count) }

Get-ChildItem $Buf -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Log ''
Log 'Fin. Pasale a Alex este archivo (resultados-clips-C0.txt) y dile como se ve clip-prueba-C0.mp4.'
