# macOS packaging

Build the Apple Silicon app and disk image on a Mac with:

```sh
npm ci
npm run build:mac
```

The unsigned `Ovra.app` and `.dmg` are written to `dist/`. The build contains
only the arm64 target. Presage's `node-sdk-darwin-arm64` dependency is excluded
from ASAR so the SDK's `require.resolve()` lookup can find its package and load
the native library closure from `app.asar.unpacked/node_modules`. The app does
not bundle `.env` files.

For API keys, create `~/Library/Application Support/Ovra/.env` with entries
such as `PRESAGE_API_KEY=...`, `OPENROUTER_API_KEY=...`, and
`LASTFM_API_KEY=...`. During development, the repository `.env` takes
precedence when present. `OVRA_ENV_PATH` overrides either location. Keys are
loaded locally and are never logged.

Because this build is unsigned, macOS may block its first launch. Control-click
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
