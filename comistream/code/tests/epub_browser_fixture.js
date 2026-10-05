const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chrome } = require('./browser_fixture');

// 外部moduleの読み込みと描画を実時間で待つ専用ブラウザルン。
async function runEpubBrowserFixture(url, { screenshotPath, viewport, verifyFrames } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comistream-epub-browser-'));
  let child, socket;
  const waiting = new Map(); let id = 0;
  const frames = [];
  try {
    child = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-extensions', '--disable-sync',
      '--remote-debugging-port=0', '--user-data-dir=' + root, 'about:blank'], { stdio: ['ignore','ignore','pipe'] });
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 5000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.stderr.on('data', data => {
        const match = data.toString().match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    socket = new WebSocket(address);
    await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const handler = waiting.get(message.id);
      if (handler) { waiting.delete(message.id); handler(message); }
      if (message.method === 'Page.screencastFrame') {
        const at = Date.now();
        if (!frames.length || at - frames.at(-1).at >= 100) frames.push({ at, data: message.params.data });
        void call('Page.screencastFrameAck', { sessionId: message.params.sessionId }, message.sessionId).catch(() => {});
      }
    });
    function call(method, params = {}, sessionId) {
      return new Promise((resolve,reject) => {
        const command = ++id;
        const timer = setTimeout(() => { waiting.delete(command); reject(new Error('Chrome command timeout: '+method)); },5000);
        waiting.set(command, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
        socket.send(JSON.stringify({ id:command,method,params,...(sessionId ? {sessionId} : {}) }));
      });
    }
    const { targetId } = await call('Target.createTarget',{url});
    const { sessionId } = await call('Target.attachToTarget',{targetId,flatten:true});
    if (viewport) await call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor:1, mobile:false }, sessionId);
    if (verifyFrames) await call('Page.startScreencast', { format: 'png', everyNthFrame: 1 }, sessionId);
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = await call('Runtime.evaluate',{expression:'window.__progressNativeResult || null',returnByValue:true},sessionId);
      const value = result.result?.value;
      if (value) {
        if (!value.ok) throw new Error(value.error);
        if (verifyFrames) {
          // main thread停止中の実フレームを、再開後に画素で検証するルン。
          const verified = await call('Runtime.evaluate', {
            expression: `(${verifyFrames.toString()})(${JSON.stringify(value)}, ${JSON.stringify(frames)})`,
            awaitPromise: true, returnByValue: true
          }, sessionId);
          if (verified.exceptionDetails) throw new Error(verified.exceptionDetails.exception?.description || verified.exceptionDetails.text);
        }
        if (screenshotPath) {
          const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId);
          fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
        }
        return;
      }
      await new Promise(resolve => setTimeout(resolve,100));
    }
    const info = await call('Runtime.evaluate',{expression:"document.getElementById('epub-status')?.textContent",returnByValue:true},sessionId);
    throw new Error('EPUB browser timeout: '+info.result?.value);
  } finally {
    socket?.close();
    if (child && child.exitCode === null) { child.kill(); await new Promise(resolve=>child.once('exit',resolve)); }
    fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}
module.exports = { runEpubBrowserFixture };
