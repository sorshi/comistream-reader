const test = require('node:test');
const assert = require('node:assert/strict');
const progress = require('../reader_progress');
function fixture({ read = false, stored = null, fail = false } = {}) {
  let server = { state_id: 'a'.repeat(32), revision: 0, policy_epoch: 0, locator: '3',
    has_read: read, last_writer_id: null, last_writer_seq: 0, writer_base_revision: 0, resume_policy:'last_position' };
  let position = '3', decision = true, clock = 100000;
  const storage = new Map();
  const key = 'comistream_progress:v1:user:book';
  if (stored) storage.set(key, JSON.stringify(stored));
  const requests = [], beacons = [], questions = [], alerts = [], errors = [], timers = new Map(); let id = 0;
  let refreshGate = null, failRefresh = false;
  const c = progress.create({ writerId: 'writer_A_123456789', file: 'book.cbz', userKey: 'user', bookKey: 'book',
    storage: { getItem: (k) => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    now: () => clock, timers: { setTimeout: (fn) => { timers.set(++id,fn); return id; }, clearTimeout: (i) => timers.delete(i) },
    compare: (a,b) => Math.sign(Number(a)-Number(b)), isStart: (v) => v === '1', getPosition: () => position,
    confirm: async (s) => { questions.push(s.locator); return decision; }, moveTo: async (v) => { position = v; },
    onUnsynced: () => alerts.push('unsynced'), onError: (error) => errors.push(error.message),
    sendBeacon: (_,data) => { beacons.push(Object.fromEntries(data)); return true; },
    fetch: async (_, init) => {
      if (fail) throw new Error('offline');
      if (!init.body) {
        if (refreshGate) await refreshGate;
        if (failRefresh) throw new Error('refresh unavailable');
        return { ok: true, status: 200, json: async () => ({ok:true,state:{...server}}) };
      }
      const op = Object.fromEntries(init.body); requests.push(op);
      if (Number(op.expected_revision) !== server.revision && server.last_writer_id !== op.writer_id) return {
        ok:false,status:409,json:async()=>({ok:false,result:'conflict',state:{...server}}) };
      const read = server.has_read || Boolean(op.completion_locator);
      server = { ...server, has_read:read, revision:server.revision+1,
        locator: op.locator,
        last_writer_id:op.writer_id,last_writer_seq:Number(op.seq) };
      return {ok:true,status:200,json:async()=>({ok:true,result:'applied',state:{...server}})};
    }
  });
  return { c, requests, beacons, questions, alerts, errors, timers, storage, setPosition: (v)=>position=v,
    pauseRefresh: () => {
      let release;
      refreshGate = new Promise(resolve => { release = resolve; });
      return () => { refreshGate = null; release(); };
    }, failRefresh: () => { failRefresh = true; },
    position:()=>position, decide:(v)=>decision=v, advance:()=>clock+=61000,
    server:()=>server, update:(patch)=>{server={...server,...patch};} };
}
test('opening and closing an unchanged reader sends no POST or beacon', async () => {
  const f=fixture(); await f.c.initialize(); await f.c.finish(); f.c.beacon();
  assert.equal(f.requests.length,0); assert.equal(f.beacons.length,0);
});
test('coalesced unread preview and return save the last position', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('20'); f.c.record('3'); await f.c.flush();
  assert.equal(f.requests[0].locator,'3'); assert.equal(f.requests[0].furthest,undefined);
  assert.equal(f.requests[0].resume_policy,'last_position'); assert.equal(f.server().locator,'3');
});
test('completion followed immediately by cover preserves both values', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('30',{completed:true}); f.c.record('1'); await f.c.flush();
  assert.equal(f.server().locator,'1'); assert.equal(f.server().has_read,true); assert.equal(f.c.getPending(),null);
});
test('a newer foreign position is adopted without repeating the triggering navigation', async () => {
  const f=fixture(); await f.c.initialize(); f.update({revision:1,locator:'20',last_writer_id:'writer_B'}); f.advance();
  assert.equal(await f.c.beforeNavigation(),false); assert.equal(f.position(),'20'); assert.deepEqual(f.questions,['20']);
  assert.equal(f.requests.length,0);
});
test('unread and read books both offer a newer backward position', async () => {
  for (const read of [false,true]) {
    const f=fixture({read}); await f.c.initialize(); f.setPosition('20');
    f.update({revision:1,locator:'1',last_writer_id:'writer_B'}); f.advance();
    assert.equal(await f.c.beforeNavigation(),false); assert.equal(f.position(),'1');
  }
});
test('declining one update still allows notification for the next update', async () => {
  const f=fixture(); await f.c.initialize(); f.decide(false); f.update({revision:1,locator:'20',last_writer_id:'writer_B'}); f.advance();
  assert.equal(await f.c.beforeNavigation(),true); assert.equal(await f.c.beforeNavigation(),true); assert.equal(f.requests.length,0);
  f.update({revision:2,locator:'25',last_writer_id:'writer_B'}); f.advance(); await f.c.beforeNavigation();
  assert.deepEqual(f.questions,['20','25']);
});
test('read conflict is held and never rebased automatically', async () => {
  const f=fixture({read:true}); await f.c.initialize(); f.c.record('10'); f.update({revision:1,locator:'20',last_writer_id:'writer_B'});
  await f.c.flush(); f.c.beacon(); assert.equal(f.requests.length,1); assert.equal(f.beacons.length,0); assert.equal(f.server().locator,'20');
});
test('unread conflict is held without automatic forward merging', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('25'); f.update({revision:1,locator:'20',last_writer_id:'writer_B'});
  assert.equal(await f.c.flush(),false); f.c.beacon();
  assert.equal(f.requests.length,1); assert.equal(f.server().locator,'20');
  assert.equal(f.c.getPending().locator,'25'); assert.equal(f.beacons.length,0);
});
test('offline startup never sends an unbased operation', async () => {
  const f=fixture({fail:true}); await f.c.initialize(); f.c.record('20'); await f.c.flush(); f.c.beacon();
  assert.equal(f.requests.length,0); assert.equal(f.beacons.length,0); assert.equal(f.c.getPending().unbased,true);
});
test('guest uses the same unread and completed resume rules', async () => {
  const map=new Map(); const c=progress.create({isGuest:true,userKey:'guest',bookKey:'book',legacyLocator:'3',
    storage:{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)},compare:(a,b)=>Number(a)-Number(b)});
  await c.initialize(); c.record('20'); c.record('3'); assert.equal(c.getState().locator,'3');
  c.record('30',{completed:true}); c.record('1'); assert.equal(c.getState().locator,'1'); assert.equal(c.getState().has_read,true);
});


test('an acknowledged save cannot regress to an older cached GET revision', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('20'); await f.c.flush();
  assert.equal(f.c.getState().revision,1);
  await f.c.beforeNavigation();
  assert.equal(f.c.getState().revision,1); assert.equal(f.c.getState().locator,'20');
});


test('new movement after observing the same remote position uses the observed revision', async () => {
  const f=fixture({read:true}); await f.c.initialize(); f.c.record('10'); f.setPosition('10');
  f.update({revision:1,locator:'10',last_writer_id:'writer_B'}); f.advance();
  assert.equal(await f.c.beforeNavigation(),true); assert.equal(f.questions.length,0);
  f.c.record('20'); await f.c.flush();
  assert.equal(f.requests.length,1); assert.equal(f.requests[0].expected_revision,'1');
  assert.equal(f.server().locator,'20');
});

function focusReader(f) {
  const listeners = new Map();
  f.c.bindLifecycle({ addEventListener: (name, listener) => listeners.set(name, listener) }, null);
  listeners.get('focus')();
}

test('finish waits for an in-flight focus refresh before saving', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('20');
  const release=f.pauseRefresh(); focusReader(f);
  let finished=false;
  const closing=f.c.finish().then(result => { finished=true; return result; });
  try {
    await new Promise(setImmediate);
    assert.equal(finished,false);
    assert.equal(f.requests.length,0); assert.deepEqual(f.alerts,[]);
  } finally { release(); }
  assert.equal(await closing,true);
  assert.equal(f.server().locator,'20'); assert.equal(f.requests.length,1);
  assert.equal(f.c.getPending(),null); assert.deepEqual(f.alerts,[]);
});

test('finish after a failed focus refresh preserves pending progress and warns', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('20');
  const release=f.pauseRefresh(); f.failRefresh(); focusReader(f);
  const closing=f.c.finish(); release();
  assert.equal(await closing,false);
  assert.equal(f.requests.length,0); assert.equal(f.beacons.length,0);
  assert.equal(f.c.getPending().locator,'20'); assert.deepEqual(f.alerts,['unsynced']);
  assert.ok(f.errors.includes('refresh unavailable'));
});

test('finish after focus refresh does not overwrite a foreign read position', async () => {
  const f=fixture({read:true}); await f.c.initialize(); f.c.record('10');
  f.update({revision:1,locator:'20',last_writer_id:'writer_B'});
  const release=f.pauseRefresh(); focusReader(f);
  const closing=f.c.finish(); release();
  assert.equal(await closing,false);
  assert.equal(f.requests.length,1); assert.equal(f.beacons.length,0);
  assert.equal(f.server().locator,'20'); assert.equal(f.c.getPending().locator,'10');
  assert.deepEqual(f.questions,[]); assert.deepEqual(f.alerts,['unsynced']);
});

test('finish after focus refresh holds an unread conflict for reader choice', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('25');
  f.update({revision:1,locator:'20',last_writer_id:'writer_B'});
  const release=f.pauseRefresh(); focusReader(f);
  const closing=f.c.finish(); release();
  assert.equal(await closing,false); assert.equal(f.requests.length,1);
  assert.equal(f.server().locator,'20'); assert.equal(f.c.getPending().locator,'25');
  assert.deepEqual(f.alerts,['unsynced']);
});

test('a saved unread preview followed by backward reading resumes at the new last position', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('20'); await f.c.flush();
  f.c.record('3'); f.c.record('5'); assert.equal(await f.c.finish(),true);
  assert.equal(f.server().locator,'5'); assert.equal(f.server().has_read,false);
});

test('an idle stale tab does not overwrite a newer backward position when closed', async () => {
  const f=fixture(); await f.c.initialize();
  f.update({revision:1,locator:'1',last_writer_id:'writer_B'});
  assert.equal(await f.c.finish(),true); f.c.beacon();
  assert.equal(f.requests.length,0); assert.equal(f.beacons.length,0); assert.equal(f.server().locator,'1');
});

test('declining a foreign backward position saves only the next explicit movement', async () => {
  const f=fixture(); await f.c.initialize(); f.decide(false);
  f.update({revision:1,locator:'1',last_writer_id:'writer_B'}); f.advance();
  assert.equal(await f.c.beforeNavigation(),true); assert.deepEqual(f.questions,['1']);
  assert.equal(f.requests.length,0);
  f.c.record('2'); await f.c.flush();
  assert.equal(f.requests[0].expected_revision,'1'); assert.equal(f.server().locator,'2');
});

test('finish keeps its deadline while focus refresh is stalled', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('20');
  const release=f.pauseRefresh(); focusReader(f);
  const closing=f.c.finish();
  try {
    [...f.timers.values()].at(-1)();
    assert.equal(await closing,false);
    assert.equal(f.requests.length,0); assert.equal(f.c.getPending().locator,'20');
    assert.deepEqual(f.alerts,['unsynced']);
  } finally {
    release(); await f.c.refresh(); await f.c.flush();
  }
});

test('old unsynced operations require reader choice even after local storage migration', async () => {
  const pending={state_id:'a'.repeat(32),policy_epoch:0,expected_revision:0,
    writer_id:'writer_A_123456789',seq:9,locator:'10',furthest:'20'};
  const f=fixture({stored:{version:1,state:null,pending}}); await f.c.initialize();
  assert.equal(f.requests.length,0); assert.equal(f.c.getPending().legacy_policy,true);
  const stored=JSON.parse([...f.storage.values()][0]); assert.equal(stored.version,2);
  const reopened=fixture({stored}); await reopened.c.initialize();
  assert.equal(reopened.requests.length,0); assert.equal(reopened.c.getPending().legacy_policy,true);
  assert.equal(reopened.c.getState().locator,'3'); assert.equal(reopened.c.getRestoreLocator(),'10');
  reopened.decide(false); assert.equal(await reopened.c.beforeNavigation(),true);
  assert.deepEqual(reopened.questions,['3']); assert.equal(reopened.requests.length,0);
  reopened.c.record('2'); assert.equal(await reopened.c.flush(),true);
  assert.equal(reopened.requests[0].seq,'10'); assert.equal(reopened.requests[0].resume_policy,'last_position');
  assert.equal(reopened.requests[0].legacy_policy,undefined); assert.equal(reopened.server().locator,'2');
});

test('acknowledged old operations are cleared without replaying their old policy', async () => {
  const pending={state_id:'a'.repeat(32),policy_epoch:0,expected_revision:0,
    writer_id:'writer_A_123456789',seq:9,locator:'10',furthest:'20'};
  const f=fixture({stored:{version:1,state:null,pending}});
  f.update({revision:1,locator:'20',last_writer_id:pending.writer_id,last_writer_seq:9});
  await f.c.initialize(); assert.equal(f.c.getPending(),null); assert.equal(f.requests.length,0);
  assert.equal(f.c.getState().locator,'20');
  assert.equal(f.c.getRestoreLocator(),'20');
});

test('offline conflicting progress is restored locally without replacing the shared position', async () => {
  const pending={state_id:'a'.repeat(32),policy_epoch:0,expected_revision:0,
    writer_id:'offline_writer_12345',seq:1,locator:'10'};
  const f=fixture({stored:{version:2,state:null,pending}});
  f.update({revision:1,locator:'2',last_writer_id:'writer_B'});
  await f.c.initialize();
  assert.equal(f.c.getState().locator,'2'); assert.equal(f.c.getRestoreLocator(),'10');
  f.setPosition(f.c.getRestoreLocator());
  assert.equal(await f.c.beforeNavigation(),false); assert.equal(f.position(),'2');
  assert.equal(f.requests.length,0); assert.equal(f.c.getPending(),null);
});

test('new clients refuse a server that still advertises the old resume policy', async () => {
  const f=fixture(); f.update({resume_policy:'furthest'}); await f.c.initialize();
  f.c.record('20'); assert.equal(await f.c.finish(),false);
  assert.equal(f.requests.length,0); assert.equal(f.beacons.length,0);
  assert.ok(f.errors.includes('reader_update_required'));
});
