# TalkToDJX

Send a text prompt to **the real Spotify DJ X** from Spotify desktop. Describe the music you want, and Spotify picks the tracks and supplies its own DJ narration.

![TalkToDJX request panel preview](preview.svg)

**Spicetify extension · Version 1.3.4 · GitHub repository: SpicetifyTalkToDJX**

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

1. Download [`talk-to-dj.js` from the v1.3.4 release](https://github.com/NotMurPh/SpicetifyTalkToDJX/releases/download/v1.3.4/talk-to-dj.js).
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

The extension follows Spotify Android's native text-request flow. It encodes `PromptSignalPayload` as protobuf, then base64:

```protobuf
string user_prompt = 1;
PromptInputType input_type = 2; // PROMPT_INPUT_TYPE_TEXT = 2
```

When DJ is active and accepts requests, the extension sends `PlayerAPI.sendSignal("prompt", parameters)`. When DJ needs to start, it passes the same payload as a native Playlist Play `rawSignal`, so Spotify starts DJ with the prompt already attached. A public Player API fallback handles older Spicetify builds that do not expose the native play client.

Spotify handles the acknowledgement, DJ narration, recommendations, and playback inside its own interactive DJ session. The extension does not fetch or synthesize speech, edit the playback queue, or use a local helper.

The panel closes immediately on submission and stays available while Spotify works. Background requests are sent in order, matching the phone's one-interaction-at-a-time behavior. A request is considered applied only after a **fresh `idj_request_id`** appears in Spotify's native current or upcoming DJ tracks. A changed song, changed playback session, or accepted command alone is insufficient. Failed commands produce a normal Spotify notification; the panel has no loading or status display. Playback-changing commands are never retried automatically.

Versions before 1.3.4 used a legacy HTTP route that could return `OK / no response` and restart ordinary DJ with unrelated music. Version 1.3.4 removes that route and its manual session/device request fields.

Spotify's internal APIs can change. `TalkToDJX.getStatus()` in developer tools reports outstanding background requests, the latest error code, and the last verified native request ID. `TalkToDJ` remains available as a compatibility alias for existing development tools.

## Verification

```powershell
node --check talk-to-dj.js
node --check install.mjs
node --check tools/repair.mjs
node --test tests/talk-to-dj.test.cjs tests/compat.test.mjs tests/repair.test.mjs tests/startup.test.cjs
```

Live development tools in `tools/` can inspect a local Spotify instance started with `--remote-debugging-port=9222`. They are not required for normal use. `tools/cdp.mjs` evaluates JavaScript in that local instance; do not pass authentication tokens to its output.

The automated checks cover the phone's native prompt wire format, Unicode, atomic DJ startup, ordered background commands, fresh interactive-request verification, update recovery, and startup without React or a working Topbar API. GitHub Actions runs them on Windows and Linux with Node.js 22 and 24.

Live verification checks the top-left-only shortcut, the request panel, Spotify's native spoken acknowledgement, and the actual requested set's native introduction and request ID:

```powershell
node tools/check-live.mjs --prompt "new metals that im recently into"
```

Version 1.3.4 was tested locally with Spotify **1.3.6.1921** and Spicetify **2.46.2**, using the text-request flow traced from Spotify Android **9.1.84.2205**. For the prompt above, Spotify acknowledged “New metal bands you're into lately. Let me spin some of that,” introduced a matching metal set, and played **Virgin Black — Our Wings Are Burning**. Native DJ startup with an attached prompt was also verified with **Accept — Samson and Delilah**. These checks verify matching native narration and interactive playback, rather than HTTP success alone.

## Marketplace publishing

The public **SpicetifyTalkToDJX** GitHub repository contains a root `manifest.json` with the listing name **TalkToDJX**, this README, a preview image, and the standalone extension. The repository's `spicetify-extensions` topic makes it discoverable by Marketplace. Marketplace uses the `main` branch for this listing.
