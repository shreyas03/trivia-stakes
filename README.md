# Trivia Stakes

**Bid on what you know.** A real-time multiplayer trivia game for 2–8 players, each joining from their own device by room code.

[**Play Trivia Stakes**](https://trivia-stakes.saishreyastikkireddi.chatgpt.site)

![Trivia Stakes preview](docs/preview.jpg)

## How it works

- Start with 1,000 points and compete across eight rounds.
- Bid on a category before seeing the question. The highest bidder answers first.
- A correct answer earns your bid plus the pool. A wrong answer loses your bid into the pool and gives the next bidder a chance.
- If every bidder misses, a bonus buzzer sequence gives players a chance to win the pool.
- The host chooses at least four categories. The highest final score wins.

Questions are multiple choice, with answer options visible only to the active player. The game teaches the rules as you play.

## Run locally

Requires **Node.js 22.13 or newer**.

```sh
npm run install:ci
npm run dev:node
```

Open http://localhost:3000 in two independent browser tabs to test multiplayer. This standalone runtime uses in-memory rooms and needs no database.

For the database-backed Sites runtime, follow the [deployment guide](docs/deployment.md#local-sites-runtime).

## Checks

```sh
npm run check
npm test
npm run build
```

The 40 tests cover scoring, private answers, bonus rounds, timers, categories, multiplayer concurrency, and trivia fallback. GitHub Actions runs the checks and production build on pushes and pull requests.

## Project structure

- `app/` — Vinext pages and API routes.
- `lib/` — database-backed rooms, sessions, and trivia loading.
- `shared/` — game rules, categories, and curated questions.
- `public/` — browser interface, styles, and assets.
- `db/` and `drizzle/` — database schema and migrations.
- `server/` — standalone Node server.
- `tests/` — automated game and server tests.
- `build/` and `scripts/` — Sites integration and development tooling.

The hosted game uses **Vinext, Cloudflare Workers, and D1**, with server-controlled scoring and timers. See the [architecture notes](docs/architecture.md) for implementation details.

## Questions and hosting

Medium-difficulty questions come from [Open Trivia Database](https://opentdb.com/), with an 80-question curated bank as fallback. Small category pools may repeat after unique questions are exhausted. Open Trivia Database content is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

GitHub pushes run automated checks; publishing updates requires a separate Sites deployment. See the [deployment guide](docs/deployment.md) for instructions.
