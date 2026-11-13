# Windows Spotify controller

Windows uses Spotify's System Media Transport Controls (SMTC) session to read the current title, artist, album, playback state, and timeline. Play opens a validated `spotify:` URI with the OS; free Spotify accounts may not start playback automatically from a URI. Pause, resume, and next use SMTC, with media-key fallback if the session API fails. Availability checks for an existing Spotify process and never launches Spotify. Per-app volume is not available here, so volume changes are a no-op and fades are unavailable.

SMTC does not expose Spotify track IDs. Ovra builds `spotify:local:<artist>:<title>` IDs with URL-encoded fields and marks likely ads when artist is empty or `Spotify`. Exact-track picks by id therefore do not work for these Windows songs; the selector falls back to playlists.

## Verify on a Windows PC

Build and launch Ovra with Spotify already running. Confirm the app detects it, reads the current track and position, and reports changes when playback moves to another song or pauses. Try a playlist URI on both free and premium accounts, check pause/resume/next, and confirm Spotify stays closed when it was not running before availability was checked. Also check ad metadata against a free-account ad; Windows behavior cannot be exercised by this macOS unit-test suite.
