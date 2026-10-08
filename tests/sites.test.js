import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleGameRequest, mutateRoom, restoreGame } from '../lib/room-service.mjs';
import { Game } from '../shared/game.js';
function database(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec('CREATE TABLE rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL, expires INTEGER NOT NULL); CREATE TABLE sessions (hash TEXT PRIMARY KEY, code TEXT NOT NULL, player TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL); CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE recent (key TEXT PRIMARY KEY, used INTEGER NOT NULL);');
  sql.prepare('INSERT INTO cache VALUES (?, ?, ?)').run('questions', '[]', Date.now()+600000);
  const db = { prepare(text) { let values=[]; return { bind(...v) { values=v; return this; }, async first() { return sql.prepare(text).get(...values) ?? null; }, async all() {return {results: sql.prepare(text).all(...values)};}, async run() {const result=sql.prepare(text).run(...values); return {meta:{changes:Number(result.changes)}};} }; }, async batch(statements) { sql.exec('BEGIN'); try {const results=[]; for(const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results;} catch(e) {sql.exec('ROLLBACK');throw e;} } };
  const post = async (path, body, token) => { const response = await handleGameRequest(new Request('https://game.test'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}),db); return {status:response.status,data:await response.json()}; };
  return { db, sql, post };
}
test('persisted rooms share sessions across independent requests and hide choices', async t => {
  const {db,post,sql}=database(t); const a=await post('/api/rooms',{name:'Alice'}); assert.equal(a.status,201);
  const b=await post('/api/join',{name:'Bob',code:a.data.state.code}); assert.equal(b.status,200);
  await post('/api/action',{action:'ready'},a.data.session); await post('/api/action',{action:'ready'},b.data.session);
  const start=await post('/api/action',{action:'start'},a.data.session); assert.equal(start.data.phase,'bidding');
  await post('/api/action',{action:'bid',amount:100,turn:start.data.turn},a.data.session);
  await post('/api/action',{action:'bid',amount:70,turn:start.data.turn},b.data.session);
  await mutateRoom(db,a.data.state.code,g=>g.tick(g.deadline));
  let g=restoreGame(sql.prepare('SELECT state FROM rooms').get().state);
  const wrong=g.question.choices.find(c=>c.text!==g.question.answers[0]);
  await post('/api/action',{action:'answer',turn:g.turn,choiceId:wrong.id},a.data.session);
  g=restoreGame(sql.prepare('SELECT state FROM rooms').get().state);
  const good=g.question.choices.find(c=>c.text===g.question.answers[0]);
  const result=await post('/api/action',{action:'answer',turn:g.turn,choiceId:good.id},b.data.session);
  assert.equal(result.data.players.find(p=>p.name==='Bob').score,1170);
  assert.ok(!JSON.stringify(result.data).includes('answers'));
  assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM sessions').all()).includes(a.data.session));
});
test('concurrent persisted buzzer mutations yield exactly one winner', async t=>{
  const {db,sql}=database(t); const g=new Game('BUZZ42');g.addPlayer('a','Alice');g.addPlayer('b','Bob');g.phase='bonus-buzz';g.question=g.nextQuestion();g.deadline=Date.now()+20000;
  sql.prepare('INSERT INTO rooms VALUES (?,?,?,?)').run(g.code,JSON.stringify(g),0,Date.now()+60000);
  const outcomes=await Promise.allSettled(['a','b'].map(id=>mutateRoom(db,g.code,game=>game.action(id,'buzz',{turn:g.turn}))));
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1); assert.equal(outcomes.filter(o=>o.status==='rejected').length,1);
  const saved=restoreGame(sql.prepare('SELECT state FROM rooms').get().state); assert.equal(saved.phase,'bonus-answer');assert.ok(['a','b'].includes(saved.activeId));
});
test('concurrent joins preserve both players and validation enforces host categories',async t=>{
 const {post,sql}=database(t);const a=await post('/api/rooms',{name:'Host'});
 const joins=await Promise.all(['Bob','Carol'].map(name=>post('/api/join',{name,code:a.data.state.code}))); assert.ok(joins.every(r=>r.status===200));
 assert.equal(restoreGame(sql.prepare('SELECT state FROM rooms').get().state).players.length,3);
 const categories=['Space','History','Gaming','Motorsport'];
 assert.equal((await post('/api/action',{action:'categories',categories},joins[0].data.session)).status,400);
 assert.equal((await post('/api/action',{action:'categories',categories:categories.slice(0,3)},a.data.session)).status,400);
 const selected=await post('/api/action',{action:'categories',categories},a.data.session);assert.equal(selected.status,200);assert.equal(selected.data.questionSource.status,'ready');assert.equal(selected.data.questionSource.mayRepeat,true);
 const game=restoreGame(sql.prepare('SELECT state FROM rooms').get().state);assert.equal(game.deck.length,80);assert.ok(game.deck.every(q=>categories.includes(q.category)));
});
test('invalid sessions and cross-origin mutations are rejected',async t=>{
 const {db,post}=database(t);assert.equal((await post('/api/action',{action:'ready'},'invalid')).status,401);
 const r=await handleGameRequest(new Request('https://game.test/api/rooms',{method:'POST',headers:{Origin:'https://elsewhere.test'},body:'{}'}),db);assert.equal(r.status,403);
});
