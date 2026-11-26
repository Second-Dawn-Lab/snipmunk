# Snipmunk in the Microsoft Store (MSIX)

The Store accepts an **unsigned MSIX** and signs it itself, so no certificate has to be bought. The Store build is the same app
with the cargo feature `store`.

## What is different in the Store build

| Area | In the installer (NSIS) build | In the Store (MSIX) build | State |
|---|---|---|---|
| Updates | In-app updater | No updater; the Store updates. Settings → About says so | built in |
| Start with Windows | Registry entry (`--hidden`) | The package's start-up task `SnipmunkStartup` (off at first), with `--hidden`. If the user switched it off in Task Manager, Windows refuses and the switch goes back | built in, **test by hand** |
| Data (settings, sessions, templates, guides) | `%AppData%\SecondDawn\snipmunk` | `%LocalAppData%\Packages\<package family>\LocalState\SecondDawn\snipmunk` | built in, **test by hand** |
| Temporary files | `%Temp%\Snipmunk` | `...\Packages\<package family>\TempState\Snipmunk` | built in, **test by hand** |
| Application id (taskbar, Task Manager) | Set by the program: `lab.seconddawn.snipmunk` | Given by the package; the program sets none | built in |
| File types `.snpr` `.snpd` `.snpt` | Registry (installer hooks) | Declared in the manifest | **test by hand** |
| Web view data and cache | `%LocalAppData%\lab.seconddawn.snipmunk` | The same path, redirected into the package by Windows | **test by hand** |

Why the data moves: Windows redirects what a packaged app newly writes below `%AppData%` into a private place that **other
programs do not see** ([how packaged desktop apps run](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes),
[virtualization](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization)). Snipmunk hands files to other
programs (drag out, the clipboard's files, "Show in Explorer", "Open folder"), so it uses the package's own `LocalState` and
`TempState` folders. That those folders are readable by other programs, and that nothing else breaks, **has to be checked in the
sideload test**: Microsoft's pages do not say it for `TempState`, and nothing was installed while this was built.

A user who moves from the installer to the Store version starts with empty settings and lists (different folders). Both can be
installed, but only one runs at a time (a second start brings the running one forward).

### Expected to work unchanged (full-trust app), to be confirmed by the test

| Feature | Note |
|---|---|
| Global shortcuts (keyboard hook) and the guide recorder's mouse hook | Ordinary Win32; allowed for `runFullTrust` apps |
| Leaving Snipmunk's windows out of screen captures (`WDA_EXCLUDEFROMCAPTURE`) | Needs Windows 10 2004, the package's minimum |
| Screen capture (Windows.Graphics.Capture), system sound and microphone (WASAPI), webcam | `microphone` and `webcam` are declared; Windows' privacy settings still decide |
| WebView2 | Uses the WebView2 runtime of Windows (part of Windows 11 and current Windows 10). A Store package cannot install it |
| Single instance | The same named mutex |
| Text recognition (Windows OCR), the share sheet | Windows' own |

## 1. Build the package

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1
```

Needs the Windows 10 or 11 SDK. The result is `target-release\msix\Snipmunk_<version>.0_x64.msix` (unsigned). The pictures of
all sizes are made from `assets\icon\Snipmunk_logo.png` while building.

The identity comes from `src-tauri\msix\identity.json`. Without it a **test identity** is used (`CN=Snipmunk Test`), fine only
for the local test below.

## 2. Test it locally (sideload), with a test certificate you make yourself

Windows installs only signed packages. Run these yourself in an **administrator PowerShell**; they create a certificate that
only your computer trusts. Remove it again afterwards.

```powershell
$cert = New-SelfSignedCertificate -Type Custom -Subject "CN=Snipmunk Test" -KeyUsage DigitalSignature -FriendlyName "Snipmunk test" -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
```

```powershell
Export-Certificate -Cert $cert -FilePath "$env:TEMP\snipmunk-test.cer"; Import-Certificate -FilePath "$env:TEMP\snipmunk-test.cer" -CertStoreLocation "Cert:\LocalMachine\TrustedPeople"
```

```powershell
$signtool = (Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\signtool.exe" | Sort-Object FullName | Select-Object -Last 1).FullName; & $signtool sign /fd SHA256 /sha1 $cert.Thumbprint "E:\SecondDawn\snipmunk\target-release\msix\Snipmunk_0.1.0.0_x64.msix"
```

```powershell
Add-AppxPackage "E:\SecondDawn\snipmunk\target-release\msix\Snipmunk_0.1.0.0_x64.msix"
```

Check (close the installer version first):

- [ ] Starts from the Start menu; the taskbar and Task Manager show one "Snipmunk".
- [ ] Screenshot (shortcut and button), recording with microphone and webcam, a guide recording.
- [ ] Settings are kept after a restart; "Show in Explorer" and "Open folder" show real folders; drag a screenshot into another
      app; "Copy" a capture and paste the file in Explorer; export a video and a guide.
- [ ] Double-click a `.snpr`, a `.snpd` and a `.snpt` file (icons shown), also while Snipmunk runs.
- [ ] Settings → General → "Start with Windows" on, sign out and in: starts minimized. Switch it off in Task Manager, then on in
      Snipmunk: the switch goes back.
- [ ] Settings → About says the Store keeps it up to date; no update notice ever.

Remove the test:

```powershell
Get-AppxPackage SecondDawn.Snipmunk.Test | Remove-AppxPackage
```

```powershell
Get-ChildItem Cert:\LocalMachine\TrustedPeople, Cert:\CurrentUser\My | Where-Object { $_.Subject -eq "CN=Snipmunk Test" } | Remove-Item
```

Optionally run the **Windows App Certification Kit** (part of the SDK) on the package before submitting.

## 3. Submit in Partner Center

1. Register a developer account at [Partner Center](https://partner.microsoft.com/dashboard) (a one-time fee may apply; check
   the current terms).
2. **Apps and games → New product → MSIX or PWA app**, reserve the name **Snipmunk**.
3. **Product management → Product identity**: copy the three values into `src-tauri\msix\identity.json`
   (start from `identity.example.json`): `Package/Identity/Name`, `Package/Identity/Publisher`,
   `Package/Properties/PublisherDisplayName`. They are public values, not secrets.
4. Build the package again (step 1). Version `x.y.z.0` comes from `package.json`; every submission needs a higher one.
5. **Start a submission**:
   - **Pricing and availability**: free, the markets you want.
   - **Properties**: category Productivity (or Utilities); **Privacy policy URL**:
     `https://github.com/Second-Dawn-Lab/snipmunk/blob/main/PRIVACY.md`; say that the app does not collect personal data;
     website and support: the GitHub repository and its issues page.
   - **Age ratings**: answer the questionnaire (no violence, no user-generated content shared by the app, no purchases, no web
     browsing).
   - **Packages**: upload the `.msix`. Partner Center signs it.
   - **Restricted capability** `runFullTrust`: give a short reason, for example "Desktop app (Win32) that captures the screen,
     records audio and video and registers global shortcuts."
   - **Store listings**: description, screenshots (at least one, 1366×768 or larger), the languages you want to list.
   - **Notes for certification**: say that guide recording uses mouse and keyboard hooks only while the user records a guide.
6. Submit. Certification takes from hours to a few days; read the report if it fails.

For an update: raise the version through the normal release (`docs/releasing.md`), build the package, upload it in a new
submission.
