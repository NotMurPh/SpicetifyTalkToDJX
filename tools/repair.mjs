// Shared installer recovery and optional Windows scheduled update repair.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const TASK_NAME = "TalkToDJX Update Repair";
export const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;

export function needsBackup(output) {
  return /version.*(?:mismatch|different)|(?:run|use).*spicetify backup apply|not.*backed.?up|no backup/i.test(output.replace(/\x1b\[[0-9;]*m/g, ""));
}

export function applyWithRecovery(run, noRestart = false) {
  const flags = noRestart ? ["-n"] : [];
  let output = run(...flags, "apply");
  if (needsBackup(output)) output = run(...flags, "backup", "apply");
  // Some Spicetify warnings exit with status 0, without applying anything.
  if (needsBackup(output) || !/success.*(?:applied|refreshed)/i.test(output.replace(/\x1b\[[0-9;]*m/g, ""))) {
    throw new Error(`Spicetify did not apply successfully:\n${output}`);
  }
  return output;
}

export function iniValue(text, section, key) {
  let active = false;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) { active = header[1] === section; continue; }
    const entry = line.match(/^\s*([^;#=]+?)\s*=\s*(.*?)\s*$/);
    if (active && entry?.[1] === key) return entry[2];
  }
  return "";
}

export function repairRequired(config, installedVersion, html) {
  if (!iniValue(config, "AdditionalOptions", "extensions").split("|").includes("talk-to-dj.js")) return false;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(installedVersion)) throw new Error("Could not determine the installed Spotify version.");
  const backup = iniValue(config, "Backup", "version");
  return !(backup === installedVersion || backup.startsWith(`${installedVersion}.`))
    || !/spicetifyWrapper\.js/.test(html) || !/extensions\/talk-to-dj\.js/.test(html);
}

export function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true, timeout: 180000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${executable} failed (${result.status}).`);
  return result.stdout.trim();
}

export function configureTask(script, config, cli, enabled) {
  if (process.platform !== "win32") throw new Error("Scheduled auto-repair currently supports Windows only.");
  if (!enabled) {
    return command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$ErrorActionPreference='Stop'; $task=Get-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -ErrorAction SilentlyContinue; `
      + "if($task){$task | Unregister-ScheduledTask -Confirm:$false}; exit 0"]);
  }
  const invocation = [process.execPath, script, "--watch", config, "--spicetify", cli].map(psQuote).join(" ");
  const args = `-NoProfile -NonInteractive -WindowStyle Hidden -Command "& ${invocation}; exit $LASTEXITCODE"`;
  const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$ErrorActionPreference='Stop'; $action=New-ScheduledTaskAction -Execute ${psQuote(powershell)} -Argument ${psQuote(args)}; `
    + "$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5); "
    + "$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited; "
    + "$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4); "
    + `Register-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`]);
}

async function watch(configPath, cli) {
  const config = await readFile(configPath, "utf8");
  const spotify = iniValue(config, "Setting", "spotify_path");
  if (!spotify) throw new Error("Spotify path is missing from Spicetify configuration.");
  const version = command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `(Get-Item -LiteralPath ${psQuote(join(spotify, "Spotify.exe"))}).VersionInfo.ProductVersion`]);
  const html = await readFile(join(spotify, "Apps", "xpui", "index.html"), "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (!repairRequired(config, version, html)) return;
  const running = command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "[bool](Get-Process -Name Spotify -ErrorAction SilentlyContinue)"]) === "True";
  console.log(applyWithRecovery((...args) => command(cli, args), true));
  // Never launch Spotify just because its update task ran while it was closed.
  if (running) command(cli, ["restart"]);
  return `Repaired Spotify ${version}${running ? " and restarted Spotify" : ""}.`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === "--watch") {
  const config = process.argv[3];
  const cli = process.argv[4] === "--spicetify" ? process.argv[5] : "spicetify";
  const log = join(dirname(fileURLToPath(import.meta.url)), "repair.log");
  const logLine = async (message) => {
    const previous = await readFile(log, "utf8").catch(() => "");
    await writeFile(log, `${previous.slice(-32000)}${new Date().toISOString()} ${message}\n`);
  };
  try {
    const result = await watch(config, cli);
    if (result) await logLine(result);
  } catch (error) {
    await logLine(error.message);
    process.exitCode = 1;
  }
}
