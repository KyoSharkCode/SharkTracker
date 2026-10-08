@echo off
rem Compila sharkaudio.exe con Visual Studio (lo usa "App: publicar versión" antes de
rem armar el instalador). Para probar a mano: abrir esta carpeta y correr compilar.cmd.
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%i"
if not defined VS (echo No se encontro Visual Studio con C++ & exit /b 1)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
cl /nologo /O2 /EHsc /std:c++17 /utf-8 /W3 /DUNICODE /D_UNICODE /MT sharkaudio.cpp /Fe:sharkaudio.exe ole32.lib mmdevapi.lib uuid.lib propsys.lib winmm.lib || exit /b 1
del /q sharkaudio.obj 2>nul
echo sharkaudio.exe listo
