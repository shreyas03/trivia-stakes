# GitHub and live hosting

## Published Sites version

[Trivia Stakes](https://trivia-stakes.saishreyastikkireddi.chatgpt.site) is published through ChatGPT Sites. The hosted runtime uses Vinext, Cloudflare Workers, and a D1 binding named `DB`. The tracked `.openai/hosting.json` retains project `appgprj_6ac2cdfa78888191bb8262ebaecd0c4c`.

This repository imports published version 1 from source commit `4bd9c0b853eeeb312d950a1a25b018be23751c0a`. The import retains both the original GitHub commits and the separate Sites source commit as merge ancestry. Repository synchronization does not change the production deployment or its public audience.

## Local Sites runtime

Use Node 22.13 or newer. Clean clones default to the portable execution profile; `.sites-runtime/` contains ignored local tool state.

```sh
npm run install:ci
npm run check
npm test
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_large_warbound.sql
npm start
```

The SQL command initializes a fresh local database; run it once per new local state directory. It does not migrate production. `npm start` serves the built Worker on loopback; use the address printed by Wrangler. Its database state persists under `.wrangler/state`. `npm run dev` starts the framework preview at http://localhost:5173; it uses separate development state, so prefer the built Worker commands above for a reproducible database-backed game preview.

The build emits `dist/server/wrangler.json`. Its placeholder D1 identifier is for local development; Sites supplies the production binding during publication. Do not deploy that placeholder directly to an unrelated Cloudflare account.

## Standalone Node runtime

```sh
npm run dev:node
```

Open http://localhost:3000. The Node server uses in-memory rooms and sessions and needs no database or framework build. To run without file watching, use `node server/index.js`. Environment variables are documented in `.env.example`; the Node server does not automatically load `.env` files.

For standalone hosting, run one Node 22.13+ instance with HTTPS. Set `PORT`, `HOST=0.0.0.0`, and `PUBLIC_ORIGIN` to the public origin. `/health` is the health endpoint. `TRIVIA_LIVE=false` enables curated-only play. The retained Node server supports SSE and the shared browser client's polling endpoint; disable buffering for `/api/events` and redact session query parameters in proxy logs. Restarting the Node process resets its rooms.

The Dockerfile runs this Node runtime, not the Sites Worker:

```sh
docker build -t trivia-stakes .
docker run --rm -p 3000:3000 trivia-stakes
```

Docker and physical-device checks have not been verified as part of this source synchronization.

## Source synchronization

GitHub and Sites have separate source repositories. GitHub CI installs dependencies from `package-lock.json`, runs syntax checks and all tests, then builds the Worker. It does not publish or change the production database.

For future Sites releases, open the existing project using the Sites workflow and a fresh short-lived source credential, reconcile GitHub changes into that checkout, validate and build, then push the exact release source to the Sites repository. Package that commit, save a version, and deploy it using the existing project's audience. Preserve the project ID and apply any new database migrations through the supported Sites database workflow. Never commit credentials, local runtime state, or environment files.

To import a future publication into GitHub, read its saved version's source SHA, fetch its source history into an isolated checkout, and merge that history into this repository. Compare the saved SHA with the fetched source before choosing the import; a newer source branch is not necessarily the currently published version. Retain GitHub-only docs and CI updates while resolving conflicts. Use ordinary commits and pushes rather than replacing Git metadata or force-pushing.

## Gameplay verification

Use two independent sessions or devices. Create and join a room, ready both players, select at least four categories, and start. Check bids, private answer options, the 100-point miss / 70-point correct example, bonus elimination, refresh recovery, and eight-round completion. Hosted polling, network latency, and database latency affect buzzer ordering. Timers advance when requests reach the authoritative service.
