<p align="center">
  <img src="build/icon.png" width="128" alt="Ovra icon">
</p>

<h1 align="center">Ovra</h1>

<p align="center">
Ovra reads your heart rate and breathing through your camera, then changes your Spotify music
to fit how you feel. It also reminds you to stretch or take a walk when you've sat too long.
</p>

## Tech stack

- **Electron**: runs Ovra as a desktop app on Mac and Windows
- **TypeScript + React**: the app's code and screens
- **Vite (electron-vite)**: builds and runs the app while developing
- **Presage SmartSpectra SDK**: reads heart rate, breathing and face from the camera
- **Spotify desktop app**: plays your music; Ovra controls it (AppleScript on Mac, PowerShell on Windows)
- **Last.fm**: song tags, to know if a song is calm or upbeat
- **OpenRouter**: AI guess of a song's mood when Last.fm isn't enough
- **Vitest**: tests
- **electron-builder**: makes the .dmg and .exe files

## Get Ovra

### Recommended: download the app

The downloaded app has everything set up, no keys needed.
Go to [Releases](https://github.com/surrelsaga/ovra/releases/latest):

- **Mac (Apple Silicon, macOS 13+):** `ovra-1.0.0.dmg`. Open it and drag Ovra to Applications.
  The app isn't signed by Apple, so macOS may say it "can't be opened". Fix it once by running
  this in Terminal, then open Ovra as usual:

  ```sh
  xattr -cr /Applications/Ovra.app
  ```
- **Windows:** `ovra-1.0.0-setup.exe`. If Windows warns you, click More info, then Run anyway.
  Windows is built but not tested yet.

You need the Spotify desktop app open.

### Or run it yourself

You need Node.js 22+ and your own API keys (all have free options):

| Key | What it does | Get it |
|---|---|---|
| `PRESAGE_API_KEY` | **Required.** Reads your heart rate and breathing | [physiology.presagetech.com](https://physiology.presagetech.com) |
| `LASTFM_API_KEY` | Knows if a song is calm or upbeat | [last.fm/api](https://www.last.fm/api/account/create) |
| `OPENROUTER_API_KEY` | AI guess of a song's mood when Last.fm isn't enough | [openrouter.ai/keys](https://openrouter.ai/keys) |

Ovra works with only the Presage key, but the music fits your mood much better with all three.

1. Get the code:

   ```sh
   git clone https://github.com/surrelsaga/ovra.git
   cd ovra
   npm install
   ```

2. Copy `.env.example` to `.env` and paste your keys.
3. Run it:

   ```sh
   npm run dev
   ```

   Or make your own app file: `npm run build:mac` (Mac) or `npm run build:win` (Windows).

## License

MIT
