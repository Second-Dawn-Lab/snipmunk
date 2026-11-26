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
  ; The template files (.snpt): the app icon with a layout badge, installed as snpt.ico. Opening one asks before importing it.
  WriteRegStr SHCTX "Software\Classes\.snpt" "" "Snipmunk.Template"
  WriteRegStr SHCTX "Software\Classes\.snpt" "Content Type" "application/x-snipmunk-template"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.Template" "" "Snipmunk template"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.Template\DefaultIcon" "" "$INSTDIR\snpt.ico"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.Template\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.Template\shell\open" "" "Open with Snipmunk"
  WriteRegStr SHCTX "Software\Classes\Snipmunk.Template\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

; Uninstalling removes the file types and everything Snipmunk wrote to the registry. Its data (settings, kept screenshots,
; templates, guides being worked on, an unsaved recording) goes only when the "Delete the application data" box of the
; uninstaller was ticked (it is not, at first; a silent uninstall keeps everything). Files the user saved anywhere else are
; never touched, nor is the shared Second Dawn model folder (%AppData%\SecondDawn\models): other Second Dawn apps may use
; it. During an update nothing of this happens.
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
  DeleteRegKey SHCTX "Software\Classes\Snipmunk.Template"
  ReadRegStr $0 SHCTX "Software\Classes\.snpt" ""
  ${If} $0 == "Snipmunk.Template"
    DeleteRegKey SHCTX "Software\Classes\.snpt"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${If} $UpdateMode <> 1
    ; Where it was installed and the installer's language; Windows' note on the "Start with Windows" entry.
    DeleteRegKey HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  ${EndIf}
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RMDir /r "$APPDATA\SecondDawn\snipmunk"
    RMDir /r "$TEMP\Snipmunk"
    ; (only when nothing of another Second Dawn app is left in it)
    RMDir "$APPDATA\SecondDawn"
  ${EndIf}
!macroend
