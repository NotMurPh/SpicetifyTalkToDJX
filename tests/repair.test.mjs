import test from "node:test";
import assert from "node:assert/strict";
import { applyWithRecovery, repairRequired, iniValue, psQuote } from "../tools/repair.mjs";

const applied = "\x1b[32m success \x1b[0m Applied additional modifications";
const mismatch = 'warning Spotify version and backup version are mismatched. Please run "spicetify backup apply"';
const config = "[Setting]\nspotify_path = C:\\Spotify\n[AdditionalOptions]\nextensions = other.js|talk-to-dj.js\n[Backup]\nversion = 1.3.6.1921.g7086c071a617\n";
const html = "<script src='helper/spicetifyWrapper.js'></script><script src='extensions/talk-to-dj.js'></script>";

test("a status-zero version-mismatch warning rebuilds the backup and applies once", () => {
  const calls = [];
  const run = (...args) => { calls.push(args); return calls.length === 1 ? mismatch : applied; };
  assert.equal(applyWithRecovery(run, true), applied);
  assert.deepEqual(calls, [["-n", "apply"], ["-n", "backup", "apply"]]);
});

test("healthy installs use normal apply; failures never report success or retry endlessly", () => {
  const calls = [];
  applyWithRecovery((...args) => { calls.push(args); return applied; });
  assert.deepEqual(calls, [["apply"]]);
  let attempts = 0;
  assert.throws(() => applyWithRecovery(() => { attempts++; return mismatch; }), /did not apply/);
  assert.equal(attempts, 2);
  assert.throws(() => applyWithRecovery(() => "warning Spotify is not installed"), /did not apply/);
  assert.throws(() => applyWithRecovery(() => { throw new Error("unsupported version"); }), /unsupported version/);
});

test("the periodic repair detects Spotify updates, missing injection, and stays idle when healthy", () => {
  assert.equal(repairRequired(config, "1.3.6.1921", html), false);
  assert.equal(repairRequired(config, "1.3.7.100", html), true);
  assert.equal(repairRequired(config, "1.3.6.1921", "<script src='xpui-snapshot.js'></script>"), true);
  assert.equal(repairRequired(config, "1.3.6.1921", "spicetifyWrapper.js"), true);
  assert.equal(repairRequired(config.replace("other.js|talk-to-dj.js", "other.js"), "1.3.7.100", ""), false);
  assert.throws(() => repairRequired(config, "", html), /determine/);
});

test("configuration parsing respects sections and task paths are quoted", () => {
  assert.equal(iniValue(config, "Backup", "version"), "1.3.6.1921.g7086c071a617");
  assert.equal(iniValue(config, "Setting", "version"), "");
  assert.equal(psQuote("C:\\Murphy's Files\\repair.mjs"), "'C:\\Murphy''s Files\\repair.mjs'");
});
