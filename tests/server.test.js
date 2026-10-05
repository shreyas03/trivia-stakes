import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.js';
import { TriviaProvider } from '../server/trivia.js';

async function fixture(t, questionProvider = new TriviaProvider({ enabled: false })) {
  const app = createGameServer({ questionProvider });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (path, data, token) => {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  };
  return { ...app, origin, post };
}
test('two independent sessions join, ready, start, bid and see the same authoritative state', async t => {
  const { post, origin } = await fixture(t);
  const a = (await post('/api/rooms', { name: 'Alice' })).data;
  const b = (await post('/api/join', { name: 'Bob', code: a.state.code.toLowerCase() })).data;
  assert.notEqual(a.session, b.session); assert.notEqual(a.state.you, b.state.you);
  await post('/api/action', { action: 'ready' }, a.session); await post('/api/action', { action: 'ready' }, b.session);
  const start = await post('/api/action', { action: 'start' }, a.session);
  assert.equal(start.status, 200); assert.equal(start.data.phase, 'bidding');
  const bid = await post('/api/action', { action: 'bid', amount: 100, turn: start.data.turn }, b.session);
  assert.equal(bid.status, 200);
  const view = await (await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${a.session}` } })).json();
  assert.equal(view.players.find(p => p.id === b.state.you).bid, 100);
  assert.equal(view.question, null); assert.ok(!JSON.stringify(view).includes('answers'));
});
test('SSE sends individualized state and reconnect restores the same player', async t => {
  const { post, origin } = await fixture(t);
  const a = (await post('/api/rooms', { name: 'Alice' })).data;
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${origin}/api/events?session=${a.session}`, { signal: controller.signal });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader(); const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.ok(text.includes('event: state')); assert.ok(text.includes(a.state.you));
  controller.abort();
  const view = await (await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${a.session}` } })).json();
  assert.equal(view.you, a.state.you); assert.equal(view.players.length, 1);
});
test('concurrent buzzer requests yield exactly one winner', async t => {
  const { post, rooms } = await fixture(t);
  const a = (await post('/api/rooms', { name: 'Alice' })).data;
  const b = (await post('/api/join', { name: 'Bob', code: a.state.code })).data;
  const game = rooms.get(a.state.code);
  game.phase = 'bonus-buzz'; game.question = game.nextQuestion(); game.pool = 100; game.deadline = Date.now() + 20000;
  const responses = await Promise.all([post('/api/action', { action: 'buzz', turn: game.turn }, a.session), post('/api/action', { action: 'buzz', turn: game.turn }, b.session)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]); assert.equal(game.phase, 'bonus-answer');
});
test('server ticks before accepting a late answer; late input cannot award points', async t => {
  const { post, rooms } = await fixture(t);
  const a = (await post('/api/rooms', { name: 'Alice' })).data;
  const game = rooms.get(a.state.code);
  game.phase = 'answer'; game.activeId = a.state.you; game.question = game.nextQuestion(); game.player(a.state.you).bid = 100; game.deadline = Date.now() - 1;
  const choiceId = game.question.choices.find(c => c.text === game.question.answers[0]).id;
  const result = await post('/api/action', { action: 'answer', choiceId, turn: game.turn }, a.session);
  assert.equal(result.status, 400); assert.equal(game.player(a.state.you).score, 900); assert.equal(game.pool, 100);
});
test('invalid sessions, duplicate names, cross-origin mutations and path traversal are rejected', async t => {
  const { post, origin } = await fixture(t);
  assert.equal((await post('/api/action', { action: 'ready' }, 'invalid')).status, 401);
  const a = (await post('/api/rooms', { name: 'Alice' })).data;
  assert.equal((await post('/api/join', { code: a.state.code, name: 'alice' })).status, 400);
  const crossOrigin = await fetch(`${origin}/api/rooms`, { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Intruder' }) });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await fetch(`${origin}/server/index.js`)).status, 404);
  const page = await fetch(origin); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
});
test('question loading blocks start, broadcasts readiness, and requires no fetch during play', async t => {
  let resolveDeck, calls = 0;
  const loading = new Promise(resolve => { resolveDeck = resolve; });
  const { post, origin, rooms } = await fixture(t, { loadDeck: () => { calls++; return loading; }, recordUsed: () => {} });
  const a = (await post('/api/rooms', { name: 'Alice' })).data;
  const b = (await post('/api/join', { name: 'Bob', code: a.state.code })).data;
  assert.equal(a.state.questionSource.status, 'loading');
  await post('/api/action', { action: 'ready' }, a.session); await post('/api/action', { action: 'ready' }, b.session);
  assert.equal((await post('/api/action', { action: 'start' }, a.session)).status, 400);
  const game = rooms.get(a.state.code);
  resolveDeck({ deck: game.deck, info: { status: 'ready', mode: 'local', liveCount: 0, curatedCount: 80 } });
  const state = await (await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${a.session}` } })).json();
  assert.equal(state.questionSource.status, 'ready'); assert.ok(!JSON.stringify(state).includes('options'));
  assert.equal((await post('/api/action', { action: 'start' }, a.session)).status, 200);
  game.tick(game.deadline); game.tick(game.deadline); assert.equal(calls, 1);
});
test('rematch preloads a new deck instead of replaying the first game deck', async t => {
  const provider = new TriviaProvider({ enabled: false }); let loads = 0;
  const { post, rooms } = await fixture(t, { loadDeck: () => { loads++; return provider.loadDeck(); }, recordUsed: q => provider.recordUsed(q) });
  const a = (await post('/api/rooms', { name: 'Alice' })).data;
  const game = rooms.get(a.state.code); game.phase = 'finished';
  const result = await post('/api/action', { action: 'rematch' }, a.session);
  assert.equal(result.status, 200); assert.equal(result.data.phase, 'lobby'); assert.equal(loads, 2);
});

test('latest category selection wins when asynchronous preparations finish out of order', async t => {
  const pending = [];
  const { post, rooms } = await fixture(t, { loadDeck: categories => new Promise(resolve => pending.push({ categories, resolve })) });
  const a = (await post('/api/rooms', { name: 'Host' })).data;
  const one = ['Space', 'History', 'Gaming', 'Motorsport'];
  const two = ['Movies', 'Books', 'Music', 'Science'];
  await post('/api/action', { action: 'categories', categories: one }, a.session);
  await post('/api/action', { action: 'categories', categories: two }, a.session);
  const { QUESTIONS } = await import('../shared/questions.js');
  const finish = entry => entry.resolve({ deck: QUESTIONS.filter(q => entry.categories.includes(q.category)), info: { status: 'ready', mode: 'local' } });
  finish(pending[2]); await new Promise(resolve => setImmediate(resolve));
  finish(pending[0]); finish(pending[1]); await new Promise(resolve => setImmediate(resolve));
  const game = rooms.get(a.state.code);
  assert.deepEqual(new Set(game.categories), new Set(two));
  assert.ok(game.deck.every(q => two.includes(q.category)));
  assert.equal(game.questionSource.status, 'ready');
});
