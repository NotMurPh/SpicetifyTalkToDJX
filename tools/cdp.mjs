// Local-only Spotify DevTools helper. Never prints authentication tokens.
import { readFile } from "node:fs/promises";

const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const target = targets.find((item) => item.type === "page" && /xpui|spotify/i.test(item.url));
if (!target) throw new Error("Spotify DevTools target not found.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const expression = process.argv[2] === "--file"
  ? await readFile(process.argv[3], "utf8")
  : process.argv.slice(2).join(" ");
const timeout = setTimeout(() => { socket.close(); console.error("Evaluation timed out."); process.exitCode = 1; }, 90000);
socket.addEventListener("message", (event) => {
  const response = JSON.parse(event.data);
  if (response.id !== 1) return;
  clearTimeout(timeout);
  if (response.error || response.result?.exceptionDetails) {
    console.error(JSON.stringify(response.error ?? response.result.exceptionDetails, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(response.result?.result?.value ?? response.result?.result, null, 2));
  }
  socket.close();
});
socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: {
  expression, awaitPromise: true, returnByValue: true, userGesture: true,
} }));
