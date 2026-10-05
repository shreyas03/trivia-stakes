import { Game, GameError } from '../shared/game.js';
import { TriviaProvider, parseLiveQuestion, questionKey } from './trivia.mjs';

const TTL = 6 * 60 * 60 * 1000;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const respond = (status, data) => Response.json(data, { status, headers });
const random = bytes => { const values = new Uint8Array(bytes); crypto.getRandomValues(values); return [...values].map(n => n.toString(16).padStart(2, '0')).join(''); };
const code = () => { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const values = new Uint8Array(6); crypto.getRandomValues(values); return [...values].map(n => chars[n % chars.length]).join(''); };
export async function hashToken(token) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(n => n.toString(16).padStart(2, '0')).join(''); }
export function restoreGame(state) { return Object.assign(Object.create(Game.prototype), JSON.parse(state), { onQuestionUsed() {} }); }

/** A database compare-and-swap serializes mutations across independent Worker isolates. */
export async function mutateRoom(db, roomCode, change, now = Date.now()) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const row = await db.prepare('SELECT state, revision FROM rooms WHERE code = ? AND expires > ?').bind(roomCode, now).first();
    if (!row) throw new GameError('Room not found or expired. Create a new room.');
    const game = restoreGame(row.state);
    const cursor = game.cursor;
    const value = change(game);
    const result = await db.prepare('UPDATE rooms SET state = ?, revision = revision + 1, expires = ? WHERE code = ? AND revision = ?').bind(JSON.stringify(game), now + TTL, roomCode, row.revision).run();
    if (result.meta.changes === 1) {
      // Record only questions actually consumed by a successfully committed mutation.
      for (const q of game.deck.slice(cursor, game.cursor)) await db.prepare('INSERT INTO recent (key, used) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET used = excluded.used').bind(questionKey(q), now).run();
      return { game, value };
    }
  }
  throw new GameError('The room is busy. Try again in a moment.');
}

async function rate(db, key, max, now) {
  const row = await db.prepare('INSERT INTO limits (key, count, expires) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN limits.expires <= ? THEN 1 ELSE limits.count + 1 END, expires = CASE WHEN limits.expires <= ? THEN excluded.expires ELSE limits.expires END RETURNING count').bind(key, now + 60000, now, now).first();
  return row.count <= max;
}

async function loadDeck(db, categories) {
  const provider = new TriviaProvider({ enabled: false });
  const recent = await db.prepare('SELECT key, used FROM recent ORDER BY used DESC LIMIT 500').all();
  provider.recent = new Map(recent.results.map(q => [q.key, q.used]));
  const now = Date.now();
  let cached = await db.prepare('SELECT value FROM cache WHERE key = ? AND expires > ?').bind('questions', now).first();
  if (!cached) {
    // One request per cooldown across the entire deployment, including concurrent rooms.
    const claim = await db.prepare('INSERT INTO cache (key, value, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET expires = excluded.expires WHERE cache.expires <= ?').bind('trivia-fetch-lock', '', now + 60000, now).run();
    if (claim.meta.changes === 1) {
      try {
        const response = await fetch('https://opentdb.com/api.php?amount=50&difficulty=medium&type=multiple&encode=url3986', { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Trivia unavailable');
        const data = await response.json();
        if (data.response_code !== 0 || !Array.isArray(data.results)) throw new Error('Trivia unavailable');
        const questions = data.results.map(parseLiveQuestion).filter(Boolean);
        cached = { value: JSON.stringify(questions) };
        await db.prepare('INSERT INTO cache (key, value, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires = excluded.expires').bind('questions', cached.value, now + 10 * 60000).run();
      } catch { /* Curated fallback is already complete and category-filtered. */ }
    }
  }
  provider.pool = cached ? JSON.parse(cached.value) : [];
  return provider.loadDeck(categories);
}

async function prepareDeck(db, roomCode, selectionTurn, categories) {
  const { deck, info } = await loadDeck(db, categories);
  await mutateRoom(db, roomCode, game => {
    if (game.phase === 'lobby' && game.turn === selectionTurn && JSON.stringify(game.categories) === JSON.stringify(categories)) {
      game.deck = deck; game.cursor = 0; game.questionSource = info; game.touch(Date.now());
    }
  });
}

function heartbeat(game, id, now) {
  let changed = game.tick(now);
  const player = game.player(id);
  if (!player) throw new GameError('Your player was removed. Join another room.');
  if (!player.lastSeen || now - player.lastSeen >= 4000 || !player.connected) {
    player.lastSeen = now; player.connected = true; changed = true;
  }
  for (const p of game.players) {
    const connected = now - (p.lastSeen ?? game.createdAt) < 15000;
    if (p.connected !== connected) { p.connected = connected; changed = true; }
  }
  if (!game.player(game.hostId)?.connected) {
    const host = game.players.find(p => p.connected);
    if (host && host.id !== game.hostId) { game.hostId = host.id; game.event(`${host.name} is now the host.`); changed = true; }
  }
  if (changed) game.touch(now);
}

export async function handleGameRequest(request, db) {
  const now = Date.now(), url = new URL(request.url);
  if (!db) return respond(503, { error: 'Game storage is temporarily unavailable.' });
  try {
    if (request.method === 'GET' && url.pathname === '/health') return respond(200, { status: 'ok' });
    if (!['GET', 'POST'].includes(request.method)) return respond(405, { error: 'Method not allowed.' });
    let payload = {};
    if (request.method === 'POST') {
      if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return respond(403, { error: 'This request came from a different site.' });
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
      if (!await rate(db, 'actions:' + ip, 300, now)) return respond(429, { error: 'Too many requests. Wait a moment.' });
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 4096) throw new GameError('Request is too large.');
      try { payload = JSON.parse(text || '{}'); } catch { throw new GameError('Invalid request.'); }
      if (url.pathname === '/api/rooms') {
        if (!await rate(db, 'rooms:' + ip, 15, now)) return respond(429, { error: 'Please wait before making another room.' });
        const counts = await db.prepare('SELECT COUNT(*) AS count FROM rooms WHERE expires > ?').bind(now).first();
        if (counts.count >= 500) return respond(503, { error: 'The server is full. Try again later.' });
        const game = new Game(code(), { now }); const id = random(12), token = random(32);
        game.addPlayer(id, payload.name, now); game.player(id).lastSeen = now;
        const { deck, info } = await loadDeck(db, game.categories); game.deck = deck; game.questionSource = info;
        await db.batch([
          db.prepare('INSERT INTO rooms (code, state, revision, expires) VALUES (?, ?, ?, ?)').bind(game.code, JSON.stringify(game), 0, now + TTL),
          db.prepare('INSERT INTO sessions (hash, code, player, expires) VALUES (?, ?, ?, ?)').bind(await hashToken(token), game.code, id, now + TTL),
          db.prepare('DELETE FROM rooms WHERE expires <= ?').bind(now),
          db.prepare('DELETE FROM sessions WHERE expires <= ?').bind(now),
          db.prepare('DELETE FROM limits WHERE expires <= ?').bind(now - 60000),
          db.prepare('DELETE FROM recent WHERE key NOT IN (SELECT key FROM recent ORDER BY used DESC LIMIT 500)'),
        ]);
        return respond(201, { session: token, state: game.view(id) });
      }
      if (url.pathname === '/api/join') {
        const roomCode = String(payload.code ?? '').trim().toUpperCase();
        if (!/^[A-Z2-9]{6}$/.test(roomCode)) throw new GameError('Check the six-character room code.');
        const id = random(12), token = random(32);
        const { game } = await mutateRoom(db, roomCode, game => { game.addPlayer(id, payload.name, now); game.player(id).lastSeen = now; });
        await db.prepare('INSERT INTO sessions (hash, code, player, expires) VALUES (?, ?, ?, ?)').bind(await hashToken(token), roomCode, id, now + TTL).run();
        return respond(200, { session: token, state: game.view(id) });
      }
    }
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!/^[a-f0-9]{64}$/.test(token)) return respond(401, { error: 'Your room session has expired. Join a new room.' });
    const session = await db.prepare('SELECT code, player FROM sessions WHERE hash = ? AND expires > ?').bind(await hashToken(token), now).first();
    if (!session) return respond(401, { error: 'Your room session has expired. Join a new room.' });
    if (request.method === 'GET' && url.pathname === '/api/state') {
      const { game } = await mutateRoom(db, session.code, game => heartbeat(game, session.player, now));
      return respond(200, game.view(session.player));
    }
    if (request.method === 'POST' && url.pathname === '/api/action') {
      const { game } = await mutateRoom(db, session.code, game => {
        heartbeat(game, session.player, now); game.action(session.player, payload.action, payload, now);
        if (['categories', 'rematch'].includes(payload.action)) { game.questionSource.status = 'loading'; game.turn++; }
      });
      if (['categories', 'rematch'].includes(payload.action)) {
        await prepareDeck(db, game.code, game.turn, [...game.categories]);
        const row = await db.prepare('SELECT state FROM rooms WHERE code = ?').bind(game.code).first();
        return respond(200, restoreGame(row.state).view(session.player));
      }
      return respond(200, game.view(session.player));
    }
    return respond(404, { error: 'Not found.' });
  } catch (error) {
    if (error instanceof GameError) return respond(request.headers.has('authorization') && /expired|removed/.test(error.message) ? 401 : 400, { error: error.message });
    console.error('Game request failed:', error?.message);
    return respond(500, { error: 'Something went wrong. Please try again.' });
  }
}
