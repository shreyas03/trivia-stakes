# Trivia Stakes

A real-time trivia auction game for 2-8 players joining by room code. Start with 1,000 points, bid on categories, answer privately, and win the pool. Eight regular rounds, four or more host-selected categories, and fastest-buzzer bonus questions.

## Sites hosting
This version runs on Cloudflare Workers through ChatGPT Sites and Vinext. D1 stores room state and hashed player sessions. Conditional database updates serialize competing actions so only one bonus buzzer wins. Clients refresh authoritative room state every 500 ms after each response; deadlines remain server-owned. Timers are advanced by active clients' requests, and inactive rooms expire after six hours. No question or scoring decision is trusted to the browser.

The existing Node server remains available for standalone local development. Both runtimes share the same game engine and curated question bank.

## Setup
Use Node 22.13 or newer. Run `npm ci`, `npm test`, `npm run check`, and `npm run build`. Apply the generated SQL migration to the local D1 binding before a database-backed preview (see the starter documentation). Run `npm run dev` for the Sites preview or `npm run dev:node` for the original Node server.

## Question sources
Medium four-choice questions from Open Trivia Database are cached before play, with the curated bank as fallback. A database lease spaces upstream fetches across rooms. Recently consumed prompts are persisted to reduce repeats. Small category pools may repeat after unique questions are exhausted; the lobby explains this.

Open Trivia Database content is under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); category labels and option order are adapted. Attribution appears in the game when a live deck is used. Code licensing remains an owner decision. No API key or player data is sent to the trivia provider.

## Validation and limits
Tests cover scoring, hidden options, stale turns, concurrent room joins, concurrent buzzer attempts, category filtering, timers, bonus elimination, and trivia fallback. D1 compare-and-swap retries prevent lost updates. The first successfully committed buzz wins; network and storage latency affect arrival order. This is a casual party game, not a precision timing competition.

The original GitHub project is [shreyas03/trivia-stakes](https://github.com/shreyas03/trivia-stakes). Sites maintains its own deployment source repository; changes here must also be synchronized back to GitHub for the portfolio. Original Node room sessions are not migrated to the hosted database.
