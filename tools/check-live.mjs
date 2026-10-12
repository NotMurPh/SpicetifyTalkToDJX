import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const target = targets.find((item) => item.type === "page" && /xpui/.test(item.url));
if (!target) throw new Error("Start Spotify with --remote-debugging-port=9222 first.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let id = 0;
const pending = new Map();
const errors = [];
socket.addEventListener("message", (event) => {
  const response = JSON.parse(event.data);
  if (response.method === "Runtime.consoleAPICalled" && response.params.type === "error") {
    errors.push({ console: response.params.args.map((arg) => arg.value ?? arg.description) });
  }
  if (response.method === "Runtime.exceptionThrown") {
    const details = response.params.exceptionDetails;
    errors.push({ message: details.exception?.description || details.text, url: details.url, frames: details.stackTrace?.callFrames?.map((frame) => ({ name: frame.functionName, url: frame.url, line: frame.lineNumber })) });
  }
  if (!response.id) return;
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  clearTimeout(request.timer);
  if (response.error || response.result?.exceptionDetails) request.reject(new Error(JSON.stringify(response.error || response.result.exceptionDetails)));
  else request.resolve(response.result);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 90000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  return result.result.value;
}
try {
  await call("Runtime.enable");
  await call("Page.enable");
  errors.length = 0;
  if (!process.argv.includes("--no-reload")) {
    await call("Page.reload", { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 6500));
  }
  await evaluate(`(async()=>{const deadline=Date.now()+10000;while(!document.querySelector('[data-ttdj-native="true"],#talk-to-dj-playbar')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,250));})()`);
  await evaluate("TalkToDJ.close()");
  const loaded = await evaluate("({loaded:window.TalkToDJ?.version,style:!!document.getElementById('talk-to-dj-style'),button:!!document.getElementById('talk-to-dj-topbar')})");
  console.log("Startup:", JSON.stringify(loaded), "Errors:", JSON.stringify(errors));
  assert.ok(loaded.loaded, "Extension did not initialize");
  assert.ok(loaded.button, "The topbar shortcut is missing");
  const native = await evaluate(`(() => {
    const button=document.querySelector('button[data-ttdj-native="true"],#talk-to-dj-playbar');
    if(!button)return {found:false};
    const before=Spicetify.Platform.PlayerAPI.getState().sessionId;
    button.click();
    return {found:true,opensMenu:!!document.querySelector('.ttdj'),sameSession:before===Spicetify.Platform.PlayerAPI.getState().sessionId};
  })()`);
  if (native.found) {
    assert.ok(native.opensMenu && native.sameSession, "Native DJ button did not open the request menu");
    console.log("Native DJ button:", JSON.stringify(native));
  } else {
    await evaluate("TalkToDJ.open()");
  }
  const ui = await evaluate(`(() => {
    const root = document.querySelector('.ttdj');
    const input = root.querySelector('textarea');
    input.value = '<img src=x onerror=alert(1)>';
    input.dispatchEvent(new Event('input', {bubbles:true}));
    const safe = !root.querySelector('img');
    input.value = '';
    input.dispatchEvent(new Event('input', {bubbles:true}));
    const send = root.querySelector('.ttdj-send');
    const pick = root.querySelector('.ttdj-pick');
    const row = root.querySelector('.ttdj-suggestions');
    const sendStyle = getComputedStyle(send);
    const pickStyle = getComputedStyle(pick);
    const rowRect = row.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const sendRect = send.getBoundingClientRect();
    const pickRect = pick.getBoundingClientRect();
    row.scrollLeft = 80;
    const staticCards = row.scrollLeft === 0 && row.scrollWidth <= row.clientWidth + 1;
    const allCardsVisible = [...row.children].every((chip) => {
      const rect=chip.getBoundingClientRect();
      return rect.width>0&&rect.left>=rowRect.left-1&&rect.right<=rowRect.right+1&&rect.bottom<=rowRect.bottom+1;
    });
    const singleRow = [...row.children].every((chip) => Math.abs(chip.getBoundingClientRect().top-row.firstElementChild.getBoundingClientRect().top)<1);
    const labelsFit = [...row.children].every((chip) => chip.scrollWidth<=chip.clientWidth+1);
    const normalEmptySend = !send.disabled && sendStyle.opacity === '1';
    send.click();
    const blankDoesNotSubmit = TalkToDJ.getStatus().pending === 0 && root.isConnected;
    root.querySelector('.ttdj-chip').click();
    return {safe,normalEmptySend,blankDoesNotSubmit,suggestionFilled:input.value.length>0,
      visible:root.getBoundingClientRect().height>0,dialog:root.closest('[role=dialog]')?.getAttribute('aria-label'),
      heading:root.querySelector('h2').textContent,noSubtitle:!root.querySelector('.ttdj-intro p'),
      noHints:!root.querySelector('.ttdj-hints,.ttdj-counter'),noHistory:!root.querySelector('.ttdj-recent'),
      noStatus:!root.querySelector('.ttdj-status,.ttdj-spinner,[aria-busy]'),
      borderlessInput:getComputedStyle(input).borderTopWidth==='0px',staticCards,allCardsVisible,singleRow,labelsFit,
      closeToInput:rowRect.top-inputRect.bottom<=12,
      adjacentButtons:Math.abs(sendRect.top-pickRect.top)<1&&pickRect.left>=sendRect.right,
      equalButtons:Math.abs(sendRect.width-pickRect.width)<1,
      alignedWithInput:Math.abs(sendRect.left-inputRect.left)<1&&Math.abs(pickRect.right-inputRect.right)<1,
      borderedButtons:parseFloat(sendStyle.borderTopWidth)>=1&&parseFloat(pickStyle.borderTopWidth)>=1,
      labels:[send.textContent,pick.textContent]};
  })()`);
  for (const key of ['safe','normalEmptySend','blankDoesNotSubmit','suggestionFilled','visible','noSubtitle','noHints','noHistory','noStatus','borderlessInput','staticCards','allCardsVisible','singleRow','labelsFit','closeToInput','adjacentButtons','equalButtons','alignedWithInput','borderedButtons']) assert.ok(ui[key], key);
  assert.equal(ui.dialog, "TalkToDJX");
  assert.equal(ui.heading, "Tell ’em what you want:");
  assert.deepEqual(ui.labels, ["Send", "Hand it to DJ X"]);
  console.log("UI:", JSON.stringify(ui));

  const outsideCloses = await evaluate(`(() => { const overlay=document.querySelector('.ttdj').closest('.GenericModal__overlay');overlay.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return !document.querySelector('.ttdj'); })()`);
  assert.ok(outsideCloses, "Clicking the backdrop did not close the panel");

  // Delay and reject transport replies to exercise the user's reported timing issue.
  const background = await evaluate(`(async()=>{
    const platform=Spicetify.Platform;
    const originalBuild=platform.RequestBuilder.build;
    const originalSignal=platform.PlayerAPI.sendSignal;
    const replies=[];
    let requests=0,jumps=0;
    platform.RequestBuilder.build=function(...args){
      const builder=originalBuild.apply(this,args);
      const withPath=builder.withPath,send=builder.send;
      let path;
      builder.withPath=function(value){path=value;return withPath.call(this,value);};
      builder.send=function(...sendArgs){
        if(!path?.includes('DJInteractionManagerService/ResolveInteractiveContext'))return send.apply(this,sendArgs);
        requests++;
        return new Promise((resolve,reject)=>replies.push({resolve,reject}));
      };
      return builder;
    };
    platform.PlayerAPI.sendSignal=function(signal,...args){if(signal==='jump'){jumps++;return Promise.resolve();}return originalSignal.call(this,signal,...args);};
    const until=async(predicate)=>{const deadline=Date.now()+5000;while(!predicate()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));};
    try{
      TalkToDJ.open();
      let input=document.querySelector('.ttdj textarea');
      input.value='A delayed request for the UI check';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      const oldForm=document.querySelector('.ttdj form');
      oldForm.requestSubmit();
      const closedImmediately=!document.querySelector('.ttdj');
      oldForm.requestSubmit(); // A stale/double click must not send twice.
      await until(()=>requests===1);
      if(requests!==1)throw new Error('The delayed request mock was not reached exactly once');
      TalkToDJ.open();
      const reopened=document.querySelector('.ttdj');
      const readyWhilePending=!reopened.querySelector('.ttdj-send').disabled&&!reopened.querySelector('.ttdj-pick').disabled&&!reopened.querySelector('.ttdj-spinner,.ttdj-status,[aria-busy]');
      input=reopened.querySelector('textarea');
      input.value='A second request while the first reply is delayed';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      reopened.querySelector('form').requestSubmit();
      await until(()=>requests===2);
      const secondSent=requests===2;
      for(const reply of replies)reply.reject({status:503});
      await until(()=>TalkToDJ.getStatus().pending===0);
      const staysClosedAfterErrors=!document.querySelector('.ttdj');
      TalkToDJ.open();
      document.querySelector('.ttdj-pick').click();
      const handClosesImmediately=!document.querySelector('.ttdj');
      await until(()=>TalkToDJ.getStatus().pending===0);
      return {closedImmediately,readyWhilePending,secondSent,staysClosedAfterErrors,handClosesImmediately,jumps,requests,settled:TalkToDJ.getStatus().pending===0};
    }finally{
      for(const reply of replies)reply.reject({status:503});
      platform.RequestBuilder.build=originalBuild;
      platform.PlayerAPI.sendSignal=originalSignal;
      TalkToDJ.close();
    }
  })()`);
  console.log("Dismissal/background requests:", JSON.stringify({ outsideCloses, ...background }));
  for (const key of ['closedImmediately','readyWhilePending','secondSent','staysClosedAfterErrors','handClosesImmediately','settled']) assert.ok(background[key], key);
  assert.equal(background.requests, 2);
  assert.equal(background.jumps, 1);

  const promptIndex = process.argv.indexOf("--prompt");
  if (promptIndex !== -1) {
    const prompt = process.argv[promptIndex + 1];
    assert.ok(prompt, "--prompt requires a music request");
    const before = await evaluate("Spicetify.Platform.PlayerAPI.getState().context.metadata['correlation-id']");
    const closed = await evaluate(`(() => { TalkToDJ.open();const input=document.querySelector('.ttdj textarea');input.value=${JSON.stringify(prompt)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.ttdj form').requestSubmit();return !document.querySelector('.ttdj');})()`);
    assert.ok(closed, "The panel did not close immediately on Send");
    if (process.argv.includes("--player-states")) {
      const phases = {};
      const deadline = Date.now() + 75000;
      const screenshotIndex = process.argv.indexOf("--screenshot");
      const screenshotBase = screenshotIndex === -1 ? null : process.argv[screenshotIndex + 1];
      while (Date.now() < deadline && (!phases.narration || !phases.music)) {
        const snapshot = await evaluate(`(() => {
          const s=Spicetify.Platform.PlayerAPI.getState();
          const narration=String(s.item?.metadata?.is_narration)==='true'||s.item?.uri?.startsWith('spotify:narration:');
          const buttons=[...document.querySelectorAll('[data-ttdj-native="true"],button.Nv04LEC5GMu3msfbzG0z,button.FrqTR9ccUqvGA9UZRf9H,#talk-to-dj-playbar')].filter(b=>b.getBoundingClientRect().width>0);
          const button=buttons[0],queue=document.querySelector('[data-testid="control-button-queue"]');
          if(!button||!queue)return null;
          const r=button.getBoundingClientRect(),q=queue.getBoundingClientRect(),style=getComputedStyle(button),icon=button.querySelector('svg');
          return {phase:narration?'narration':'music',changed:s.context.metadata['correlation-id']!==${JSON.stringify(before)},
            title:s.item?.metadata?.title,count:buttons.length,fallback:button.id==='talk-to-dj-playbar',
            horizontal:Math.abs(r.top+r.height/2-q.top-q.height/2)<1&&r.right<=q.left,
            width:r.width,height:r.height,radius:style.borderRadius,background:style.backgroundColor,
            outline:style.outlineColor,iconColor:icon?getComputedStyle(icon).color:null,iconPath:icon?.querySelector('path')?.getAttribute('d')};
        })()`);
        if (snapshot?.changed && snapshot.count === 1 && (snapshot.phase === "narration" ? snapshot.fallback : phases.narration && !snapshot.fallback) && !phases[snapshot.phase]) {
          phases[snapshot.phase] = snapshot;
          if (screenshotBase) {
            const path = screenshotBase.replace(/\.png$/i, `-${snapshot.phase}.png`);
            const screenshot = await call("Page.captureScreenshot", { format: "png" });
            await writeFile(path, Buffer.from(screenshot.data, "base64"));
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      for (const phase of ["narration", "music"]) {
        assert.ok(phases[phase], `Did not observe DJ ${phase}`);
        assert.ok(phases[phase].horizontal, `The DJ button stacked during ${phase}`);
        assert.equal(phases[phase].width, 32);
        assert.equal(phases[phase].height, 32);
        assert.equal(phases[phase].radius, "50%");
      }
      for (const property of ["background", "outline", "iconColor", "iconPath"]) {
        assert.equal(phases.narration[property], phases.music[property], `DJ ${property} changed between narration and music`);
      }
      assert.ok(phases.narration.fallback, "The narration fallback was not exercised");
      assert.ok(!phases.music.fallback, "The native music button did not replace the fallback");
      console.log("DJ player states:", JSON.stringify(Object.fromEntries(Object.entries(phases).map(([phase, sample]) => [phase, { ...sample, iconPath: "matching native DJ icon" }]))));
    }
    const result = await evaluate(`(async()=>{const deadline=Date.now()+75000;while(TalkToDJ.getStatus().pending&&Date.now()<deadline)await new Promise(r=>setTimeout(r,250));return TalkToDJ.getStatus();})()`);
    console.log("Prompt:", JSON.stringify(result));
    const playback = await evaluate(`(async()=>{const deadline=Date.now()+20000;let s;do{s=Spicetify.Platform.PlayerAPI.getState();if(s.context.metadata['correlation-id']!==${JSON.stringify(before)})break;await new Promise(r=>setTimeout(r,250));}while(Date.now()<deadline);return{title:s.item?.metadata?.title,artist:s.item?.metadata?.artist_name,narration:s.item?.metadata?.['narration.intro.ssml'],changed:s.context.metadata['correlation-id']!==${JSON.stringify(before)}};})()`);
    console.log("Playback:", JSON.stringify(playback));
    assert.ok(playback.changed, "DJ did not change its session after accepting the prompt");
  }

  const screenshotIndex = process.argv.indexOf("--screenshot");
  if (screenshotIndex !== -1) {
    const path = process.argv[screenshotIndex + 1];
    await evaluate("TalkToDJ.open()");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(screenshot.data, "base64"));
    console.log("Screenshot:", path);
  }
} finally {
  socket.close();
}
