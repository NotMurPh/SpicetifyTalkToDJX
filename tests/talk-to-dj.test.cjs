const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient, encodeRequest, decodeReply, checkReply, normalizePrompt, DJError, ENDPOINT } = require("../talk-to-dj.js");

const playing = () => ({
  sessionId: "session-123",
  context: { uri: "spotify:playlist:37i9dQZF1EYkqdzj48dyYq", metadata: { "dj.interactivity_enabled": "true" } },
  item: { uri: "spotify:track:track-123", metadata: { segment: "XX-Segment-42" } },
});
const device = { id: "local_device", connectStateId: "real-connect-id", supportsDJNarration: true };
const OK = Uint8Array.from([10, 2, 79, 75, 18, 7, 115, 117, 99, 99, 101, 115, 115]);

// Independently read the wire request to check what Spotify actually receives.
function readFields(bytes) {
  let offset = 0;
  const fields = {};
  const integer = () => {
    let value = 0, multiplier = 1;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      value += (byte % 128) * multiplier;
      if (byte < 128) return value;
      multiplier *= 128;
    }
    throw new Error("Truncated fixture");
  };
  while (offset < bytes.length) {
    const tag = integer();
    if (tag % 8 === 0) fields[Math.floor(tag / 8)] = integer();
    else {
      assert.equal(tag % 8, 2);
      const length = integer();
      fields[Math.floor(tag / 8)] = Buffer.from(bytes.subarray(offset, offset + length)).toString("utf8");
      offset += length;
    }
  }
  return fields;
}

function fixture(send = async () => ({ status: 200, body: OK.buffer })) {
  const calls = [];
  let state = playing();
  let currentDevice = device;
  const player = {
    getState: () => state,
    play: async (context) => { calls.push({ play: context }); state = { ...playing(), sessionId: "new-session" }; },
    canSendSignal: () => true,
    sendSignal: async (signal) => { calls.push({ signal }); },
  };
  const builder = () => {
    const call = {};
    const chain = {};
    for (const method of ["withHost", "withPath", "withMethod", "withHeaders", "withBody", "withResponseType", "withAbortSignal", "withoutMarket"]) {
      chain[method] = (value) => { call[method] = value; return chain; };
    }
    chain.send = async () => { calls.push(call); return send(call); };
    return chain;
  };
  const client = createClient({ Platform: {
    PlayerAPI: player,
    ConnectAPI: { getState: () => ({ activeDevice: currentDevice }) },
    PlaylistAPI: { getMetadata: async () => ({ formatListData: { attributes: { lexicon_context_url: "hm://dj-session" } } }) },
    RequestBuilder: { build: builder },
  } });
  return { client, calls, setState: (value) => { state = value; }, setDevice: (value) => { currentDevice = value; } };
}

test("Unicode and long UTF-8 prompts survive the Android protobuf wire format", () => {
  const prompt = "Café 🎷 ".repeat(20);
  assert.deepEqual(readFields(encodeRequest(prompt, playing(), device)), {
    1: prompt.trim(), 2: "session-123", 3: "real-connect-id", 4: "XX-Segment-42", 5: "0", 7: "spotify:track:track-123", 8: 2,
  });
});

test("invalid requests never reach Spotify or start playback", async () => {
  const { client, calls } = fixture();
  await assert.rejects(client.request("   "), { code: "empty_prompt" });
  await assert.rejects(client.request("a".repeat(501)), { code: "long_prompt" });
  assert.equal(calls.length, 0);
  assert.equal(normalizePrompt("  jazz  "), "jazz");
});

test("a request uses authenticated Spotify transport and the actual Connect ID", async () => {
  const { client, calls } = fixture();
  const result = await client.request("  mellow jazz  ");
  assert.deepEqual(result, { prompt: "mellow jazz", message: "success" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].withHost, "https://spclient.wg.spotify.com");
  assert.equal(calls[0].withPath, ENDPOINT);
  assert.equal(calls[0].withMethod, "POST");
  assert.equal(calls[0].withResponseType, "arraybuffer");
  assert.equal(readFields(calls[0].withBody)[3], "real-connect-id");
});

test("starting DJ sends the new playback session, not the previous playlist session", async () => {
  const fixtureData = fixture();
  fixtureData.setState({ sessionId: "old-session", context: { uri: "spotify:playlist:other" }, item: { uri: "spotify:track:old" } });
  await fixtureData.client.request("jazz");
  assert.equal(fixtureData.calls.length, 2);
  assert.equal(fixtureData.calls[0].play.url, "hm://dj-session");
  assert.equal(readFields(fixtureData.calls[1].withBody)[2], "new-session");
});

test("unsupported devices and unavailable account requests cannot be submitted", async () => {
  const data = fixture();
  data.setDevice({ ...device, supportsDJNarration: false });
  await assert.rejects(data.client.request("jazz"), { code: "unsupported_device" });
  data.setDevice({ id: "local_device" });
  await assert.rejects(data.client.request("jazz"), { code: "missing_device" });
  data.setDevice(device);
  const state = playing();
  state.context.metadata["dj.interactivity_enabled"] = "false";
  data.setState(state);
  await assert.rejects(data.client.request("jazz"), { code: "unavailable" });
  assert.equal(data.calls.length, 0);
});

test("HTTP 200 with a service rejection is an error, and is never automatically retried", async () => {
  const { client, calls } = fixture(async () => ({ status: 200, body: { statusCode: "ERROR", statusMessage: "Try a more specific music request." } }));
  await assert.rejects(client.request("jazz"), { code: "rejected", message: "Try a more specific music request." });
  assert.equal(calls.length, 1);
});

test("HTTP permission failures are reported clearly", async () => {
  const { client } = fixture(async () => { throw { status: 403 }; });
  await assert.rejects(client.request("jazz"), { code: "unavailable" });
});

test("a delayed response cannot block a later request or the native DJ command", async () => {
  let finish;
  let sent;
  const started = new Promise((resolve) => { sent = resolve; });
  const pending = new Promise((resolve) => { finish = resolve; });
  const { client, calls, setState } = fixture(async () => { sent(); await pending; return { status: 200, body: OK.buffer }; });
  const first = client.request("jazz");
  await started;
  setState({ ...playing(), sessionId: "session-after-first-request" });
  const second = client.request("rock");
  await client.letDJPick();
  const requests = calls.filter((call) => call.withMethod === "POST");
  assert.equal(requests.length, 2);
  assert.equal(readFields(requests[1].withBody)[2], "session-after-first-request");
  assert.deepEqual(calls.at(-1), { signal: "jump" });
  finish();
  await Promise.all([first, second]);
});

test("only a complete positive service reply counts as acceptance", () => {
  assert.deepEqual(decodeReply(OK.buffer), { code: "OK", message: "success" });
  const padded = Uint8Array.from([99, ...OK, 99]);
  assert.deepEqual(decodeReply(padded.subarray(1, -1)), { code: "OK", message: "success" });
  assert.throws(() => decodeReply(Uint8Array.from([10, 100, 65])), { code: "invalid_response" });
  assert.throws(() => decodeReply(Uint8Array.from([128])), { code: "invalid_response" });
  assert.throws(() => checkReply(decodeReply(new ArrayBuffer(0))), DJError);
  assert.throws(() => checkReply({ code: "RATE_LIMITED" }), { code: "rate_limited" });
});
