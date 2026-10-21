# TalkToDJX

Send a text prompt to **the real Spotify DJ X** from Spotify desktop. Describe the music you want, and Spotify picks the tracks and supplies its own DJ narration.

![TalkToDJX request panel preview](preview.svg)

**Spicetify extension · Version 1.3.3 · GitHub repository: SpicetifyTalkToDJX**

## Install from Spicetify Marketplace

1. Open **Marketplace** in your Spicetify-enabled Spotify desktop app.
2. Select **Extensions** and search for **TalkToDJX**.
3. Click **Install**, then reload Spotify when prompted.

### If it is missing in Marketplace 1.0.11

Marketplace **1.0.11** searches only the extension cards it has already loaded. Its sorting options, including **Newest**, do not change which repositories it fetches from GitHub, so a valid new listing can be missing from the initial results.

1. Select **Extensions** and clear the search box.
2. Scroll to the bottom and click **» Load more**. Wait for the next batch, then repeat to load additional extension pages.
3. Search for **TalkToDJX** after loading the additional pages.

If loading stalls or the listing is still missing, use the standalone-file installation below. Marketplace 1.0.11 can also stop loading when its temporary repository cache fills up or GitHub limits its API requests. The standalone extension does not depend on Marketplace discovery.

DJ requests require Spotify Premium and an account/region where Spotify has enabled this feature. Installing the extension does not enable DJ for unsupported accounts.

## Use it

- Click the **waveform button at the top left**, or press **Ctrl + Alt + D**.
- Describe what you want: a mood, an artist, a genre, an activity, or a mix of favorites and discoveries.
- Click **Send**, or press **Ctrl + Enter**. The panel closes immediately, and DJ handles the request in the background. DJ starts automatically if you are listening to something else.
- **Hand it to DJ X** closes the panel and lets DJ change the set without a prompt.
- All four smaller suggestion cards fit in one non-scrollable row directly below the input.
- **Send** and **Hand it to DJ X** have equal widths and together span the input box's width.
- Click outside the panel or press **Escape** to close it. An unsent draft stays available until you submit or restart Spotify.
- The top-left waveform is the only TalkToDJX shortcut button. The bottom DJ button is hidden during both narration and music; there is no replacement player button or profile-menu entry.

Example: “Play some mellow jazz for a relaxed evening.”

Windows voice typing (**Win + H**) can dictate into the prompt box. The extension submits text; Spotify's mobile microphone interface is not embedded here.

## Requirements

- Spotify desktop with Spicetify installed and its APIs exposed.
- A Spotify Premium account with DJ requests available in its region.
- A connected playback device that supports DJ narration. This computer is supported.

No API key, separate account login, AI subscription, or background server is needed. Your existing Spotify session handles authentication. Prompts go directly to Spotify. The extension no longer records recent requests; unsent drafts are held only in memory.

## Manual install / update

### Standalone file — no Node.js required

1. Download [`talk-to-dj.js` from the v1.3.3 release](https://github.com/NotMurPh/SpicetifyTalkToDJX/releases/download/v1.3.3/talk-to-dj.js).
2. Run `spicetify -c` in a terminal to locate your Spicetify configuration file.
3. Open the folder containing that configuration file, then its `Extensions` folder. Create `Extensions` if it does not exist.
4. Place the downloaded file there, keeping its name **`talk-to-dj.js`**.
5. Run:

```powershell
spicetify config extensions talk-to-dj.js
spicetify apply
```

Spotify restarts with TalkToDJX enabled. To update, replace the same file with a newer release and run `spicetify apply` again.

### Node.js installer

Download and extract [this repository](https://github.com/NotMurPh/SpicetifyTalkToDJX) using **Code → Download ZIP** on GitHub, or clone it. Open a terminal in the extracted folder and run, with Node.js installed:

```powershell
node install.mjs
```

The installer copies `talk-to-dj.js` into your Spicetify `Extensions` folder, adds it to your existing extension list, and runs `spicetify apply`. If Spotify's version no longer matches Spicetify's backup, it automatically runs `spicetify backup apply` instead. Spotify restarts. Warnings that exit without applying are treated as failures rather than successful installs.

The extension is a standalone JavaScript file; Node.js is only needed for the installer and development tools. Its filename remains `talk-to-dj.js`, so existing manual installations can be updated in place.

For Spicetify **2.45.3**, it also installs two small React startup compatibility patches in the config's `[Patch]` section. These prevent Marketplace's navigation from rendering before Spicetify exposes React on Spotify 1.3.3 / 1.3.4. The patches use the native React exports and remain available after uninstalling the extension, because Marketplace also needs them. A config backup is saved before the installer changes those patches.

To apply without restarting immediately:

```powershell
node install.mjs --no-restart
```

Uninstall:

For a Marketplace installation, use **Marketplace → Installed → TalkToDJX → Remove** and reload Spotify. For a Node.js installer installation:

```powershell
node install.mjs --uninstall
```

For a standalone-file installation:

```powershell
spicetify config extensions talk-to-dj.js-
spicetify apply
```

You can then remove `talk-to-dj.js` from the `Extensions` folder.

### Stay working after Spotify updates (Windows)

With Node.js installed, run once from this repository:

```powershell
node install.mjs --auto-repair
```

This registers a per-user Windows task named **TalkToDJX Update Repair**. Every five minutes while you are signed in, it checks Spotify's installed version against Spicetify's backup and checks that the extension is injected. A healthy installation is left idle. When needed, it rebuilds the backup and reapplies your existing Spicetify setup, restarting Spotify if it is running. It does not open Spotify when it is closed.

The helper is copied to `TalkToDJX/repair.mjs` beside your Spicetify configuration, so moving or deleting this repository does not break the task. Node.js and Spicetify must remain installed at their registered paths. Repair results and errors are recorded in `TalkToDJX/repair.log`. Uninstalling through the installer removes the task; it also stays idle if `talk-to-dj.js` is no longer enabled.

Disable the task without uninstalling the extension:

```powershell
node install.mjs --disable-auto-repair --no-restart
```

For manual/Marketplace installs without this task, recover after a Spotify update with:

```powershell
spicetify backup apply
```

If a future Spotify build is incompatible with Spicetify itself, update Spicetify first (`spicetify upgrade`), then reapply. Automatic repair restores injection; it cannot guarantee compatibility with future changes to Spotify's internal DJ API.

## How it works

The extension uses Spotify's authenticated `Platform.RequestBuilder` to call:

```text
POST /dj-interaction-manager/spotify.dj.interactionmanager.v0.DJInteractionManagerService/ResolveInteractiveContext
```

The protobuf request uses the Android app's field numbers: prompt (1), current playback session ID (2), active Connect device ID (3), segment ID (4), retries left (5), submission reason (6), track URI (7), and input type (8). Text input is enum value `2`; the default submission reason is request prompt (`0`). Spotify updates the active device's DJ session itself.

The panel closes on submission without showing loading, success, or error messages. HTTP and protobuf replies are handled in the background for diagnostics. A delayed reply does not lock the panel or prevent another request; submitting uses the current DJ session. The extension does not automatically retry a request that may already be changing playback.

This is an internal Spotify API, so Spotify updates can change it. `TalkToDJX.getStatus()` in developer tools reports outstanding background requests and the latest error code without displaying them in the panel. `TalkToDJ` remains available as a compatibility alias for existing development tools.

## Verification

```powershell
node --check talk-to-dj.js
node --check install.mjs
node --check tools/repair.mjs
node --test tests/talk-to-dj.test.cjs tests/compat.test.mjs tests/repair.test.mjs tests/startup.test.cjs
```

Live development tools in `tools/` can inspect a local Spotify instance started with `--remote-debugging-port=9222`. They are not required for normal use. `tools/cdp.mjs` evaluates JavaScript in that local instance; do not pass authentication tokens to its output.

The automated checks cover request encoding, delayed replies, recovery from Spotify/backup version mismatches, and startup without React or a working Topbar API. GitHub Actions runs them on Windows and Linux with Node.js 22 and 24. Live checks in `tools/check-live.mjs` verify the top-left-only shortcut and the request panel against a running Spotify instance.

Version 1.3.3 was tested locally with Spotify **1.3.6.1921** and Spicetify **2.46.2**: a real DJ request completed successfully and changed the active DJ set. The scheduled repair task also completed successfully on a healthy installation.

## Marketplace publishing

The public **SpicetifyTalkToDJX** GitHub repository contains a root `manifest.json` with the listing name **TalkToDJX**, this README, a preview image, and the standalone extension. The repository's `spicetify-extensions` topic makes it discoverable by Marketplace. Marketplace uses the `main` branch for this listing.
