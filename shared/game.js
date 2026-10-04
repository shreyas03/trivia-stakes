import { QUESTIONS } from './questions.js';

export const RULES = Object.freeze({ startingPoints: 1000, rounds: 8, minBid: 50, maxBid: 300, bidStep: 10, biddingMs: 25000, answerMs: 15000, bonusIntroMs: 25000, countdownMs: 3000, buzzerMs: 20000, resultMs: 10000 });
const palette = ['coral', 'blue', 'yellow', 'purple', 'green', 'pink', 'orange', 'teal'];
export class GameError extends Error {}
function requireRule(condition, message) { if (!condition) throw new GameError(message); }
function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const values = new Uint32Array(1); crypto.getRandomValues(values);
    const j = Math.floor(values[0] / 4294967296 * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Pure game state machine. All timestamps come from the server; clients cannot award points. */
export class Game {
  constructor(code, { now = Date.now(), deck = shuffle(QUESTIONS), onQuestionUsed = () => {} } = {}) {
    this.code = code;
    this.players = [];
    this.hostId = null;
    this.phase = 'lobby';
    this.round = 0;
    this.pool = 0;
    this.deadline = null;
    this.deck = deck;
    this.onQuestionUsed = onQuestionUsed;
    this.questionSource = { status: 'ready', mode: 'local', liveCount: 0, curatedCount: deck.length };
    this.cursor = 0;
    this.question = null;
    this.order = [];
    this.activeId = null;
    this.eliminated = [];
    this.bidSequence = 0;
    this.turn = 0;
    this.result = null;
    this.events = [];
    this.createdAt = now;
    this.updatedAt = now;
    this.revision = 0;
  }
  player(id) { return this.players.find(player => player.id === id); }
  addPlayer(id, name, now = Date.now()) {
    requireRule(this.phase === 'lobby', 'This game has started. Join a new room instead.');
    requireRule(this.players.length < 8, 'This room is full (8 players).');
    name = String(name ?? '').trim().replace(/\s+/g, ' ');
    requireRule(name.length >= 1 && name.length <= 20, 'Use a name between 1 and 20 characters.');
    requireRule(!this.players.some(p => p.name.toLowerCase() === name.toLowerCase()), 'That name is taken in this room.');
    const player = { id, name, score: 1000, bid: 0, bidOrder: 0, ready: false, connected: true, color: palette[this.players.length], wins: 0 };
    this.players.push(player);
    this.hostId ??= id;
    this.touch(now);
    return player;
  }
  touch(now) { this.updatedAt = now; this.revision++; }
  event(message) { this.events.push(message); this.events = this.events.slice(-5); }
  nextQuestion() {
    requireRule(this.cursor < this.deck.length, 'The question deck is exhausted.');
    const question = this.deck[this.cursor++];
    this.onQuestionUsed(question);
    return { ...question, choices: shuffle(question.options).map((text, index) => ({ id: String(index), text })) };
  }
  beginRound(now) {
    if (this.round >= RULES.rounds) {
      this.phase = 'finished'; this.deadline = null; this.activeId = null; this.turn++; return;
    }
    this.round++;
    this.phase = 'bidding';
    this.pool = 0;
    this.question = this.nextQuestion();
    this.activeId = null;
    this.eliminated = [];
    this.result = null;
    this.order = [];
    this.events = [];
    for (const p of this.players) { p.bid = 0; p.ready = false; p.bidOrder = 0; }
    this.deadline = now + RULES.biddingMs;
    this.turn++;
  }
  closeBidding(now) {
    this.order = this.players.filter(p => p.bid > 0).sort((a, b) => b.bid - a.bid || a.bidOrder - b.bidOrder).map(p => p.id);
    if (!this.order.length) { this.endRound(now, { title: 'Everyone passed', detail: 'No points gained or lost. On to the next category.', answer: null }); return; }
    this.phase = 'answer';
    this.activeId = this.order.shift();
    this.deadline = now + RULES.answerMs;
    this.turn++;
  }
  beginBonus(now) {
    this.phase = 'bonus-intro';
    this.activeId = null;
    this.eliminated = [];
    this.question = null;
    for (const p of this.players) p.ready = false;
    this.deadline = now + RULES.bonusIntroMs;
    this.turn++;
  }
  bonusCountdown(now) {
    this.phase = 'bonus-countdown';
    this.question = this.nextQuestion();
    this.activeId = null;
    this.deadline = now + RULES.countdownMs;
    this.turn++;
  }
  endRound(now, result) {
    this.phase = 'result';
    this.activeId = null;
    this.result = result;
    this.pool = 0;
    this.deadline = now + RULES.resultMs;
    this.turn++;
  }
  answer(id, choiceId, now, timedOut = false) {
    const player = this.player(id);
    const bonus = this.phase === 'bonus-answer';
    const selected = this.question.choices.find(choice => choice.id === choiceId);
    if (!timedOut && selected?.text === this.question.answers[0]) {
      const reward = (bonus ? 0 : player.bid) + this.pool;
      player.score += reward; player.wins++;
      this.event(`${player.name} won ${reward} points.`);
      this.endRound(now, { title: bonus ? 'Jackpot claimed!' : 'That’s correct!', detail: `${player.name} wins ${reward} points${bonus ? ' from the pool' : ` (${player.bid} bid + ${this.pool} pool)`}.`, winnerId: id, reward, answer: this.question.answers[0] });
      return;
    }
    if (bonus) {
      this.eliminated.push(id);
      this.event(`${player.name} ${timedOut ? 'ran out of time' : 'missed'} and is out of this bonus sequence. Answer: ${this.question.answers[0]}.`);
      if (this.players.every(p => this.eliminated.includes(p.id))) {
        this.endRound(now, { title: 'The pool is cleared', detail: 'Everyone missed the bonus. A fresh start next round.', answer: this.question.answers[0] });
      } else this.bonusCountdown(now);
    } else {
      player.score -= player.bid;
      this.pool += player.bid;
      this.event(`${player.name} ${timedOut ? 'ran out of time' : 'missed'}. ${player.bid} points added to the pool.`);
      if (this.order.length) {
        this.activeId = this.order.shift();
        this.deadline = now + RULES.answerMs;
        this.turn++;
      } else {
        this.event(`The regular answer was ${this.question.answers[0]}.`);
        this.beginBonus(now);
      }
    }
  }
  action(id, action, payload = {}, now = Date.now()) {
    const player = this.player(id);
    requireRule(player, 'Your session is no longer in this room.');
    if (action === 'ready') {
      requireRule(['lobby', 'bonus-intro'].includes(this.phase), 'There is no ready check right now.');
      player.ready = payload.ready !== false;
      if (this.phase === 'bonus-intro' && this.players.filter(p => p.connected).every(p => p.ready)) this.bonusCountdown(now);
    } else if (action === 'remove') {
      requireRule(id === this.hostId && this.phase === 'lobby', 'Only the host can remove a player before the game.');
      const target = this.player(payload.playerId);
      requireRule(target && target.id !== id && !target.connected, 'You can only remove a disconnected player from the lobby.');
      this.players = this.players.filter(p => p.id !== target.id);
    } else if (action === 'start') {
      requireRule(id === this.hostId, 'Only the host can start the game.');
      requireRule(this.phase === 'lobby', 'The game has already started.');
      requireRule(this.questionSource.status === 'ready', 'Fresh questions are still loading. Please wait a moment.');
      requireRule(this.players.length >= 2 && this.players.every(p => p.connected && p.ready), 'At least 2 players must be connected, and everyone must be ready.');
      this.beginRound(now);
    } else if (action === 'bid') {
      requireRule(this.phase === 'bidding' && payload.turn === this.turn, 'Bidding has closed for this category.');
      const amount = Number(payload.amount);
      requireRule(Number.isInteger(amount) && amount >= 50 && amount <= 300 && amount % 10 === 0, 'Bid 50–300 points in steps of 10.');
      requireRule(amount <= player.score, 'You cannot bid more points than you have.');
      requireRule(amount > player.bid, 'You can only increase your bid.');
      player.bid = amount; player.bidOrder = ++this.bidSequence;
    } else if (action === 'answer') {
      requireRule(['answer', 'bonus-answer'].includes(this.phase) && id === this.activeId && payload.turn === this.turn, 'It is not your answer turn anymore.');
      requireRule(typeof payload.choiceId === 'string' && this.question.choices.some(choice => choice.id === payload.choiceId), 'Choose one of the four answers.');
      this.answer(id, payload.choiceId, now);
    } else if (action === 'buzz') {
      requireRule(this.phase === 'bonus-buzz' && payload.turn === this.turn, 'The buzzer is not open anymore.');
      requireRule(!this.eliminated.includes(id), 'You are out of this bonus sequence. You return next round.');
      this.activeId = id; this.phase = 'bonus-answer'; this.deadline = now + RULES.answerMs; this.turn++;
      this.event(`${player.name} buzzed first!`);
    } else if (action === 'next') {
      requireRule(id === this.hostId && this.phase === 'result', 'Only the host can continue from a round result.');
      this.beginRound(now);
    } else if (action === 'rematch') {
      requireRule(id === this.hostId && this.phase === 'finished', 'Only the host can start a rematch after the game.');
      this.phase = 'lobby'; this.round = 0; this.pool = 0; this.cursor = 0; this.deck = shuffle(QUESTIONS); this.question = null; this.result = null; this.events = []; this.deadline = null; this.turn++;
      for (const p of this.players) { p.score = 1000; p.bid = 0; p.ready = false; p.wins = 0; }
    } else throw new GameError('Unknown action.');
    this.touch(now);
  }
  tick(now = Date.now()) {
    if (!this.deadline || now < this.deadline) return false;
    if (this.phase === 'bidding') this.closeBidding(now);
    else if (['answer', 'bonus-answer'].includes(this.phase)) this.answer(this.activeId, '', now, true);
    else if (this.phase === 'bonus-intro') this.bonusCountdown(now);
    else if (this.phase === 'bonus-countdown') { this.phase = 'bonus-buzz'; this.deadline = now + RULES.buzzerMs; this.turn++; }
    else if (this.phase === 'bonus-buzz') this.endRound(now, { title: 'Nobody buzzed', detail: 'The pool is cleared. Next category coming up.', answer: this.question.answers[0] });
    else if (this.phase === 'result') this.beginRound(now);
    this.touch(now);
    return true;
  }
  view(id, now = Date.now()) {
    const reveal = ['answer', 'bonus-buzz', 'bonus-answer', 'result'].includes(this.phase);
    return {
      code: this.code, hostId: this.hostId, you: id, phase: this.phase, round: this.round, pool: this.pool,
      deadline: this.deadline, serverTime: now, turn: this.turn, revision: this.revision,
      players: this.players.map(p => ({ ...p })), activeId: this.activeId, order: this.order,
      eliminated: this.eliminated, result: this.result, events: this.events,
      category: this.phase === 'bidding' ? this.question.category : null,
      question: reveal && this.question ? {
        text: this.question.text, category: this.question.category,
        ...(id === this.activeId && ['answer', 'bonus-answer'].includes(this.phase) ? { choices: this.question.choices.map(choice => ({ ...choice })) } : {}),
      } : null,
      rules: RULES, questionSource: this.questionSource,
    };
  }
}
