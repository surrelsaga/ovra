# macOS packaging

Build the Apple Silicon app and disk image on a Mac with:

```sh
npm ci
npm run build:mac
```

The committed app icons come from the orb's pixel data and palette. To regenerate
them on macOS without adding dependencies, run `npx tsx build/generate-icons.ts`.

The ad-hoc signed `dist/mac-arm64/Ovra.app` and `dist/Ovra-1.0.0-arm64.dmg` are written to `dist/`. The build contains
only the arm64 target. Presage's `node-sdk-darwin-arm64` dependency is excluded
from ASAR. Before importing the SDK, the packaged app sets `SMARTSPECTRA_CAPI_PATH`
to the real library under `app.asar.unpacked/node_modules`: the SDK's own
`require.resolve()` returns a virtual `app.asar` path that `dlopen` cannot load.
An explicit `SMARTSPECTRA_CAPI_PATH` override is preserved. The app does
not bundle `.env` files. At build time, `PRESAGE_API_KEY`, `LASTFM_API_KEY` and `OPENROUTER_API_KEY` from
the local `.env` are embedded in the main bundle (decision 81). Missing `.env` is
allowed and produces a keyless build. The shared keys are recoverable from the
downloaded app; they are not hidden secrets. The OpenRouter key uses free models
only, capped at about 50 requests a day.

To override the shared key or add optional API keys, create `~/Library/Application Support/Ovra/.env` with entries
such as `PRESAGE_API_KEY=...`, `OPENROUTER_API_KEY=...`, and
`LASTFM_API_KEY=...`. During development, the repository `.env` takes
precedence when present. `OVRA_ENV_PATH` overrides either location. Keys are
loaded locally and are never logged. A user's key wins over a bundled key.

Because this build is not notarized, macOS may block its first launch. Control-click
or right-click `Ovra.app`, choose **Open**, then confirm the warning. The app
uses hardened runtime entitlements required by Electron and the SDK; the
packaged native libraries are ad-hoc signed by Presage. An Apple Developer
identity and notarization are not configured.

The SmartSpectra native runtime makes the installer substantially larger than
a typical Electron shell. The current build is about 634 MB as an app bundle
and 272 MB as a compressed DMG; check the produced artifact size in `dist/` for
each release. Windows and Intel Macs are not packaged.

The app declares two usage descriptions: camera access for wellness check-ins
during sessions the user starts (video is not saved), and Apple Events for
Spotify control during those sessions. It does not request microphone,
Documents, or Downloads access. Its hardened runtime entitlements allow
Electron's V8 JIT and unsigned executable memory and disable library validation
so the Presage SDK's bundled dylibs can load. The camera entitlement is present
on both the app and Electron renderer helper so hardened runtime permits the
renderer camera capture. Camera use still requires the user's consent and
macOS permission.
