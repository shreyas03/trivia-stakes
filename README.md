# Pool Party

**Bid on what you know.** A real-time trivia auction for 2–8 friends, each on their own device. Built as an original portfolio project, with a server-authoritative game engine and a responsive browser interface.

![Pool Party preview](docs/preview.jpg)

## Run it

Requires **Node.js 22 or newer**. There are no third-party runtime dependencies and no installation step.

```sh
npm start
```

Open **http://localhost:3000**. Create a room, then open the same address in another independent browser tab to join by code. Each tab gets its own player session. Use a newly opened tab rather than duplicating a tab, because browsers may clone a duplicated tab’s session storage.

For a phone or another computer on the same Wi-Fi, use the **Same-network devices** address printed by the server. The host computer must stay running, and its firewall must permit inbound access to the selected port. A loopback URL such as localhost always refers to the device opening it.

The server defaults to port 3000 and listens on all local interfaces. Set `PORT`, `HOST`, and (for production) `PUBLIC_ORIGIN` in your hosting environment. `.env.example` documents the variables; the application does not automatically load `.env` files.

## How to play

1. Everyone starts with **1,000 points**. There are **8 regular rounds**.
2. See the category, but not the question. For 25 seconds, openly raise your own bid from **50 to 300**, in increments of 10. You may pass by not bidding. You cannot bid more than your balance.
3. Bidders answer in descending bid order. A tie goes to the player who placed that current bid earlier. You have **15 seconds** to type a short answer.
4. Correct: earn your bid plus the pool. Your stake is not deducted first. Incorrect or timed out: lose your bid into the pool, then the next bidder answers the same question. Unattempted bids cost nothing.
5. If every bidder misses, read the bonus explanation. Everyone can play, including players who passed or have fewer than 50 points. No new wagers. Buzz first and answer correctly to claim the pool.
6. A bonus miss removes that player for the **entire bonus sequence**. The remaining players receive a **fresh question**, after a three-second countdown. There is no extra point deduction. If everyone misses, or nobody buzzes within 20 seconds, the pool clears. Everyone returns next regular round.
7. The highest score after eight rounds wins. Tied leaders share the win. The host can start a rematch with the same room code.

**Example:** Alice bids 100 and misses: 1,000 → 900, pool = 100. Bob bids 70 and answers correctly: 1,000 + 70 + 100 = **1,170**. The pool resets.

The opening screen teaches the regular loop. Bonus rules appear only when needed; the complete rules remain available throughout the game. The bonus explanation allows up to 25 seconds to read and ends earlier when all connected players are ready. The first bonus question starts after a countdown, so reading time never consumes the answer timer.

## Project structure

```text
public/                  Browser interface, styles, and favicon
server/index.js          HTTP API, SSE streams, sessions, room lifecycle
shared/game.js           Server-side game state machine and scoring
shared/questions.js      Original question bank and accepted answer matching
tests/game.test.js       Scoring, auction, bonus, timing, and capacity checks
tests/server.test.js     Independent sessions, stream, race, and security checks
docs/architecture.md     Design decisions and production tradeoffs
docs/deployment.md       Live-hosting and GitHub preparation
.github/workflows/ci.yml Automated checks on pushes and pull requests
Dockerfile               Portable single-process deployment
```

Despite its folder name, `shared/` is **not served to the browser**. The server never sends accepted answers before a reveal.

## Verify

```sh
npm run check
npm test
```

The tests cover the 1,170-point example, tied bids, balance limits, information hiding, passers winning a bonus pool, removal across fresh bonus questions, simultaneous buzzer requests, expired answer turns, all eight rounds, and the worst-case 72-question game.

The first version was also exercised in two independent browser sessions: create, join, ready, start, live bids, wrong answer, and correct answer with the expected score. The phone breakpoint was checked for horizontal overflow at a 390-pixel viewport. Physical-device and public-hosting checks remain to be done.

## Technical decisions

- **Server authority:** clients request actions; the server controls scores, timers, answer validation, and buzzer ownership.
- **Server-sent events:** actions use HTTP, updates push to every player immediately. SSE suits a predominantly server-to-browser update stream and reconnects automatically.
- **Atomic turns:** mutations are synchronous in one Node process. A turn identifier prevents a delayed request from affecting a newer question.
- **No accounts:** random session tokens restore a player after a refresh. Room codes identify a room, not a player’s authority.
- **Small dependency surface:** modern browser JavaScript and Node’s built-in HTTP, crypto, and test modules keep setup approachable.

## Current scope

This is a working **local first playable version**, not a deployed public service. GitHub CI is configured but has not run on GitHub yet, and the Docker image has not been built in this environment.

Rooms and sessions live in memory; restarting the server resets them. Run one server instance. A future horizontally scaled version needs a shared transactional room store or per-room actors. SSE needs a host and reverse proxy that allow long-lived streaming responses. Static-only hosting does not run this game’s server.

Answers use explicit aliases with case, whitespace, punctuation, and accent normalization. They do not use AI judging or unrestricted typo matching. The initial bank contains basic stable trivia; expand its difficulty and review its answers before a competition. Network latency can affect fastest-finger ordering: the first valid request to reach the server wins.

The average game duration depends on the number of players and misses. The landing page’s 15-minute estimate is a target, not a guarantee; extensive bonus play can take longer.

See [deployment instructions](docs/deployment.md) and [architecture notes](docs/architecture.md).
