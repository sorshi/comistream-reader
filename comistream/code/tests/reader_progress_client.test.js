const test = require('node:test');
const assert = require('node:assert/strict');
const progress = require('../reader_progress');
function fixture({ read = false, stored = null, fail = false } = {}) {
  let server = { state_id: 'a'.repeat(32), revision: 0, policy_epoch: 0, locator: '3',
    has_read: read, last_writer_id: null, last_writer_seq: 0, writer_base_revision: 0 };
  let position = '3', decision = true, clock = 100000;
  const storage = new Map();
  const key = 'comistream_progress:v1:user:book';
  if (stored) storage.set(key, JSON.stringify(stored));
  const requests = [], beacons = [], questions = [], timers = new Map(); let id = 0;
  const c = progress.create({ writerId: 'writer_A_123456789', file: 'book.cbz', userKey: 'user', bookKey: 'book',
    storage: { getItem: (k) => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    now: () => clock, timers: { setTimeout: (fn) => { timers.set(++id,fn); return id; }, clearTimeout: (i) => timers.delete(i) },
    compare: (a,b) => Math.sign(Number(a)-Number(b)), isStart: (v) => v === '1', getPosition: () => position,
    confirm: async (s) => { questions.push(s.locator); return decision; }, moveTo: async (v) => { position = v; },
    sendBeacon: (_,data) => { beacons.push(Object.fromEntries(data)); return true; },
    fetch: async (_, init) => {
      if (fail) throw new Error('offline');
      if (!init.body) return { ok: true, status: 200, json: async () => ({ok:true,state:{...server}}) };
      const op = Object.fromEntries(init.body); requests.push(op);
      if (Number(op.expected_revision) !== server.revision && server.last_writer_id !== op.writer_id) return {
        ok:false,status:409,json:async()=>({ok:false,result:'conflict',state:{...server}}) };
      const read = server.has_read || Boolean(op.completion_locator);
      server = { ...server, has_read:read, revision:server.revision+1,
        locator: read ? op.locator : String(Math.max(Number(server.locator),Number(op.furthest))),
        last_writer_id:op.writer_id,last_writer_seq:Number(op.seq) };
      return {ok:true,status:200,json:async()=>({ok:true,result:'applied',state:{...server}})};
    }
  });
  return { c, requests, beacons, questions, timers, storage, setPosition: (v)=>position=v,
    position:()=>position, decide:(v)=>decision=v, advance:()=>clock+=61000,
    server:()=>server, update:(patch)=>{server={...server,...patch};} };
}
test('opening and closing an unchanged reader sends no POST or beacon', async () => {
  const f=fixture(); await f.c.initialize(); await f.c.finish(); f.c.beacon();
  assert.equal(f.requests.length,0); assert.equal(f.beacons.length,0);
});
test('coalesced unread movements retain furthest position', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('20'); f.c.record('3'); await f.c.flush();
  assert.equal(f.requests[0].locator,'3'); assert.equal(f.requests[0].furthest,'20'); assert.equal(f.server().locator,'20');
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
test('read books also offer a newer backward position', async () => {
  const f=fixture({read:true}); await f.c.initialize(); f.setPosition('20');
  f.update({revision:1,locator:'1',last_writer_id:'writer_B'}); f.advance();
  assert.equal(await f.c.beforeNavigation(),false); assert.equal(f.position(),'1');
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
test('unread conflict can merge forward once', async () => {
  const f=fixture(); await f.c.initialize(); f.c.record('25'); f.update({revision:1,locator:'20',last_writer_id:'writer_B'});
  await f.c.flush(); assert.equal(f.requests.length,2); assert.equal(f.server().locator,'25');
});
test('offline startup never sends an unbased operation', async () => {
  const f=fixture({fail:true}); await f.c.initialize(); f.c.record('20'); await f.c.flush(); f.c.beacon();
  assert.equal(f.requests.length,0); assert.equal(f.beacons.length,0); assert.equal(f.c.getPending().unbased,true);
});
test('guest uses the same unread and completed resume rules', async () => {
  const map=new Map(); const c=progress.create({isGuest:true,userKey:'guest',bookKey:'book',legacyLocator:'3',
    storage:{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)},compare:(a,b)=>Number(a)-Number(b)});
  await c.initialize(); c.record('20'); c.record('3'); assert.equal(c.getState().locator,'20');
  c.record('30',{completed:true}); c.record('1'); assert.equal(c.getState().locator,'1'); assert.equal(c.getState().has_read,true);
});
