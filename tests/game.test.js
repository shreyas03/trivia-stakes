import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULES, GameError } from '../shared/game.js';
import { QUESTIONS, isCorrect } from '../shared/questions.js';

function setup(count = 4) {
  const game = new Game('TEST42', { now: 0, deck: [...QUESTIONS] });
  for (let n = 0; n < count; n++) { game.addPlayer(`p${n}`, `Player ${n}`, 0); game.action(`p${n}`, 'ready', {}, 0); }
  game.action('p0', 'start', {}, 0);
  return game;
}
function bid(game, id, amount) { game.action(id, 'bid', { amount, turn: game.turn }, 1); }
function answer(game, id, value) { game.action(id, 'answer', { answer: value, turn: game.turn }, game.deadline - 1); }
function openBonus(game) {
  for (const p of game.players) game.action(p.id, 'ready', {}, game.updatedAt + 1);
  assert.equal(game.phase, 'bonus-countdown'); game.tick(game.deadline);
  assert.equal(game.phase, 'bonus-buzz');
}

test('highest bidder wins their bid without losing their stake first', () => {
  const game = setup(); bid(game, 'p0', 100); bid(game, 'p1', 70); game.tick(game.deadline);
  answer(game, 'p0', game.question.answers[0]);
  assert.equal(game.player('p0').score, 1100); assert.equal(game.player('p1').score, 1000);
  assert.equal(game.phase, 'result'); assert.equal(game.pool, 0);
});
test('a miss adds the stake to the pool; next correct earns bid + pool exactly once', () => {
  const game = setup(); bid(game, 'p0', 100); bid(game, 'p1', 70); game.tick(game.deadline);
  answer(game, 'p0', 'incorrect'); assert.equal(game.player('p0').score, 900); assert.equal(game.pool, 100);
  const turn = game.turn; answer(game, 'p1', game.question.answers[0]);
  assert.equal(game.player('p1').score, 1170); assert.equal(game.result.reward, 170);
  assert.throws(() => game.action('p1', 'answer', { answer: 'Mars', turn }), GameError);
  assert.equal(game.player('p1').score, 1170);
});
test('tied bids use the time of the current bid; raising cannot regain an earlier position', () => {
  const game = setup(); bid(game, 'p0', 100); bid(game, 'p1', 200); bid(game, 'p0', 200);
  game.tick(game.deadline); assert.equal(game.activeId, 'p1');
});
test('bid validation prevents overdrafts, decreases, fractions, and out-of-range amounts', () => {
  const game = setup();
  for (const amount of [0, 40, 310, 55, 50.5, 'nonsense']) assert.throws(() => bid(game, 'p0', amount), GameError);
  bid(game, 'p0', 100); assert.throws(() => bid(game, 'p0', 90), GameError);
  game.player('p1').score = 60; assert.throws(() => bid(game, 'p1', 70), GameError);
});
test('category-only view never reveals the question or accepted answers while bidding', () => {
  const game = setup(); const view = game.view('p0');
  assert.equal(view.category, 'Space'); assert.equal(view.question, null);
  assert.ok(!JSON.stringify(view).includes('Mars')); bid(game, 'p0', 50); game.tick(game.deadline);
  assert.ok(game.view('p0').question.text); assert.ok(!('answers' in game.view('p0').question));
});
test('all normal misses start bonus; passers can buzz and win the entire pool', () => {
  const game = setup(); bid(game, 'p0', 100); bid(game, 'p1', 70); game.tick(game.deadline);
  answer(game, 'p0', 'no'); answer(game, 'p1', 'no');
  assert.equal(game.phase, 'bonus-intro'); assert.equal(game.pool, 170); openBonus(game);
  game.action('p3', 'buzz', { turn: game.turn }, game.deadline - 1);
  answer(game, 'p3', game.question.answers[0]); assert.equal(game.player('p3').score, 1170);
  assert.equal(game.result.reward, 170); assert.equal(game.pool, 0);
});
test('a bonus miss eliminates the player across fresh questions and applies no extra penalty', () => {
  const game = setup(); bid(game, 'p0', 100); game.tick(game.deadline); answer(game, 'p0', 'no'); openBonus(game);
  const question = game.question.id, score = game.player('p2').score;
  game.action('p2', 'buzz', { turn: game.turn }, game.deadline - 1); answer(game, 'p2', 'no');
  assert.equal(game.player('p2').score, score); assert.notEqual(game.question.id, question);
  assert.ok(game.eliminated.includes('p2')); game.tick(game.deadline);
  assert.throws(() => game.action('p2', 'buzz', { turn: game.turn }), GameError);
  game.action('p1', 'buzz', { turn: game.turn }); answer(game, 'p1', game.question.answers[0]);
  assert.equal(game.player('p1').score, 1100);
});
test('all bonus misses clear the pool and players return next round', () => {
  const game = setup(); bid(game, 'p0', 100); game.tick(game.deadline); answer(game, 'p0', 'no'); openBonus(game);
  for (const p of game.players) {
    game.action(p.id, 'buzz', { turn: game.turn }, game.deadline - 1); answer(game, p.id, 'no');
    if (game.phase === 'bonus-countdown') game.tick(game.deadline);
  }
  assert.equal(game.phase, 'result'); assert.equal(game.pool, 0);
  game.tick(game.deadline); assert.equal(game.round, 2); assert.deepEqual(game.eliminated, []);
});
test('first accepted buzzer locks out the second; stale answers cannot hit another question', () => {
  const game = setup(); bid(game, 'p0', 50); game.tick(game.deadline); answer(game, 'p0', 'no'); openBonus(game);
  const turn = game.turn; game.action('p1', 'buzz', { turn });
  assert.throws(() => game.action('p2', 'buzz', { turn }), GameError);
  assert.throws(() => game.action('p1', 'answer', { answer: 'Paris', turn }), GameError);
});
test('deadlines count an unanswered attempt as a miss and an unopened buzzer clears the pool', () => {
  const game = setup(); bid(game, 'p0', 100); game.tick(game.deadline); game.tick(game.deadline);
  assert.equal(game.player('p0').score, 900); assert.equal(game.phase, 'bonus-intro');
  game.tick(game.deadline); game.tick(game.deadline); game.tick(game.deadline);
  assert.equal(game.phase, 'result'); assert.equal(game.pool, 0);
});
test('exactly eight regular rounds end the game and rematch resets points and readiness', () => {
  const game = setup(2);
  for (let n = 1; n <= 8; n++) { assert.equal(game.round, n); game.tick(game.deadline); assert.equal(game.phase, 'result'); game.tick(game.deadline); }
  assert.equal(game.phase, 'finished'); assert.equal(game.round, 8);
  game.player('p0').score = 700; game.action('p0', 'rematch', {}, 200000);
  assert.equal(game.phase, 'lobby'); assert.equal(game.player('p0').score, 1000); assert.equal(game.player('p0').ready, false);
});
test('deck supports worst case of eight players missing every regular and bonus question', () => {
  const game = setup(8); const seen = new Set();
  for (let round = 0; round < 8; round++) {
    seen.add(game.question.id);
    for (const p of game.players) { p.score = 1000; bid(game, p.id, 50); }
    game.tick(game.deadline);
    for (const p of game.players) answer(game, game.activeId, 'no');
    openBonus(game);
    for (const p of game.players) {
      assert.ok(!seen.has(game.question.id)); seen.add(game.question.id);
      game.action(p.id, 'buzz', { turn: game.turn }); answer(game, p.id, 'no');
      if (game.phase === 'bonus-countdown') game.tick(game.deadline);
    }
    game.tick(game.deadline);
  }
  assert.equal(game.phase, 'finished'); assert.equal(seen.size, 72); assert.ok(QUESTIONS.length >= 72);
});
test('only host can start, all players must be ready, and room capacity is eight', () => {
  const game = new Game('TEST42'); game.addPlayer('a', 'A'); game.addPlayer('b', 'B');
  assert.throws(() => game.action('b', 'start'), GameError); assert.throws(() => game.action('a', 'start'), GameError);
  for (let i = 2; i < 8; i++) game.addPlayer(`p${i}`, `Player ${i}`);
  assert.throws(() => game.addPlayer('extra', 'Extra'), GameError);
});
test('answers ignore case, spacing and punctuation but reject blank answers', () => {
  assert.ok(isCorrect(QUESTIONS[0], '  MARS! ')); assert.ok(!isCorrect(QUESTIONS[0], ''));
  assert.ok(!isCorrect(QUESTIONS[0], 'Jupiter')); assert.equal(RULES.rounds, 8);
});
test('host can remove a disconnected lobby player without allowing removal during a game', () => {
  const game = new Game('TEST42'); game.addPlayer('a', 'A'); game.addPlayer('b', 'B');
  assert.throws(() => game.action('a', 'remove', { playerId: 'b' }), GameError);
  game.player('b').connected = false;
  assert.throws(() => game.action('b', 'remove', { playerId: 'a' }), GameError);
  game.action('a', 'remove', { playerId: 'b' }); assert.equal(game.players.length, 1);
  const active = setup(2); active.player('p1').connected = false;
  assert.throws(() => active.action('p0', 'remove', { playerId: 'p1' }), GameError);
});
