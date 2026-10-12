import test from "node:test";
import assert from "node:assert/strict";
import { compatibilityPatches, mergePatches } from "../tools/compat.mjs";

test("compatibility wrappers keep native exports and only recognize exact module signatures", () => {
  const source = '62515(e,t,i){"use strict";e.exports=i(94842)},23955(e,t,i){"use strict";e.exports=i(13905)}';
  const patches = compatibilityPatches(source);
  assert.equal(Object.keys(patches).length, 4);
  assert.ok(Object.keys(patches).every((key) => /^xpui-modules\.js_(find|repl)_\d+$/.test(key)), "Spicetify accepts only numeric patch identifiers");
  const transformed = source.replace(new RegExp(patches["xpui-modules.js_find_9187301"]), patches["xpui-modules.js_repl_9187301"]);
  assert.ok(transformed.includes("Spicetify.React=e.exports=i(94842)"));
  assert.deepEqual(compatibilityPatches("future Spotify bundle with different module IDs"), {});
});

test("installing patches preserves user settings, comments, and unrelated patches", () => {
  const config = "[Setting]\r\ncurrent_theme = custom\r\n[Patch]\r\n; user comment\r\ncustom_find = keep\r\n[Backup]\r\nversion = existing\r\n";
  const patches = { "xpui-modules.js_find_9187301": "native-pattern", "xpui-modules.js_repl_9187301": "native-export" };
  const merged = mergePatches(config, patches);
  assert.ok(merged.includes("current_theme = custom\r\n"));
  assert.ok(merged.includes("; user comment\r\ncustom_find = keep\r\n"));
  assert.ok(merged.includes("[Backup]\r\nversion = existing"));
  assert.equal(mergePatches(merged, patches), merged);
});

test("an unrecognized bundle does not modify Spicetify configuration", () => {
  const config = "[Setting]\ncurrent_theme = custom\n";
  assert.equal(mergePatches(config, {}), config);
});
