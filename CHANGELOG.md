# Changelog

## 1.3.3

- Recover automatically during installation when a Spotify update invalidates Spicetify's backup; detect warnings that incorrectly look like successful installs.
- Add optional Windows scheduled repair (`node install.mjs --auto-repair`) to restore Spicetify after updates and restart Spotify only when a repair is needed.
- Keep only the top-left waveform shortcut and keyboard shortcut. Remove the bottom fallback button, native DJ-button interception, and profile-menu entry; hide the native bottom DJ shortcut.
- Initialize without waiting for React or the Player event API, and fall back to a plain top-left button if Spicetify's Topbar API is unavailable.
- Add update-recovery/startup regression tests and a Windows/Linux GitHub Actions verification matrix.

## 1.3.2

- Publish the extension as **TalkToDJX** in the **SpicetifyTalkToDJX** GitHub repository.
- Add a Spicetify Marketplace manifest, preview artwork, and installation instructions.
- Use TalkToDJX in the request panel, topbar shortcut, profile menu, and installer output.
- Expose `TalkToDJX` for developer tools while retaining the `TalkToDJ` compatibility alias.
