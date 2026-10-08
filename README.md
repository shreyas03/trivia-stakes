# Trivia Stakes

A real-time trivia auction game for 2-8 players joining by room code. Start with 1,000 points, bid on categories, answer privately, and win the pool. Eight regular rounds, four or more host-selected categories, and fastest-buzzer bonus questions.

Play the published game at [Trivia Stakes](https://trivia-stakes.saishreyastikkireddi.chatgpt.site).

![Trivia Stakes preview](docs/preview.jpg)

## Sites hosting
This version runs on Cloudflare Workers through ChatGPT Sites and Vinext. D1 stores room state and hashed player sessions. Conditional database updates serialize competing actions so only one bonus buzzer wins. Clients refresh authoritative room state every 500 ms after each response; deadlines remain server-owned. Timers are advanced by active clients' requests, and inactive rooms expire after six hours. No question or scoring decision is trusted to the browser.

The existing Node server remains available for standalone local development. Both runtimes share the same game engine and curated question bank.

## Setup
Use Node 22.13 or newer:

```sh
npm run install:ci
npm run check
npm test
npm run build
```

For a database-backed local preview, apply the migration and run the built Worker as described in [deployment instructions](docs/deployment.md). `npm run dev` serves the framework preview at http://localhost:5173. `npm run dev:node` runs the original Node server at http://localhost:3000 without a database. `npm start` runs the built Worker, so build and initialize its local database first.

## Project structure

- `app/`, `build/`, and `vite.config.ts`: Vinext routes and Sites Worker integration.
- `lib/room-service.mjs` and `lib/trivia.mjs`: D1-backed rooms, sessions, and trivia preparation.
- `db/` and `drizzle/`: database schema and SQL migrations.
- `shared/`: common game rules and curated questions; never served to clients.
- `public/`: browser interface used by both runtimes.
- `server/`: standalone Node server with in-memory rooms.
- `tests/`: game, Node server, trivia, and database-backed concurrency checks.

See [architecture notes](docs/architecture.md) for the runtime differences. CI installs the locked dependencies, checks JavaScript syntax, runs the tests, and builds the Sites Worker. CI does not deploy the live site.

The repository keeps the game source and required Sites integration; unused starter UI components, sample apps, and placeholder assets have been removed.

## Question sources
Medium four-choice questions from Open Trivia Database are cached before play, with the curated bank as fallback. A database lease spaces upstream fetches across rooms. Recently consumed prompts are persisted to reduce repeats. Small category pools may repeat after unique questions are exhausted; the lobby explains this.

Open Trivia Database content is under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); category labels and option order are adapted. Attribution appears in the game when a live deck is used. Code licensing remains an owner decision. No API key or player data is sent to the trivia provider.

## Validation and limits
Tests cover scoring, hidden options, stale turns, concurrent room joins, concurrent buzzer attempts, category filtering, timers, bonus elimination, and trivia fallback. D1 compare-and-swap retries prevent lost updates. The first successfully committed buzz wins; network and storage latency affect arrival order. This is a casual party game, not a precision timing competition.

This repository is [shreyas03/trivia-stakes](https://github.com/shreyas03/trivia-stakes). It imports published Sites version 1, source commit `4bd9c0b853eeeb312d950a1a25b018be23751c0a`, while retaining the original GitHub history and the Sites source history. The tracked `.openai/hosting.json` identifies the existing Sites project. Sites maintains a separate deployment source repository; a GitHub push alone does not publish it. See [source synchronization](docs/deployment.md#source-synchronization) before future releases. Original Node room sessions are not migrated to the hosted database.
