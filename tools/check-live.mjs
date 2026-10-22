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
  await call("Page.bringToFront");
  errors.length = 0;
  if (!process.argv.includes("--no-reload")) {
    await call("Page.reload", { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 6500));
  }
  await evaluate(`(async()=>{const deadline=Date.now()+10000;while(!window.TalkToDJX&&Date.now()<deadline)await new Promise(r=>setTimeout(r,250));})()`);
  await evaluate("TalkToDJ.close()");
  const loaded = await evaluate("({loaded:window.TalkToDJ?.version,style:!!document.getElementById('talk-to-dj-style'),button:!!document.getElementById('talk-to-dj-topbar')})");
  console.log("Startup:", JSON.stringify(loaded), "Errors:", JSON.stringify(errors));
  assert.ok(loaded.loaded, "Extension did not initialize");
  assert.ok(loaded.button, "The topbar shortcut is missing");
  const shortcut = await evaluate(`(() => {
    const button=document.getElementById('talk-to-dj-topbar');
    button.click();
    return {opensMenu:!!document.querySelector('.ttdj'),count:document.querySelectorAll('#talk-to-dj-topbar').length,
      topLeft:!!button.closest('.main-globalNav-historyButtonsWrapper,.main-topBar-topbarContentLeft'),
      noBottomButton:!document.querySelector('#talk-to-dj-playbar,.ttdj-player-dj-slot,[data-ttdj-native="true"]'),
      nativeHidden:[...document.querySelectorAll('.main-nowPlayingBar-extraControls button')]
        .filter(b=>b.matches('[data-testid="dj-button"],[data-testid="dj-jump-button"]')||b.querySelector('svg path[d^="M7.813 14.497"]'))
        .every(b=>getComputedStyle(b).display==='none')};
  })()`);
  assert.ok(shortcut.opensMenu && shortcut.topLeft && shortcut.noBottomButton && shortcut.nativeHidden, "The top-left-only shortcut is broken");
  assert.equal(shortcut.count, 1);
  console.log("Top-left shortcut:", JSON.stringify(shortcut));
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

  // Hold native commands without changing playback to exercise background UI behavior.
  const background = await evaluate(`(async()=>{
    const platform=Spicetify.Platform;
    const originalSignal=platform.PlayerAPI.sendSignal;
    const nativePlay=platform.PlayerAPI._playlistPlayServiceClient;
    const originalPlay=nativePlay?.play;
    const originalNotification=Spicetify.showNotification;
    const replies=[];
    let requests=0,jumps=0;
    const hold=()=>{requests++;return new Promise((resolve,reject)=>replies.push({resolve,reject}));};
    platform.PlayerAPI.sendSignal=function(signal,...args){
      if(signal==='prompt')return hold();
      if(signal==='jump'){jumps++;return Promise.resolve();}
      return originalSignal.call(this,signal,...args);
    };
    if(nativePlay)nativePlay.play=function(request,...args){
      if(request.rawSignal?.identifier==='prompt')return hold();
      return originalPlay.call(this,request,...args);
    };
    Spicetify.showNotification=()=>{}; // Suppress only deliberately injected test failures.
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
      const queuedWhilePending=TalkToDJ.getStatus().pending===2&&requests===1;
      replies[0].reject(new Error('Deliberate test rejection'));
      await until(()=>requests===2);
      const secondSent=requests===2;
      for(const reply of replies)reply.reject(new Error('Deliberate test rejection'));
      await until(()=>TalkToDJ.getStatus().pending===0);
      const staysClosedAfterErrors=!document.querySelector('.ttdj');
      TalkToDJ.open();
      document.querySelector('.ttdj-pick').click();
      const handClosesImmediately=!document.querySelector('.ttdj');
      await until(()=>TalkToDJ.getStatus().pending===0);
      return {closedImmediately,readyWhilePending,queuedWhilePending,secondSent,staysClosedAfterErrors,handClosesImmediately,jumps,requests,settled:TalkToDJ.getStatus().pending===0};
    }finally{
      for(const reply of replies)reply.reject(new Error('Deliberate test rejection'));
      platform.PlayerAPI.sendSignal=originalSignal;
      if(nativePlay)nativePlay.play=originalPlay;
      Spicetify.showNotification=originalNotification;
      TalkToDJ.close();
    }
  })()`);
  console.log("Dismissal/background requests:", JSON.stringify({ outsideCloses, ...background }));
  for (const key of ['closedImmediately','readyWhilePending','queuedWhilePending','secondSent','staysClosedAfterErrors','handClosesImmediately','settled']) assert.ok(background[key], key);
  assert.equal(background.requests, 2);
  assert.equal(background.jumps, 1);

  const promptIndex = process.argv.indexOf("--prompt");
  if (promptIndex !== -1) {
    const prompt = process.argv[promptIndex + 1];
    assert.ok(prompt, "--prompt requires a music request");
    const live = await evaluate(`(async()=>{
      const player=Spicetify.Platform.PlayerAPI;
      let startedOutsideDJ=false;
      if(${process.argv.includes("--from-track")}){
        const state=player.getState(),track=[state.item,...(state.nextItems||[])].find(t=>t?.uri?.startsWith('spotify:track:'));
        if(!track)throw new Error('No track is available for the DJ startup check');
        await player.play({uri:track.uri},{featureIdentifier:'talk_to_dj_live_check',referrerIdentifier:'extension'},{});
        const deadline=Date.now()+10000;
        while(player.getState().context?.uri!==track.uri&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
        if(player.getState().context?.uri!==track.uri)throw new Error('Could not switch to ordinary track playback');
        startedOutsideDJ=true;
      }
      const before=new Set([player.getState().item,...(player.getState().nextItems||[])].map(t=>t?.metadata?.idj_request_id).filter(Boolean));
      const snapshots=[];
      const capture=()=>{
        const s=player.getState(),m=s.item?.metadata||{},raw=m.auxiliary_media||s.context?.metadata?.auxiliary_media;
        const aux=raw?new TextDecoder().decode(Uint8Array.from(atob(raw),c=>c.charCodeAt(0))):'';
        const sample={uri:s.item?.uri,title:s.item?.name,artists:s.item?.artists?.map(a=>a.name),provider:s.item?.provider,
          requestId:m.idj_request_id,response:s.context?.metadata?.interactivity_response,
          narration:m['narration.intro.ssml']||aux.match(/<speak[\\s\\S]*?<\\/speak>/)?.[0]};
        if(JSON.stringify(sample)!==JSON.stringify(snapshots.at(-1)))snapshots.push(sample);
      };
      Spicetify.Player.addEventListener('songchange',capture);
      try{
        capture();TalkToDJ.open();const input=document.querySelector('.ttdj textarea');input.value=${JSON.stringify(prompt)};
        input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.ttdj form').requestSubmit();
        const closedImmediately=!document.querySelector('.ttdj');
        const deadline=Date.now()+45000;
        do{
          await new Promise(r=>setTimeout(r,100));capture();
          const s=player.getState(),id=s.item?.metadata?.idj_request_id;
          if(!TalkToDJ.getStatus().pending&&id&&!before.has(id)&&!s.item?.uri?.startsWith('spotify:media:'))break;
        }while(Date.now()<deadline);
        const s=player.getState(),id=s.item?.metadata?.idj_request_id;
        return {closedImmediately,startedOutsideDJ,status:TalkToDJ.getStatus(),snapshots,applied:!!id&&!before.has(id),
          nativeContext:s.context?.metadata?.agentic_product_type==='idj'&&s.item?.provider==='context'};
      }finally{Spicetify.Player.removeEventListener('songchange',capture);}
    })()`);
    console.log("Native DJ prompt:", JSON.stringify(live));
    assert.ok(live.closedImmediately, "The panel did not close immediately on Send");
    assert.equal(live.status.lastError, null, "The live request failed");
    assert.ok(live.applied && live.nativeContext, "Spotify did not play a fresh native interactive DJ set");
    assert.ok(live.status.lastRequestId, "The extension did not verify the native request ID");
    assert.ok(live.snapshots.some(s => s.response === "acknowledge" && s.narration), "Spotify's native spoken acknowledgement was not observed");
    assert.ok(live.snapshots.some(s => s.requestId === live.status.lastRequestId && s.narration), "The requested set's native DJ introduction was not observed");
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
