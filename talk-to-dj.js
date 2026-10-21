// NAME: TalkToDJX
// DESCRIPTION: Send text requests to the real Spotify DJ from desktop.
// VERSION: 1.3.3
// No API key, external AI service, or background server required.
(function talkToDJ() {
  "use strict";

  const VERSION = "1.3.3";
  const DJ_URI = "spotify:playlist:37i9dQZF1EYkqdzj48dyYq";
  const DJ_IDS = new Set([
    "37i9dQZF1EYkqdzj48dyYq", "37i9dQZF1EYkqdzj8OSOas", "37i9dQZF1EYkqdzjdvy3mw",
    "37i9dQZF1EYkqdzjicdiyA", "37i9dQZF1EYkqdzjmSSxKE", "37i9dQZF1EYkqdzjrzxMWI",
  ]);
  const ENDPOINT = "/dj-interaction-manager/spotify.dj.interactionmanager.v0.DJInteractionManagerService/ResolveInteractiveContext";
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

  // Field numbers and enum values come from Spotify Android's request schema.
  function encodeRequest(prompt, state, device) {
    const deviceId = device?.connectStateId || device?.id;
    if (!deviceId || deviceId === "local_device") {
      throw new DJError("Spotify is still connecting. Play a song on this computer, then try again.", "missing_device");
    }
    if (device.supportsDJNarration === false) {
      throw new DJError("The active device does not support DJ. Select This computer in Spotify's device picker.", "unsupported_device");
    }
    if (!isDJ(state) || !state.sessionId || !state.item?.uri) {
      throw new DJError("Start Spotify DJ and wait for it to begin playing, then try again.", "missing_session");
    }
    if (state.context?.metadata?.["dj.interactivity_enabled"] === "false") {
      throw new DJError("Spotify has not enabled DJ requests for this account or region.", "unavailable");
    }
    return new Uint8Array([
      ...encodeText(1, normalizePrompt(prompt)),
      ...encodeText(2, state.sessionId),
      ...encodeText(3, deviceId),
      ...encodeText(4, state.item.metadata?.segment || ""),
      ...encodeText(5, "0"), // No automatic retries: a request changes the DJ session.
      ...encodeText(7, state.item.uri),
      64, 2, // input_type = PROMPT_INPUT_TYPE_TEXT; reason defaults to REQUEST_PROMPT.
    ]);
  }

  function decodeReply(body) {
    if (body && typeof body === "object" && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
      return { code: body.statusCode ?? body.status_code, message: body.statusMessage ?? body.status_message ?? "" };
    }
    const bytes = body instanceof ArrayBuffer ? new Uint8Array(body)
      : ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : null;
    if (!bytes) throw new DJError("Spotify returned an unreadable DJ response.", "invalid_response");
    let offset = 0;
    const readVarint = () => {
      let value = 0;
      for (let shift = 0; shift < 35 && offset < bytes.length; shift += 7) {
        const byte = bytes[offset++];
        value += (byte & 127) * 2 ** shift;
        if (!(byte & 128)) return value;
      }
      throw new DJError("Spotify returned an incomplete DJ response.", "invalid_response");
    };
    const result = { code: "", message: "" };
    while (offset < bytes.length) {
      const tag = readVarint();
      const field = tag >>> 3;
      const wire = tag & 7;
      if (!field) throw new DJError("Spotify returned an invalid DJ response.", "invalid_response");
      if (wire === 2) {
        const length = readVarint();
        if (length > bytes.length - offset) throw new DJError("Spotify returned an incomplete DJ response.", "invalid_response");
        if (field === 1 || field === 2) {
          result[field === 1 ? "code" : "message"] = new TextDecoder().decode(bytes.subarray(offset, offset + length));
        }
        offset += length;
      } else if (wire === 0) {
        readVarint();
      } else if (wire === 1 || wire === 5) {
        offset += wire === 1 ? 8 : 4;
        if (offset > bytes.length) throw new DJError("Spotify returned an incomplete DJ response.", "invalid_response");
      } else {
        throw new DJError("Spotify returned an unsupported DJ response.", "invalid_response");
      }
    }
    return result;
  }

  function checkReply(reply) {
    const code = String(reply.code ?? "").toUpperCase();
    if (["OK", "SUCCESS", "200"].includes(code)) return reply;
    if (/RATE|LIMIT|429/.test(code)) throw new DJError("DJ is receiving too many requests. Wait a moment before trying again.", "rate_limited");
    if (/PERMISSION|FORBIDDEN|UNAVAILABLE|403/.test(code)) {
      throw new DJError("Spotify has not enabled DJ requests for this account or region.", "unavailable");
    }
    throw new DJError(reply.message || "DJ could not complete that request. Try a different music description.", "rejected");
  }

  function readableError(error) {
    if (error instanceof DJError) return error;
    const status = error?.status ?? error?.statusCode ?? error?.response?.status;
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      return new DJError("DJ took too long to reply. Check your music before resending; Spotify may still finish your request.", "timeout");
    }
    if (status === 401) return new DJError("Your Spotify session expired. Restart Spotify and try again.", "unauthorized");
    if (status === 403) return new DJError("Spotify has not enabled DJ requests for this account or region.", "unavailable");
    if (status === 429) return new DJError("Wait a moment before sending DJ another request.", "rate_limited");
    return new DJError("Could not reach Spotify DJ. Check your connection and try again.", "network");
  }

  function createClient(spicetify) {
    const platform = spicetify.Platform;

    async function ensureDJ(onProgress) {
      if (!platform.PlayerAPI?.getState) {
        throw new DJError("Spotify's playback API is not ready. Reapply Spicetify after updating Spotify.", "api_unavailable");
      }
      let state = platform.PlayerAPI.getState();
      if (!isDJ(state)) {
        onProgress("Starting Spotify DJ…");
        const metadata = await platform.PlaylistAPI.getMetadata(DJ_URI);
        const url = metadata?.formatListData?.attributes?.lexicon_context_url;
        if (!url) throw new DJError("Spotify DJ is not available for this account. It requires Premium and a supported region.", "unavailable");
        await platform.PlayerAPI.play({ uri: DJ_URI, url }, { featureIdentifier: "talk_to_dj", referrerIdentifier: "extension" }, {});
      }
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        state = platform.PlayerAPI.getState();
        if (isDJ(state) && state.sessionId && state.item?.uri) return state;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new DJError("DJ did not start in time. Start DJ from Spotify's Music tab, then send your request again.", "missing_session");
    }

    async function request(value, onProgress = () => {}) {
      const prompt = normalizePrompt(value);
      let timer;
      try {
        await ensureDJ(onProgress);
        // Read again after startup so the request never uses a previous session/device.
        const state = platform.PlayerAPI.getState();
        const device = platform.ConnectAPI.getState()?.activeDevice;
        const payload = encodeRequest(prompt, state, device);
        onProgress("DJ is picking music for you…");
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), 60000);
        const response = await platform.RequestBuilder.build()
          .withHost("https://spclient.wg.spotify.com")
          .withPath(ENDPOINT)
          .withMethod("POST")
          .withHeaders([
            { key: "Content-Type", value: "application/x-protobuf" },
            { key: "Accept", value: "application/x-protobuf" },
          ])
          .withBody(payload)
          .withResponseType("arraybuffer")
          .withAbortSignal(controller.signal)
          .withoutMarket()
          .send();
        if (response.status < 200 || response.status >= 300) throw { status: response.status };
        const reply = checkReply(decodeReply(response.body));
        return { prompt, message: reply.message };
      } catch (error) {
        throw readableError(error);
      } finally {
        clearTimeout(timer);
      }
    }

    async function letDJPick() {
      try {
        await ensureDJ(() => {});
        if (!platform.PlayerAPI.canSendSignal("jump")) throw new DJError("DJ is still loading. Try again in a moment.", "missing_session");
        await platform.PlayerAPI.sendSignal("jump");
      } catch (error) {
        throw readableError(error);
      }
    }
    return { request, letDJPick };
  }

  // A test seam for the request protocol; this branch never runs inside Spotify.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createClient, encodeRequest, decodeReply, checkReply, normalizePrompt, isDJ, DJError, ENDPOINT };
    return;
  }

  function boot() {
    const sp = window.Spicetify;
    if (!sp?.Platform?.PlayerAPI?.getState || !sp.Platform.RequestBuilder?.build
      || !sp.Platform.ConnectAPI?.getState || !sp.Platform.PlaylistAPI?.getMetadata
      || !sp.PopupModal || !document.body) {
      setTimeout(boot, 500);
      return;
    }
    if (window.TalkToDJX || window.TalkToDJ) return;

    const client = createClient(sp);
    const state = { draft: "", pending: 0, lastError: null };
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
      // Playback can change before the HTTP reply finishes. Keep it off the UI.
      Promise.resolve().then(action).catch((error) => {
        state.lastError = readableError(error).code;
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
    window.TalkToDJX = Object.freeze({ version: VERSION, open, close, getStatus: () => ({ pending: state.pending, lastError: state.lastError }) });
    window.TalkToDJ = window.TalkToDJX; // Keep existing local development tools compatible.
    console.info(`[TalkToDJX] ${VERSION} loaded`);
  }
  boot();
})();
