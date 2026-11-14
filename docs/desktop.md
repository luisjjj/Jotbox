# JotBox desktop

The desktop app is a thin Electron shell around the live JotBox web app. It loads the same deployed site, so sign in, sync, notes, billing, and the library stay identical. What it adds is the island: a transparent, always-on-top window at the top of the screen that expands when you hover it.

Windows is the first target. The installer is an NSIS setup in `apps/desktop/release`.

## What the shell does

- **Splash window** is a local, frameless card shown while the web app starts. It closes when the sign-in screen reports that the session check finished, with a 10 second fallback.
- **Main window** opens `https://jotbox-eight.vercel.app/auth` (or `JOTBOX_DESKTOP_URL`), never the marketing site. Signed-in users are redirected to `/app`. Closing it hides it to the tray; the capture keeps running.
- **Desktop sign-in** replaces the web marketing layout with a compact card, the app version, and the same fields. None of the landing page links appear inside the shell, because the root route redirects to `/app`.
- **Island window** loads `/island` in a frameless, transparent, non-focusable window above every other app. It ignores mouse clicks until the pointer is over the pill, so you can work underneath it.
- **State bridge** in `preload.cjs` publishes the engine state (`status`, `elapsed`, `title`, `interim`, the last two lines, the audio level) to the island and relays island commands back to the main window.
- **Tray** with Open JotBox, Start/Stop listening, and Quit.
- **Global shortcuts**: `Ctrl+Shift+J` opens JotBox, `Ctrl+Shift+L` starts or stops a microphone capture.
- **Call picker** lists windows and screens with thumbnails. Choosing a window returns it to `getDisplayMedia` with Windows loopback audio, mixed with the microphone by the existing engine.
- **Permissions** are granted only to the JotBox origin, for microphone, display capture, and notifications.

## The island

The window is `460x220` at the top center of the display that holds the main window. It sits at `screen-saver` level so it stays above normal windows and full-screen calls.

- Idle: the window is hidden.
- Recording or paused: the pill appears. Hover it to expand into the timer, the latest words, and the controls.
- Hovering calls `setInteractive(true)` so clicks land; leaving calls `setInteractive(false)` so the window goes back to click-through.
- Pause/Resume and Stop are sent over IPC; Open JotBox shows the main window.
- Processing: the island stays up and shows "Writing the notes" until the session is saved.

The preview route `?preview=1` (and `?open=1`) renders a fixed sample state without an engine. The smoke test uses it.

## Develop

Use the Vite dev server for the web app and point the shell at it:

```bash
npm run dev:web
npm run dev --workspace @jotbox/desktop
```

`--dev` loads `http://localhost:5173`. To point at another deployment:

```bash
JOTBOX_DESKTOP_URL=https://your-preview.vercel.app npm start --workspace @jotbox/desktop
```

The engine publishes its state from the main window, so the island only updates while the app is running and a session is active. The desktop app does not bundle the web app; deploy the web changes before shipping a new build.

## Smoke test

The smoke test loads the island in a hidden window, checks the expanded and collapsed states, drives the hover enter/leave handlers, then loads the splash and the desktop sign-in screen. It writes screenshots to `.shots/`:

- `desktop-island-open.png`
- `desktop-island-pill.png`
- `desktop-island-hover.png`
- `desktop-splash.png`
- `desktop-auth.png`
- `desktop-auth-narrow.png`

The shell window uses offscreen rendering so the sign-in card is painted even while the window is hidden, and the test checks a center pixel so an invisible card fails the run.

```bash
npm run build:web
npm run preview --workspace @jotbox/web -- --port 4173 --strictPort
npm run smoke --workspace @jotbox/desktop
```

Set `JOTBOX_SMOKE_URL` to test the deployed site instead of the local preview:

```bash
JOTBOX_SMOKE_URL=https://jotbox-eight.vercel.app npm run smoke --workspace @jotbox/desktop
```

Exit code 0 means the island rendered, the status was `recording`, the surface was transparent, the hover handlers toggled the expanded state, the splash card was present, the desktop sign-in card rendered at wide and narrow widths, and no horizontal overflow appeared at 380px.

## Build the installer

```bash
npm run dist --workspace @jotbox/desktop
```

This signs the app exe, the uninstaller, and the installer with a local self-signed certificate. The first run creates the certificate and writes these ignored files under `apps/desktop/signing/`:

- `jotbox-self-signed.pfx` (private key, never commit)
- `jotbox-self-signed.cer` (public certificate)
- `password.txt` (generated password for the pfx)

Output: `apps/desktop/release/JotBox-Setup-0.1.0.exe` (about 78 MB).

To create only the certificate:

```bash
npm run sign:cert --workspace @jotbox/desktop
```

To build without signing:

```bash
npm run dist:unsigned --workspace @jotbox/desktop
```

### What self-signing does and does not do

A self-signed certificate proves the files were not changed after signing, but Windows does not trust the root by default. Other PCs still show "Unknown publisher", and SmartScreen still warns. That is expected with a free certificate.

To trust it on this PC, import the public certificate into the current user's root store:

```powershell
Import-Certificate `
  -FilePath "apps\desktop\signing\jotbox-self-signed.cer" `
  -CertStoreLocation Cert:\CurrentUser\Root
```

After that, `Get-AuthenticodeSignature` reports `Valid` on this machine. Remove it later with `Remove-Item Cert:\CurrentUser\Root\<thumbprint>`.

A publicly trusted certificate (Azure Trusted Signing, or an OV/EV certificate from a CA) is still needed before other people see a verified publisher.

`npmRebuild` is off because the app has no native dependencies. This also avoids npm pruning the workspace's dev dependencies during packaging.

### If winCodeSign will not extract

`electron-builder` downloads `winCodeSign`, which contains macOS symlinks. Windows accounts without Developer Mode (or admin) cannot create symlinks, and extraction fails with `A required privilege is not held by the client`.

Either enable **Settings > System > For developers > Developer Mode**, or seed the cache once by extracting the archive without the `darwin` folder:

```bash
node_modules/7zip-bin/win/x64/7za.exe x \
  "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<id>.7z" \
  -o"%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0" \
  -xr'!darwin' -y
```

Then run the build again.
