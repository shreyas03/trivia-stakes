import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Game, GameError } from '../shared/game.js';
import { TriviaProvider } from './trivia.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" };
const MAX_ROOMS = 500;
const ROOM_TTL = 6 * 60 * 60 * 1000;
function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(6)].map(n => alphabet[n % alphabet.length]).join('');
}
function json(res, status, data) { res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 4096) throw new GameError('Request is too large.');
  }
  try { return JSON.parse(text || '{}'); } catch { throw new GameError('Invalid request.'); }
}

/** In-memory single-process room service. Room mutations execute synchronously. */
export function createGameServer({ questionProvider = new TriviaProvider({ enabled: process.env.TRIVIA_LIVE !== 'false' }) } = {}) {
  const rooms = new Map();
  const sessions = new Map();
  const streams = new Map();
  const rates = new Map();
  const preparations = new Map();
  function publish(game) {
    for (const player of game.players) {
      const data = `event: state\ndata: ${JSON.stringify(game.view(player.id))}\n\n`;
      for (const stream of streams.get(player.id) ?? []) {
        if (!stream.destroyed) stream.write(data);
      }
    }
  }
  function authorize(req, url) {
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? url.searchParams.get('session');
    const session = sessions.get(token);
    const game = session && rooms.get(session.code);
    if (!session || !game || !game.player(session.id)) return null;
    return { game, id: session.id };
  }
  function prepareQuestions(game) {
    if (preparations.has(game.code)) return preparations.get(game.code);
    game.questionSource = { status: 'loading', mode: 'local', liveCount: 0, curatedCount: 80 };
    game.touch(Date.now());
    const preparation = Promise.resolve().then(() => questionProvider.loadDeck()).then(({ deck, info }) => {
      if (game.phase !== 'lobby') return;
      game.deck = deck; game.cursor = 0; game.questionSource = info;
    }).catch(() => {
      game.questionSource = { status: 'ready', mode: 'local', liveCount: 0, curatedCount: game.deck.length };
    }).finally(() => {
      preparations.delete(game.code); game.touch(Date.now()); publish(game);
    });
    preparations.set(game.code, preparation);
    return preparation;
  }
  function createSession(game, name) {
    const id = randomBytes(12).toString('hex');
    const token = randomBytes(32).toString('hex');
    game.addPlayer(id, name);
    sessions.set(token, { code: game.code, id });
    return { session: token, state: game.view(id) };
  }
  function allowRate(req, key, limit) {
    // Trust the socket, not client-supplied forwarding headers.
    const rateKey = `${req.socket.remoteAddress}:${key}`;
    const now = Date.now();
    let rate = rates.get(rateKey);
    if (!rate || now - rate.start > 60000) { rate = { start: now, count: 0 }; rates.set(rateKey, rate); }
    return ++rate.count <= limit;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [name, type] = assets.get(url.pathname);
        res.writeHead(200, { ...securityHeaders, 'Content-Type': type });
        res.end(await readFile(new URL(`../public/${name}`, import.meta.url))); return;
      }
      if (req.method === 'GET' && url.pathname === '/health') { json(res, 200, { status: 'ok' }); return; }
      if (req.method === 'POST') {
        const expectedOrigin = process.env.PUBLIC_ORIGIN ?? `http://${req.headers.host}`;
        if (req.headers.origin && req.headers.origin !== expectedOrigin) { json(res, 403, { error: 'This request came from a different site.' }); return; }
        if (!allowRate(req, 'actions', 300)) { json(res, 429, { error: 'Too many requests. Wait a moment.' }); return; }
        const payload = await body(req);
        if (url.pathname === '/api/rooms') {
          if (!allowRate(req, 'create', 15)) { json(res, 429, { error: 'Please wait before making another room.' }); return; }
          if (rooms.size >= MAX_ROOMS) { json(res, 503, { error: 'The server is full. Try again later.' }); return; }
          let code; do { code = roomCode(); } while (rooms.has(code));
          const game = new Game(code, { onQuestionUsed: question => questionProvider.recordUsed?.(question) });
          const created = createSession(game, payload.name);
          rooms.set(code, game); prepareQuestions(game); created.state = game.view(created.state.you); json(res, 201, created); return;
        }
        if (url.pathname === '/api/join') {
          const code = String(payload.code ?? '').trim().toUpperCase();
          const game = rooms.get(code);
          if (!game) { json(res, 404, { error: 'Room not found. Check the six-character code.' }); return; }
          const joined = createSession(game, payload.name); publish(game); json(res, 200, joined); return;
        }
        const auth = authorize(req, url);
        if (!auth) { json(res, 401, { error: 'Your room session has expired. Join a new room.' }); return; }
        if (url.pathname === '/api/action') {
          if (auth.game.tick()) publish(auth.game);
          auth.game.action(auth.id, payload.action, payload);
          if (payload.action === 'rematch') prepareQuestions(auth.game);
          publish(auth.game); json(res, 200, auth.game.view(auth.id)); return;
        }
      }
      if (req.method === 'GET' && ['/api/state', '/api/events'].includes(url.pathname)) {
        const auth = authorize(req, url);
        if (!auth) { json(res, 401, { error: 'Your room session has expired. Join a new room.' }); return; }
        const { game, id } = auth;
        if (game.tick()) publish(game);
        if (url.pathname === '/api/state') { json(res, 200, game.view(id)); return; }
        const connections = streams.get(id) ?? new Set();
        if (connections.size >= 3) { json(res, 429, { error: 'Too many connections for this player.' }); return; }
        res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 1500\n\n');
        connections.add(res); streams.set(id, connections);
        const p = game.player(id);
        p.connected = true; p.disconnectedAt = null; game.touch(Date.now()); publish(game);
        req.on('close', () => {
          connections.delete(res);
          if (!connections.size) { p.connected = false; p.disconnectedAt = Date.now(); game.touch(Date.now()); publish(game); }
        });
        return;
      }
      json(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof GameError) json(res, 400, { error: error.message });
      else { console.error('Request failed:', error.message); json(res, 500, { error: 'Something went wrong. Please try again.' }); }
    }
  });
  const ticker = setInterval(() => {
    const now = Date.now();
    for (const game of rooms.values()) {
      if (now - game.updatedAt > ROOM_TTL) {
        rooms.delete(game.code);
        for (const [token, session] of sessions) if (session.code === game.code) sessions.delete(token);
        for (const p of game.players) { for (const stream of streams.get(p.id) ?? []) stream.end(); streams.delete(p.id); }
        continue;
      }
      const host = game.player(game.hostId);
      if (host && !host.connected && host.disconnectedAt && now - host.disconnectedAt > 15000) {
        const nextHost = game.players.find(p => p.connected);
        if (nextHost) { game.hostId = nextHost.id; game.touch(now); game.event(`${nextHost.name} is now the host.`); publish(game); }
      }
      if (game.tick(now)) publish(game);
    }
    for (const [key, rate] of rates) if (now - rate.start > 60000) rates.delete(key);
  }, 100);
  ticker.unref();
  const heartbeat = setInterval(() => { for (const connections of streams.values()) for (const stream of connections) stream.write(': heartbeat\n\n'); }, 15000);
  heartbeat.unref();
  server.on('close', () => { clearInterval(ticker); clearInterval(heartbeat); });
  return { server, rooms, close: () => { for (const connections of streams.values()) for (const stream of connections) stream.end(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  const { server } = createGameServer();
  server.listen(port, host, () => {
    console.log(`Pool Party is ready at http://localhost:${port}`);
    for (const addresses of Object.values(networkInterfaces())) for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) console.log(`Same-network devices: http://${address.address}:${port}`);
    }
  });
}
