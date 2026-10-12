import { copyFile, mkdir, access, unlink, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { compatibilityPatches, mergePatches } from "./tools/compat.mjs";

const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !["--uninstall", "--no-restart"].includes(arg))) {
  throw new Error("Usage: node install.mjs [--uninstall] [--no-restart]");
}
function run(...args) {
  const result = spawnSync("spicetify", args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw new Error(`Could not run Spicetify: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Spicetify failed.");
  return result.stdout.trim();
}

const config = run("-c");
const root = dirname(config);
await access(root, constants.R_OK | constants.W_OK);
const extensions = join(root, "Extensions");
const filename = "talk-to-dj.js";
const target = join(extensions, filename);

if (args.has("--uninstall")) {
  console.log(run("config", "extensions", `${filename}-`));
  await unlink(target).catch((error) => { if (error.code !== "ENOENT") throw error; });
} else {
  const source = join(dirname(fileURLToPath(import.meta.url)), filename);
  await access(source, constants.R_OK);
  await mkdir(extensions, { recursive: true });
  await copyFile(source, target);
  if (run("--version") === "2.45.3") {
    const raw = join(root, "Extracted", "Raw", "xpui", "xpui-modules.js");
    const bundle = await readFile(raw, "utf8").catch(() => "");
    const text = await readFile(config, "utf8");
    const patched = mergePatches(text, compatibilityPatches(bundle));
    if (patched !== text) {
      await copyFile(config, `${config}.talk-to-dj-backup`);
      await writeFile(config, patched, "utf8");
      console.log("Applied Spicetify 2.45.3 React startup compatibility patch.");
    }
  }
  console.log(run("config", "extensions", filename));
}
console.log(run(...(args.has("--no-restart") ? ["-n", "apply"] : ["apply"])));
console.log(args.has("--uninstall") ? "TalkToDJX uninstalled." : `TalkToDJX installed: ${target}`);
