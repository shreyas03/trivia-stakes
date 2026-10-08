# Live questions

## Hosted runtime

The published Sites runtime implements question preparation in `lib/trivia.mjs`. D1 persists the cache and recent prompts, and a database lease coordinates upstream requests across rooms. Worker restarts do not clear this database state. The process-local queue, environment switch, and restart behavior described below apply to `server/trivia.js` in the standalone Node runtime. Both runtimes prepare decks before play and retain curated fallback.

## Behavior

Open Trivia Database is the default live source. It requires no API key. While people join a room, the server requests a session token and a batch of up to 50 medium-difficulty multiple-choice questions. The remaining slots in an 80-question deck come from the curated bank, preserving specialist coverage and enough questions for the worst-case 72-question game.

Requests are server-side: player names, room codes, scores, and player session credentials are never sent upstream. The service receives ordinary network request metadata and its own trivia session token. The browser receives no question deck or accepted-answer metadata. During an answer turn it receives only the four options for that active player, as before.

Question text and options are decoded from the service's URL3986 format, checked for lengths and four distinct nonempty choices, and escaped when rendered. The adapter rejects true/false questions and any difficulty other than medium. Some external category names are mapped to the game's shorter labels. Answer-option order is shuffled by the game engine.

## Reliability and repeats

- One shared request queue spaces all upstream calls by at least 5.1 seconds.
- Concurrent room loaders share a batch refresh. Rooms with fewer live questions receive more curated questions.
- Each request has a five-second timeout. After failure the provider suppresses new attempts for one minute.
- Expired or exhausted upstream session tokens are discarded for a future attempt; the current room falls back immediately.
- Decks are fully prepared before start. Timed play makes no external requests.
- Both sources are deduplicated within a deck. The last 500 played question fingerprints are remembered for the current server process.
- Unseen questions are placed before repeats. If the finite local bank is exhausted, its least recently played prompts return.
- Restarting the server clears cache and history. This is repeat minimization, not a permanent never-repeat guarantee.

The initial token request and required spacing typically add several seconds of lobby preparation. Readiness stays available while loading; Start becomes available once preparation and player readiness are complete.

Set `TRIVIA_LIVE=false` in the process environment for fully offline play. The application does not read `.env` automatically. The curated fallback can be used without network access.

## Source and license

The service's [official documentation](https://opentdb.com/api_config.php) describes the medium filter, multiple-choice format, maximum 50 questions per request, five-second per-IP limit, session-token repeat control, and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) data license.

Rooms using live data display source attribution and a license link, with a note that category labels and option order were adapted. External question data is not committed into this repository. If it is exported or redistributed later, preserve source attribution, license information, and applicable ShareAlike terms. The game's independently authored code and curated bank have not been assigned a repository-wide license on the owner's behalf.

## Verification

Automated tests use an injected service rather than the public API. They cover valid and malformed data, rate spacing, concurrent rooms, outages, cooldowns, duplicate filtering, expired tokens, loading guards, and rematches. Existing tests cover scoring, private choices, and buzzer races.

A real service check during implementation returned **50 usable live questions plus 30 curated questions**, forming an 80-question deck. The provider's medium label is not independent factual verification or a measured difficulty guarantee; review competition content and collect playtest feedback.


### Host category selection
In the lobby, the host chooses at least four of the ten categories. All are selected by default. The same selection filters regular and bonus questions, including live questions and curated fallback. Changes reset player readiness and prepare a new deck; only the latest selection is applied. Rematches retain the selection.

A small selected bank may repeat questions after its unique prompts are consumed. The lobby displays this notice. A complete deck is prepared before play, so an outage or bonus-heavy game never adds an unselected category. Space and Motorsport currently use curated questions; live questions are matched to the other supported category labels. Cache and repeat history reset on server restart.
