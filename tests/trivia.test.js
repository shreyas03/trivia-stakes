import test from 'node:test';
import assert from 'node:assert/strict';
import { TriviaProvider, parseLiveQuestion, questionKey } from '../server/trivia.js';
import { QUESTIONS } from '../shared/questions.js';

function row(n = 0, prefix = 'Fresh') {
  return { type: 'multiple', difficulty: 'medium', category: encodeURIComponent('Entertainment: Film'), question: encodeURIComponent(`${prefix} question ${n}: who said "hello"?`), correct_answer: encodeURIComponent(`Correct ${n}`), incorrect_answers: ['Wrong A', 'Wrong B', 'Wrong C'].map(encodeURIComponent) };
}
function mockService(batches = [Array.from({ length: 50 }, (_, n) => row(n))]) {
  let time = 0, batch = 0;
  const calls = [];
  const provider = new TriviaProvider({
    now: () => time,
    wait: async ms => { time += ms; },
    fetchFn: async url => {
      calls.push({ url: new URL(url), time });
      const data = url.includes('api_token.php') ? { response_code: 0, token: 'validToken12345' } : { response_code: 0, results: batches[Math.min(batch++, batches.length - 1)] };
      return { ok: true, json: async () => data };
    },
  });
  return { provider, calls, advance: ms => time += ms };
}
test('decodes live text, maps categories, preserves four options and includes credit', () => {
  const question = parseLiveQuestion(row());
  assert.equal(question.category, 'Movies'); assert.equal(question.text, 'Fresh question 0: who said "hello"?');
  assert.deepEqual(question.options, ['Correct 0', 'Wrong A', 'Wrong B', 'Wrong C']);
  assert.equal(question.source.license, 'CC BY-SA 4.0');
});
test('rejects wrong difficulty, malformed encodings, wrong option counts and duplicate options', () => {
  for (const bad of [
    { ...row(), difficulty: 'easy' }, { ...row(), type: 'boolean' },
    { ...row(), question: '%NOTENCODED' }, { ...row(), incorrect_answers: ['one'] },
    { ...row(), correct_answer: '' }, { ...row(), incorrect_answers: ['Correct%200', 'two', 'three'] },
  ]) assert.equal(parseLiveQuestion(bad), null);
});
test('requests medium multiple-choice batches with a token and respects five-second spacing', async () => {
  const { provider, calls } = mockService(); const { deck, info } = await provider.loadDeck();
  assert.equal(deck.length, 80); assert.equal(info.liveCount, 50); assert.equal(info.curatedCount, 30);
  assert.equal(calls.length, 2); assert.ok(calls[1].time - calls[0].time >= 5000);
  assert.equal(calls[1].url.searchParams.get('difficulty'), 'medium');
  assert.equal(calls[1].url.searchParams.get('type'), 'multiple');
  assert.equal(calls[1].url.searchParams.get('amount'), '50');
  assert.equal(calls[1].url.searchParams.get('encode'), 'url3986');
  assert.equal(calls[1].url.searchParams.get('token'), 'validToken12345');
  assert.ok(deck.some(q => q.category === 'Motorsport' || !q.source));
});
test('concurrent lobbies share one refresh and all receive a complete unique deck', async () => {
  const { provider, calls } = mockService();
  const decks = await Promise.all([provider.loadDeck(), provider.loadDeck(), provider.loadDeck()]);
  assert.equal(calls.length, 2);
  for (const { deck } of decks) { assert.equal(deck.length, 80); assert.equal(new Set(deck.map(questionKey)).size, 80); }
});
test('outage falls back immediately to all curated questions and suppresses repeated retries', async () => {
  let calls = 0;
  const provider = new TriviaProvider({ fetchFn: async () => { calls++; throw new Error('offline'); } });
  const first = await provider.loadDeck(), second = await provider.loadDeck();
  assert.equal(first.info.mode, 'local'); assert.equal(first.deck.length, 80); assert.equal(second.deck.length, 80);
  assert.equal(calls, 1); assert.ok(!first.info.attribution);
});
test('offline mode makes no network requests and recently played local questions go last', async () => {
  const provider = new TriviaProvider({ enabled: false, fetchFn: () => { throw new Error('Must not fetch'); } });
  const used = QUESTIONS.slice(0, 8);
  for (const q of used) provider.recordUsed(q);
  const { deck, info } = await provider.loadDeck();
  assert.equal(info.mode, 'local'); assert.equal(deck.length, 80);
  for (const q of deck.slice(0, 72)) assert.ok(!used.some(old => questionKey(old) === questionKey(q)));
});
test('live repeats and duplicate rows are filtered, with local top-up for incomplete batches', async () => {
  const duplicate = row(0), fresh = row(1);
  const { provider } = mockService([[duplicate, duplicate, fresh, { ...row(2), difficulty: 'hard' }]]);
  provider.recordUsed(parseLiveQuestion(duplicate));
  const { deck, info } = await provider.loadDeck();
  assert.equal(info.liveCount, 1); assert.equal(deck.length, 80);
  assert.ok(!deck.some(q => questionKey(q) === questionKey(parseLiveQuestion(duplicate))));
});
test('expired or exhausted tokens are discarded and the current lobby remains playable', async () => {
  const provider = new TriviaProvider({ wait: async () => {}, fetchFn: async url => ({ ok: true, json: async () => url.includes('api_token.php') ? { response_code: 0, token: 'validToken12345' } : { response_code: 4 } }) });
  const { deck, info } = await provider.loadDeck();
  assert.equal(provider.token, null); assert.equal(info.mode, 'local'); assert.equal(deck.length, 80);
});

test('selected categories filter live and fallback questions and fill a worst-case game', async () => {
  const categories = ['Space', 'History', 'Gaming', 'Motorsport'];
  const { provider } = mockService();
  const { deck, info } = await provider.loadDeck(categories);
  assert.equal(deck.length, 80); assert.equal(info.liveCount, 0);
  assert.equal(info.uniqueCount, 32); assert.equal(info.mayRepeat, true);
  assert.ok(deck.every(q => categories.includes(q.category)));
  assert.equal(new Set(deck.slice(0, 32).map(questionKey)).size, 32);
});
