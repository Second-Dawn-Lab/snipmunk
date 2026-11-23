; Extra steps for the Snipmunk (NSIS) installer, hooked in through tauri.conf.json (bundle.windows.nsis.installerHooks).

; The project files (.snpr): their own icon (the app icon with a video badge, installed as snpr.ico) and "Open with Snipmunk".
; Registered for the current user (SHCTX is HKCU in the current-user install mode) and removed again by the uninstaller.
; This does not use bundle.fileAssociations: that registers the app's exe icon and cannot be given another one. The shell is told
; with SHChangeNotify(SHCNE_ASSOCCHANGED) so Explorer shows the new icon without a restart.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\.snpr" "" "Snipmunk.RecordingProject"
  WriteRegStr SHCTX "Software\Classes\.snpr" "Content Type" "application/x-snipmunk-recording"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.RecordingProject" "" "Snipmunk recording project"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.RecordingProject\DefaultIcon" "" "$INSTDIR\snpr.ico"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.RecordingProject\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.RecordingProject\shell\open" "" "Open with Snipmunk"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.RecordingProject\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ; The guide files (.snpd): the app icon with a document badge, installed as snpd.ico.
  WriteRegStr SHCTX "Software\Classes\.snpd" "" "Snipmunk.GuideDocument"
  WriteRegStr SHCTX "Software\Classes\.snpd" "Content Type" "application/x-snipmunk-document"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.GuideDocument" "" "Snipmunk guide"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.GuideDocument\DefaultIcon" "" "$INSTDIR\snpd.ico"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.GuideDocument\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.GuideDocument\shell\open" "" "Open with Snipmunk"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.GuideDocument\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

; Snipmunk's own settings and kept screenshots (%AppData%\SecondDawn\snipmunk) are removed only when the user agrees.
; The shared Second Dawn model folder (%AppData%\SecondDawn\models) is never touched: other Second Dawn apps may use it.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\Snipmunk.RecordingProject"
  ReadRegStr $0 SHCTX "Software\Classes\.snpr" ""
  ${If} $0 == "Snipmunk.RecordingProject"
    DeleteRegKey SHCTX "Software\Classes\.snpr"
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\Snipmunk.GuideDocument"
  ReadRegStr $0 SHCTX "Software\Classes\.snpd" ""
  ${If} $0 == "Snipmunk.GuideDocument"
    DeleteRegKey SHCTX "Software\Classes\.snpd"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Not when the uninstaller runs as part of an update, and not in silent mode.
  ${If} $UpdateMode <> 1
    IfSilent snipmunk_keep_data
    MessageBox MB_YESNO|MB_ICONQUESTION "Also delete Snipmunk's settings and saved screenshots?$\r$\n$\r$\nThis removes every kept session and cannot be undone." /SD IDNO IDNO snipmunk_keep_data
    RMDir /r "$APPDATA\SecondDawn\snipmunk"
    snipmunk_keep_data:
  ${EndIf}
!macroend
