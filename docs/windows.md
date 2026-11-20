# Windows x64 audit — Job 28

No Windows machine or VM is available here. **Works** below means that an
implementation exists and its platform routing or logic was inspected/tested
with mocks on macOS; it does not mean a Windows runtime test passed. **No-op**
means intentionally absent. **Unknown** needs Daniel's Windows test.

| Feature / macOS path | Windows status | Evidence / limit |
| --- | --- | --- |
| `osascript`, Spotify AppleScript | No-op | `createMusicController()` selects `SpotifyWindowsController` on `win32`; selection has a unit test. Importing the Mac class executes no commands. |
| `lsappinfo`, `open -a` refocus | No-op | Only called by `SpotifyMacController.play()`. Windows URI playback can bring Spotify forward; there is no foreground-app restore. |
| `open -g` | No-op | Historical experiment in the decision log, no production call. |
| Spotify process check / URI playback | Unknown | PowerShell checks `Get-Process Spotify` before `Start-Process`; it does not deliberately launch a closed Spotify. With context it opens the playlist rather than the exact track. URI validation and the process guard are unit-tested. |
| Spotify track reading / pause / resume / next | Unknown | PowerShell uses Windows SMTC. WinRT async interoperability is unverified; reads fail to `null`, availability errors fail to `false`, transport errors fall back to system media keys. Those keys can affect another media app. |
| Volume fade / ducking | No-op | Windows `setVolume()` resolves without changing volume; no `getVolume()`, so the music service skips fades. |
| Shuffle / repeat save and restore | No-op | Optional Mac-only controller capability, not used on Windows. |
| Notifications | No-op | No Electron `Notification` or OS notification implementation; reminders use Ovra windows. |
| Tray / Dock | No-op | No tray on either platform. Mac has `activate`; Windows main-window close now quits through the existing shutdown handler instead of leaving an unreachable hidden app. Close routing is unit-tested. |
| Main-window title bar | Works | `hiddenInset` only on macOS; Windows uses the default frame and native buttons. Options are unit-tested. |
| Orb / move card flags | Unknown | Frameless, transparent orb, `skipTaskbar`, always-on-top, `showInactive()` and mouse forwarding are Electron APIs with Windows support; placement, DPI, focus and click-through need real checks. `floating` has no special Windows level semantics. |
| All workspaces / fullscreen visibility | No-op | Electron documents `setVisibleOnAllWorkspaces()` as doing nothing on Windows; no crash guard needed. No promise of appearing across Windows virtual desktops or exclusive fullscreen apps. |
| Camera permission prompts | Unknown | No direct Mac `systemPreferences` call. Electron session permission handlers enforce consent and video-only capture on both platforms; OS privacy permission and denial handling need Windows testing. Mac usage descriptions/entitlements are packaging-only. |
| SmartSpectra native runtime | Unknown | Windows x64 package is already a hard SDK dependency; explicitly unpacked beside its DLL/model closure. SDK resolves from `process.platform`/`process.arch`, so it never requires the Darwin package on Windows. Koffi's Windows x64 binding must also be shipped. Actual DLL load / Vulkan / GPU support needs Windows. |
| Session / moves / privacy / history | Works | Cross-platform TypeScript logic and mocked unit tests. Windows filesystem behavior and whole sessions remain unverified. |
| Private file permissions | No-op | `restrictPermissions()` already skips POSIX mode enforcement on Windows. Windows profile ACLs apply; no Unix `chmod` assumption. |
| SDK cache deletion | Works | Existing Windows-specific path is handled alongside macOS and has a unit test; actual Windows deletion still needs a check. |
| Quit lifecycle | Works | Existing `window-all-closed` quits off macOS; Windows close requests `app.quit()` and uses the existing awaited sensing/session shutdown. |

Electron's [BrowserWindow reference](https://www.electronjs.org/docs/latest/api/browser-window#winsetvisibleonallworkspacesvisible-options)
documents the workspace no-op and cross-platform mouse forwarding. Its current
mouse-forwarding documentation also notes that an elevated foreground app can
temporarily prevent forwarding to a normal-privilege orb.

SMTC does not expose Spotify track IDs. Ovra builds URL-encoded
`spotify:local:<artist>:<title>` IDs, resolves known songs against the local
catalog and falls back to playlists for playback. Likely ads have an empty or
`Spotify` artist. Verify ad metadata and URI playback on both Free and Premium;
Free accounts may not start playing automatically after a URI opens.

## Build

`npm run build:win` compiles the app and builds only an x64 NSIS installer,
`dist/Ovra-Setup-1.0.0.exe`. `win.files` allows only compiled `out` files (plus
electron-builder's automatic production dependencies) and excludes Darwin and Linux SmartSpectra
payloads from Windows packaging. The existing SDK manifest and lockfile already
include `@smartspectra/node-sdk-win32-x64`; no dependency was added.

The installed electron-builder 26.18.0 edits PE resources (icon and version) using
JavaScript `resedit`, so disabling resource editing is unnecessary.
`signExecutable: false` skips signing while keeping Ovra's icon. Its macOS NSIS path extracts the
uninstaller using `UninstallerReader`, without executing the installer with Wine.
No system software was installed. This uses the existing locked build tooling.

## Daniel's Windows checks

1. Install, launch via both shortcuts, check the icon, then uninstall and reinstall.
2. Decline the camera and run a short session: orb, move card, end, history and deletion.
3. Close the main window: Ovra should quit, stop sensing and leave no hidden app.
4. Consent to the camera; check OS denial, calibration, continuous and check-in modes,
   pause/resume, a break/return and quit. Confirm the camera stops when expected.
5. With Spotify already open, check track/artist display, playlist start, pause/resume,
   next, ads, switching and learning. Also check Spotify closed and PowerShell/SMTC
   unavailable. Volume, shuffle/repeat control and refocus are unavailable.
6. Check multiple displays, Windows scaling, taskbar, orb drag, hover/click-through,
   fullscreen applications and elevated foreground windows.
7. Verify local data-folder opening, deletion and SDK-cache cleanup on Windows.

## Workarounds for the post

- Node sets the six development mode variables before loading the existing
  electron-vite CLI. This avoids shell-specific assignments and an extra dependency,
  while preserving CLI arguments; tests use `--help`, never sensing or Spotify.
- Keep PE icon editing enabled and skip signing only: the locked builder already
  offers a JavaScript resource editor and a Mac uninstaller extractor, so Wine
  and system-software installation are unnecessary.
- Strip the other SmartSpectra platform payloads from the Windows app and unpack
  the Windows closure, so dynamic package/DLL lookup can find real files without
  carrying the Mac and Linux runtimes.
- Platform `files` rules replace shared exclusions. Use a positive Windows `out/**`
  allowlist, so `.env`, source files and unrelated repository files cannot enter
  the app; archive inspection caught this before handoff.
- Windows main-window close quits through the existing shutdown handler: there is
  no Dock or tray to recover a hidden main window. Mac close-to-hide stays intact.

The coordinator records these decisions in the shared decision/reliability logs.

## Verified build — 2026-11-20

- Branch: `surrelsaga/ovra-winexe`, rebased on main after Job 27 merged.
- Installer: `/Users/nguyenducanh/orca/workspaces/ovra/ovra-winexe/dist/ovra-1.0.0-setup.exe`.
- Size: **284,520,205 bytes (271.34 MiB)**.
- SHA-256: `761580cd8fe0a480e45ec5d3277376b1be3b266ecfb1b30efbf6e6486a1a8005`.
- `npm run build:win` passed on macOS: typecheck, production build and unsigned
  x64 NSIS packaging, with no Wine or system-software installation.
- `npm run lint` passed; `npm test`: **62 files, 884 tests passed**.
- PE inspection: the app is x64; every icon image in both the app and installer
  matches Job 27's `build/icon.ico`.
- ASAR inspection: bundled Presage constant found; optional service keys absent;
  no `.env`, source or test-media files; no Darwin/Linux SDK payloads. The Windows
  SDK manifest, DLL/runtime closure and Koffi x64 binding are present and unpacked.
- Changed files: `package.json`, `electron-builder.yml`, `scripts/dev.mjs`,
  `src/main/dev-launcher.test.ts`, `src/main/windows/index.ts`,
  `src/main/windows/platform.test.ts`, `src/main/music/controller/windows.test.ts`,
  `README.md`, `docs/windows.md`.

No live camera, SDK harness or real Spotify test was run. No Windows execution
was possible. The remaining questions are the Windows checks above, especially
native SDK loading/camera access and PowerShell SMTC behavior. The installer
contains the private Presage key and is for trusted friends only.

## Multiple cameras (Job 34)

Pick the webcam in Settings → Camera, or use Switch camera while getting in view or after Try again.
This avoids a phone, Continuity Camera or virtual camera becoming the system default. If the chosen
camera is unplugged, Ovra uses the default and tells you once. On Windows, close OBS or another app
holding the webcam if it cannot open; a busy camera is different from an unplugged one.
