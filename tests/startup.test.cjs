const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const source = readFileSync(require.resolve("../talk-to-dj.js"), "utf8");

function start(topbar) {
  const created = [];
  const listeners = [];
  const element = (tag) => ({
    tag, children: [], isConnected: false,
    append(child) { this.children.push(child); child.isConnected = true; },
    setAttribute() {}, addEventListener() {},
  });
  const left = element("nav");
  const document = {
    body: element("body"), head: element("head"),
    createElement(tag) { const node = element(tag); created.push(node); return node; },
    querySelector: () => left,
    addEventListener: (event) => listeners.push(event),
  };
  let mutation;
  const window = { Spicetify: {
    Platform: { PlayerAPI: { getState() {} }, RequestBuilder: { build() {} }, ConnectAPI: { getState() {} }, PlaylistAPI: { getMetadata() {} } },
    PopupModal: {}, Topbar: topbar,
    // React, ReactJSX, Menu, and Player intentionally unavailable during startup.
  } };
  vm.runInNewContext(source, { window, document, console: { info() {} },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
    queueMicrotask: (fn) => fn(), setTimeout() { throw new Error("Startup waited for an unrelated API"); },
  });
  return { window, created, listeners, left, remount: () => mutation() };
}

for (const [label, api] of [["missing", undefined], ["broken", { Button: class { constructor() { throw new Error("mount point changed"); } } }]]) {
  test(`startup works with ${label} Topbar API and delayed React, and remounts just the top-left button`, () => {
    const app = start(api);
    assert.equal(app.window.TalkToDJX.version, "1.3.3");
    assert.equal(app.window.TalkToDJ, app.window.TalkToDJX);
    const buttons = app.created.filter((node) => node.tag === "button");
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].id, "talk-to-dj-topbar");
    assert.deepEqual(app.listeners, ["keydown"], "must not intercept native player DJ clicks");
    const container = app.left.children[0];
    container.isConnected = false;
    app.left.children = [];
    app.remount();
    app.remount();
    assert.deepEqual(app.left.children, [container]);
  });
}
