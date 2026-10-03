const test = require('node:test');
const fs = require('node:fs');
const { withPhpFixture } = require('./http_fixture');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');
const { router } = require('./reader_progress_http_fixture');
const source = fs.readFileSync(require.resolve('../reader_progress.js'), 'utf8');
const harness = `${source}
(async () => {
  function expect(value, message) { if (!value) throw new Error(message); }
  const endpoint = location.origin;
  const positions = { A:'3', B:'3' };
  const storage = new Map();
  function reader(name) {
    return ComistreamReaderProgress.create({
      endpoint, file:'book.cbz', userKey:name, bookKey:'book', csrfToken:'fixture-token',
      writerId:'browser_writer_' + name + '_123456789',
      storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
      compare:(a,b)=>Math.sign(Number(a)-Number(b)),
      getPosition:()=>positions[name], confirm:()=>true,
      moveTo:async v=>{positions[name]=v;}
    });
  }
  const A=reader('A'), B=reader('B');
  await A.initialize(); await B.initialize();
  A.record('20'); expect(await A.flush(), 'A save failed');
  B.record('10'); await B.flush();
  expect(B.getState().locator === '20', 'Unread progress moved backward');
  await fetch(endpoint + '/?mode=testRead');
  const C=reader('C'); await C.initialize();
  C.record('30',{completed:true}); C.record('1'); await C.flush();
  const D=reader('D'); const state=await D.initialize();
  expect(state.has_read && state.locator === '1', 'Completed cover was not restored');
  expect([...storage.values()].map(v=>JSON.parse(v)).every(v=>!v.pending), 'Confirmed saves remain pending');
  window.__progressNativeResult={ok:true};
})().catch(error=>{window.__progressNativeResult={ok:false,error:error.stack};});
`;
const browserRouter = router.replace("if ($mode === 'testRead')", `
if ($mode === 'testClient') {
    header('Content-Type: text/html; charset=UTF-8');
    echo '<!doctype html><meta charset="utf-8"><script>' . json_decode(${JSON.stringify(JSON.stringify(harness))}) . '</script>'; exit;
}
if ($mode === 'testRead')`);
test('Chrome readers synchronize unread progress and completed cover through PHP', { skip: !chrome }, async () => {
  await withPhpFixture(browserRouter, async url => {
    await runEpubBrowserFixture(url + '/?mode=testClient');
  });
});
