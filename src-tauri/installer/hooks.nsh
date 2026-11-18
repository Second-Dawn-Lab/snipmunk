; Extra steps for the Snipmunk (NSIS) installer, hooked in through tauri.conf.json (bundle.windows.nsis.installerHooks).

; Snipmunk's own settings and kept screenshots (%AppData%\SecondDawn\snipmunk) are removed only when the user agrees.
; The shared Second Dawn model folder (%AppData%\SecondDawn\models) is never touched: other Second Dawn apps may use it.
!macro NSIS_HOOK_POSTUNINSTALL
  ; Not when the uninstaller runs as part of an update, and not in silent mode.
  ${If} $UpdateMode <> 1
    IfSilent snipmunk_keep_data
    MessageBox MB_YESNO|MB_ICONQUESTION "Also delete Snipmunk's settings and saved screenshots?$\r$\n$\r$\nThis removes every kept session and cannot be undone." /SD IDNO IDNO snipmunk_keep_data
    RMDir /r "$APPDATA\SecondDawn\snipmunk"
    snipmunk_keep_data:
  ${EndIf}
!macroend
