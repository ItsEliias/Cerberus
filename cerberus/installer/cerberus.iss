; Inno Setup script — package the PyInstaller onedir output into a Windows
; installer (Cerberus-Setup-<version>.exe).
;
; Built in CI (see .github/workflows/build-windows.yml). Locally:
;   iscc /DAppVersion=0.1.0 installer\cerberus.iss
;
; Expects the PyInstaller build to have produced dist\Cerberus\ (onedir) and the
; build script to have rendered desktop_assets\cerberus.ico.

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

; Bundle profile (full|lean) — kept in the output filename so a release can carry
; both installers without an asset-name collision.
#ifndef Profile
  #define Profile "full"
#endif

#define AppName "Cerberus"
#define AppPublisher "ItsEliias"
#define AppExeName "Cerberus.exe"

[Setup]
AppId={{7C3F5B2A-CE41-4E2E-9A2C-CERBERUSAPP01}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Per-user install by default (no admin prompt); flip to "admin" for all-users.
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist-installer
OutputBaseFilename=Cerberus-Setup-{#AppVersion}-{#Profile}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\desktop_assets\cerberus.ico
UninstallDisplayIcon={app}\{#AppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
; The entire PyInstaller onedir tree.
Source: "..\dist\Cerberus\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
