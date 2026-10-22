// NAME: TalkToDJX
// DESCRIPTION: Send text requests to the real Spotify DJ from desktop.
// VERSION: 1.3.4
// No API key, external AI service, or background server required.
(function talkToDJ() {
  "use strict";

  const VERSION = "1.3.4";
  const DJ_URI = "spotify:playlist:37i9dQZF1EYkqdzj48dyYq";
  const DJ_IDS = new Set([
    "37i9dQZF1EYkqdzj48dyYq", "37i9dQZF1EYkqdzj8OSOas", "37i9dQZF1EYkqdzjdvy3mw",
    "37i9dQZF1EYkqdzjicdiyA", "37i9dQZF1EYkqdzjmSSxKE", "37i9dQZF1EYkqdzjrzxMWI",
  ]);
  const MAX_PROMPT = 500;
  const ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 10v4m4-8v12m4-15v18m4-13v8m4-6v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';

  class DJError extends Error {
    constructor(message, code = "request_failed") {
      super(message);
      this.name = "DJError";
      this.code = code;
    }
  }

  function normalizePrompt(value) {
    const prompt = String(value ?? "").trim();
    if (!prompt) throw new DJError("Tell DJ what you would like to hear first.", "empty_prompt");
    if (prompt.length > MAX_PROMPT) throw new DJError(`Keep your request under ${MAX_PROMPT + 1} characters.`, "long_prompt");
    return prompt;
  }

  function isDJ(state) {
    const context = state?.context;
    return context?.metadata?.lexicon_set_type === "your_dj"
      || DJ_IDS.has(context?.uri?.replace("spotify:playlist:", ""))
      || context?.uri === "spotify:lexicon:your-dj";
  }

  function encodeVarint(value) {
    const bytes = [];
    do {
      bytes.push((value & 127) | (value > 127 ? 128 : 0));
      value >>>= 7;
    } while (value);
    return bytes;
  }

  function encodeText(field, value) {
    const bytes = new TextEncoder().encode(value || "");
    return [...encodeVarint(field * 8 + 2), ...encodeVarint(bytes.length), ...bytes];
  }

  // Spotify Android 9.1.84: PromptSignalPayload.user_prompt = 1, input_type = 2.
  // The native "prompt" command expects base64 protobuf, not JSON or a bare prompt.
  function encodePromptSignal(value) {
    const bytes = [...encodeText(1, normalizePrompt(value)), 16, 2]; // TEXT = 2.
    return btoa(String.fromCharCode(...bytes));
  }

  function interactiveRequestIds(state) {
    return new Set([state?.item, ...(state?.nextItems || [])]
      .map((item) => item?.metadata?.idj_request_id).filter(Boolean));
  }

  function readableError(error) {
    if (error instanceof DJError) return error;
    return new DJError("Spotify could not send the DJ command. Check playback and reapply Spicetify if Spotify just updated.", "native_command");
  }

  function createClient(spicetify) {
    const player = spicetify.Platform.PlayerAPI;
    const origin = { featureIdentifier: "endless", referrerIdentifier: "extension" };
    let requests = Promise.resolve();
    let epoch = 0;
    const sleep = () => new Promise((resolve) => setTimeout(resolve, 250));

    async function waitFor(predicate, message, code, ticket = epoch) {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (ticket !== epoch) throw new DJError("DJ request cancelled.", "cancelled");
        const result = predicate(player.getState());
        if (result) return result;
        await sleep();
      }
      throw new DJError(message, code);
    }

    async function sendPrompt(prompt, ticket) {
      const parameters = encodePromptSignal(prompt);
      if (isDJ(player.getState()) && player.canSendSignal("prompt")) {
        await player.sendSignal("prompt", parameters);
        return;
      }
      // The phone starts DJ with this raw signal when DJ is not active, including
      // during queued music. Starting ordinary DJ first would lose the prompt.
      const nativePlay = player._playlistPlayServiceClient;
      if (typeof nativePlay?.play === "function") {
        const reply = await nativePlay.play({
          context: { uri: DJ_URI, url: `context://${DJ_URI}`, isLoading: true },
          rawSignal: { identifier: "prompt", clientPayload: new TextEncoder().encode(parameters) },
          playOrigin: origin,
        });
        if (reply?.status?.statusCode !== 200) {
          throw new DJError("Spotify did not accept the DJ request. Check that DJ is available for this account.", "rejected");
        }
        return;
      }
      // Older Spicetify builds may expose only the public Player API.
      await player.play({ uri: DJ_URI }, origin, {});
      await waitFor((state) => isDJ(state) && player.canSendSignal("prompt"),
        "DJ requests are not ready. Start DJ from Spotify's Music tab and try again.", "missing_session", ticket);
      await player.sendSignal("prompt", parameters);
    }

    async function request(value, onProgress = () => {}) {
      const prompt = normalizePrompt(value);
      const ticket = epoch;
      const run = async () => {
        if (ticket !== epoch) throw new DJError("DJ request cancelled.", "cancelled");
        const before = interactiveRequestIds(player.getState());
        onProgress("DJ is picking music for you…");
        await sendPrompt(prompt, ticket);
        const requestId = await waitFor((state) => {
          if (!isDJ(state)) return false;
          return [...interactiveRequestIds(state)].find((id) => !before.has(id));
        }, "Spotify did not apply your DJ request. Check the music before trying again.", "not_applied", ticket);
        return { prompt, requestId };
      };
      // Match the phone's one-interaction-at-a-time behavior without locking the
      // panel. A second prompt can be entered while Spotify prepares the first.
      const result = requests.then(run).catch((error) => { throw readableError(error); });
      requests = result.catch(() => {});
      return result;
    }

    async function letDJPick() {
      epoch++;
      try {
        if (!isDJ(player.getState())) {
          await player.play({ uri: DJ_URI }, origin, {});
          await waitFor((state) => isDJ(state) && player.canSendSignal("jump"),
            "DJ is still loading. Try again in a moment.", "missing_session");
        }
        if (!player.canSendSignal("jump")) throw new DJError("DJ is still loading. Try again in a moment.", "missing_session");
        await player.sendSignal("jump");
      } catch (error) {
        throw readableError(error);
      }
    }
    return { request, letDJPick };
  }

  // A test seam for the request protocol; this branch never runs inside Spotify.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createClient, encodePromptSignal, normalizePrompt, isDJ, DJError };
    return;
  }

  function boot() {
    const sp = window.Spicetify;
    if (!sp?.Platform?.PlayerAPI?.getState || !sp.Platform.PlayerAPI.canSendSignal || !sp.Platform.PlayerAPI.sendSignal
      || !sp.PopupModal || !document.body) {
      setTimeout(boot, 500);
      return;
    }
    if (window.TalkToDJX || window.TalkToDJ) return;

    const client = createClient(sp);
    const state = { draft: "", pending: 0, lastError: null, lastRequestId: null };
    let view;

    const style = document.createElement("style");
    style.id = "talk-to-dj-style";
    style.textContent = `
      .talk-to-dj-modal { border-radius: 12px; overflow: hidden; background: #181818; color: #fff; box-shadow: 0 16px 64px #0009; }
      .talk-to-dj-modal .spicetify-popup-container { width: min(440px, calc(100vw - 32px)); max-width: none; background: #181818;
        max-height: calc(100vh - 48px); overflow-y: auto; border-radius: 12px; }
      .talk-to-dj-modal .spicetify-popup-header { padding: 20px 24px 8px; background: transparent; border: 0; }
      .talk-to-dj-modal .spicetify-popup-title { font-size: 13px; line-height: 24px; font-weight: 500; color: #b3b3b3; }
      .talk-to-dj-modal .spicetify-popup-closeBtn { width: 28px; height: 28px; background: transparent; color: #b3b3b3; }
      .talk-to-dj-modal .spicetify-popup-closeBtn:hover { color: #fff; }
      .talk-to-dj-modal .spicetify-popup-closeBtn svg { width: 16px; height: 16px; }
      .talk-to-dj-modal .spicetify-popup-content { padding: 0; }
      .ttdj { color: #fff; padding: 8px 24px 24px; font-family: inherit; font-weight: 400; }
      .ttdj * { box-sizing: border-box; }
      .ttdj-intro { margin-bottom: 16px; }
      .ttdj-intro h2 { font-size: 26px; line-height: 1.2; letter-spacing: -.8px; font-weight: 700; margin: 0; }
      .ttdj label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
      .ttdj textarea { display: block; resize: none; min-height: 132px; width: 100%; background: #242424; color: #fff;
        font: inherit; font-size: 15px; font-weight: 400; line-height: 1.55; padding: 16px; border-radius: 12px;
        border: 0 !important; outline: none !important; box-shadow: none !important; transition: background .15s; }
      .ttdj textarea:focus { background: #292929; }
      .ttdj textarea::placeholder { color: #a7a7a7; }
      .ttdj-suggestions { display: flex; flex-wrap: nowrap; gap: 6px;
        width: 100%; margin-top: 10px; padding: 2px 0; }
      .ttdj button { font: inherit; cursor: pointer; border: 0; }
      .ttdj-chip { flex: 1 1 auto; min-width: 0; white-space: nowrap; padding: 7px 6px; border-radius: 16px; background: #262626;
        color: #e7e7e7; font-size: 11px !important; font-weight: 500 !important; text-align: center;
        border: 1px solid #ffffff0d !important; line-height: 1.4; transition: background .15s, border-color .15s; }
      .ttdj-chip:hover { background: #343434; border-color: #ffffff26 !important; }
      .ttdj button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
      .ttdj-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; gap: 10px; margin-top: 16px; }
      .ttdj-send { display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: 24px;
        width: 100%; height: 44px; padding: 10px 18px; font-weight: 700 !important; font-size: 14px !important;
        color: #000; background: #1ed760; border: 1px solid #45e780 !important; transition: background .15s; }
      .ttdj-send:hover { background: #3be477; }
      .ttdj-pick { height: 44px; white-space: nowrap; background: transparent; color: #fff; padding: 10px 14px;
        border: 1px solid #ffffff50 !important; border-radius: 24px; font-size: 13px !important; font-weight: 600 !important;
        transition: background .15s, border-color .15s; }
      .ttdj-pick:hover { background: #ffffff08; border-color: #ffffffa6 !important; }
      #ttdj-topbar-container { display: flex; align-items: center; flex-shrink: 0; margin: 0 8px; }
      #talk-to-dj-topbar { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px;
        border: 0; border-radius: 50%; color: #1ed7bc; background: #ffffff0d; cursor: pointer; -webkit-app-region: no-drag; }
      #talk-to-dj-topbar:hover { background: #ffffff20; }
      #talk-to-dj-topbar:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      /* Keep the player free of DJ shortcuts, including Spotify's native one.
         Match semantic IDs/icon geometry rather than version-specific CSS hashes. */
      .main-nowPlayingBar-extraControls button:is([data-testid="dj-button"], [data-testid="dj-jump-button"],
        :has(svg path[d^="M7.813 14.497"])) { display: none !important; }
      @media (prefers-reduced-motion: reduce) { .ttdj textarea, .ttdj button { transition: none; } }
    `;
    document.head.append(style);

    function setDraft(prompt) {
      state.draft = prompt;
      if (view?.root.isConnected) {
        view.input.value = prompt;
        view.input.focus();
      }
    }

    function close() {
      const current = view;
      if (!current) return;
      view = undefined;
      current.dismiss.abort();
      if (current.root.isConnected) sp.PopupModal.hide();
    }

    function dispatch(action) {
      state.pending++;
      state.lastError = null;
      state.lastRequestId = null;
      // Native DJ preparation stays in the background so the panel stays usable.
      Promise.resolve().then(action).then((result) => {
        if (result?.requestId) state.lastRequestId = result.requestId;
      }).catch((error) => {
        const failure = readableError(error);
        if (failure.code === "cancelled") return;
        state.lastError = failure.code;
        sp.showNotification?.(failure.message, true);
      }).finally(() => { state.pending--; });
    }

    function submit() {
      if (!view?.root.isConnected) return;
      let prompt;
      try { prompt = normalizePrompt(view.input.value); } catch {
        view.input.focus();
        return;
      }
      state.draft = "";
      close();
      dispatch(() => client.request(prompt));
    }

    function pick() {
      if (!view?.root.isConnected) return;
      state.draft = "";
      close();
      dispatch(() => client.letDJPick());
    }

    function open() {
      if (view?.root.isConnected) { view.input.focus(); return; }
      view?.dismiss.abort();
      const root = document.createElement("section");
      root.className = "ttdj";
      root.innerHTML = `
        <div class="ttdj-intro"><h2>Tell ’em what you want:</h2></div>
        <form class="ttdj-form">
          <label for="ttdj-prompt">Your music request</label>
          <textarea id="ttdj-prompt" rows="4" maxlength="${MAX_PROMPT}" placeholder="Ask for music you're in the mood for…"></textarea>
          <div class="ttdj-suggestions" aria-label="Try a request"></div>
          <div class="ttdj-actions"><button type="submit" class="ttdj-send">Send</button><button type="button" class="ttdj-pick">Hand it to DJ X</button></div>
        </form>
      `;
      view = {
        root, input: root.querySelector("textarea"), send: root.querySelector(".ttdj-send"),
        pick: root.querySelector(".ttdj-pick"), suggestions: root.querySelector(".ttdj-suggestions"),
        dismiss: new AbortController(),
      };
      for (const [label, prompt] of [
        ["Something mellow", "Play mellow music to help me unwind."],
        ["More energy", "Play upbeat music for a workout, with some of my favorites."],
        ["Something new", "Introduce me to artists I have not heard before, based on my taste."],
        ["A little nostalgia", "Play a mix of nostalgic 90s and 2000s favorites."],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ttdj-chip";
        button.textContent = label;
        button.addEventListener("click", () => setDraft(prompt));
        view.suggestions.append(button);
      }
      view.input.value = state.draft;
      view.input.addEventListener("input", (event) => {
        state.draft = event.target.value;
      });
      view.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          submit();
        }
      });
      root.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); if (root.isConnected) submit(); });
      view.pick.addEventListener("click", () => { if (root.isConnected) pick(); });
      sp.PopupModal.display({ title: "TalkToDJX", content: root });
      const modal = root.closest(".GenericModal");
      modal?.classList.add("talk-to-dj-modal");
      const options = { capture: true, signal: view.dismiss.signal };
      document.addEventListener("click", (event) => {
        if (root.isConnected && modal && !modal.contains(event.target)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          close();
        }
      }, options);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && root.isConnected) {
          event.preventDefault();
          event.stopImmediatePropagation();
          close();
        }
      }, options);
      modal?.querySelector(".spicetify-popup-closeBtn")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      });
      setTimeout(() => { if (root.isConnected) root.querySelector("textarea").focus(); }, 50);
    }

    let topbar;
    if (sp.Topbar?.Button) {
      try { topbar = new sp.Topbar.Button("TalkToDJX (Ctrl + Alt + D)", ICON, open); }
      catch { /* Use the DOM fallback if Spicetify's mount point changed. */ }
    }
    if (!topbar) {
      const element = document.createElement("div");
      const button = document.createElement("button");
      button.type = "button";
      button.title = "TalkToDJX (Ctrl + Alt + D)";
      button.setAttribute("aria-label", "TalkToDJX (Ctrl + Alt + D)");
      button.innerHTML = ICON;
      button.addEventListener("click", open);
      element.append(button);
      topbar = { element, button };
    }
    topbar.element.id = "ttdj-topbar-container";
    topbar.button.id = "talk-to-dj-topbar";
    topbar.button.setAttribute("aria-haspopup", "dialog");
    function mountButton() {
      if (!topbar.element.isConnected) {
        const left = document.querySelector('.main-globalNav-historyButtonsWrapper > div, .main-topBar-topbarContentLeft')
          || document.getElementById("global-nav-bar")?.firstElementChild;
        left?.append(topbar.element);
      }
    }
    let mountScheduled = false;
    new MutationObserver(() => {
      if (mountScheduled) return;
      mountScheduled = true;
      // Spotify suspends animation frames while hidden; transitions still need updating.
      queueMicrotask(() => { mountScheduled = false; mountButton(); });
    }).observe(document.body, { childList: true, subtree: true });
    mountButton();
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.altKey && event.code === "KeyD" && !event.repeat) {
        event.preventDefault();
        open();
      }
    });
    window.TalkToDJX = Object.freeze({ version: VERSION, open, close, getStatus: () => ({ pending: state.pending, lastError: state.lastError, lastRequestId: state.lastRequestId }) });
    window.TalkToDJ = window.TalkToDJX; // Keep existing local development tools compatible.
    console.info(`[TalkToDJX] ${VERSION} loaded`);
  }
  boot();
})();
