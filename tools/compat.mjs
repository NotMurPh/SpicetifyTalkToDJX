// Spicetify 2.45.3 discovers React asynchronously, after Marketplace can render.
// These narrowly scoped wrappers expose the exact same native exports immediately.
export function compatibilityPatches(source) {
  const patches = {};
  for (const [id, key, property] of [[62515, "9187301", "React"], [23955, "9187302", "ReactJSX"]]) {
    const match = source.match(new RegExp(`${id}\\((\\w+),(\\w+),(\\w+)\\)\\{\"use strict\";\\1\\.exports=\\3\\((\\d+)\\)\\}`));
    if (!match) continue;
    const [original, module, exports, require, dependency] = match;
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    patches[`xpui-modules.js_find_${key}`] = escape(original);
    patches[`xpui-modules.js_repl_${key}`] = `${id}(${module},${exports},${require}){"use strict";Spicetify.${property}=${module}.exports=${require}(${dependency})}`;
  }
  return patches;
}

export function mergePatches(config, patches) {
  if (!Object.keys(patches).length) return config;
  const newline = config.includes("\r\n") ? "\r\n" : "\n";
  const lines = config.split(/\r?\n/);
  let start = lines.findIndex((line) => /^\s*\[Patch\]\s*$/.test(line));
  if (start === -1) { lines.push("", "[Patch]"); start = lines.length - 1; }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  const section = lines.slice(start + 1, end).filter((line) => !Object.keys(patches).some((key) => line.trimStart().startsWith(`${key} `) || line.trimStart().startsWith(`${key}=`)));
  while (section.length && !section.at(-1).trim()) section.pop();
  lines.splice(start + 1, end - start - 1, ...section, ...Object.entries(patches).map(([key, value]) => `${key} = ${value}`), "");
  return lines.join(newline);
}
