# Architecture and decisions

## Published Sites runtime

The published game runs in Cloudflare Workers through Vinext. `app/api/[...path]/route.ts` passes requests to `lib/room-service.mjs` with the D1 `DB` binding. D1 stores room snapshots, hashed sessions, rate limits, trivia cache entries, and recent-question fingerprints. Revision-checked conditional updates retry competing mutations, preventing lost joins or duplicate buzzer winners. `db/schema.ts` and `drizzle/` describe this storage.

The shared browser client polls authoritative state 500 ms after a successful response, or 1.5 seconds after a failed request. Requests advance expired deadlines; the hosted runtime has no process-local timer loop. Question options remain private to the answering player. Room state persists outside individual Worker invocations, with six-hour inactivity expiry. Live-question preparation uses a database lease to coordinate upstream requests across rooms.

The sections below describe the retained standalone Node runtime. It shares `shared/game.js`, the curated bank, and browser assets with Sites, but keeps rooms and sessions in memory. Its SSE transport and timer loop remain available; the current browser client uses polling in both runtimes. Node sessions and hosted D1 sessions are separate.

## Data flow

A browser sends a create, join, or game action over HTTP. The room service authenticates its session and advances any expired deadline. The game engine validates the action against the current phase, active player, turn identifier, and balance. The service then sends an individualized public snapshot to every room member over server-sent events.

The browser renders that snapshot and uses server time to calculate its countdown. Changing a device clock does not change the server’s scoring or deadline. The server checks deadlines every 100 milliseconds and again before every action. Multiple-choice options are included only in the active answering player's snapshot. The submitted option ID is validated against that question and turn; raw answer text is not accepted.

## State machine

```text
lobby → bidding → answer → result → next bidding / finished
                     ↓ all bidders miss
                bonus-intro
                     ↓ ready / reading timeout
                bonus-countdown → bonus-buzz → bonus-answer
                                      ↓             ↓
                                no buzz: result     correct: result
                                                    miss: fresh countdown
                                                    all miss: result
```

Each fresh bonus question excludes every player who has already missed during that bonus sequence. A new regular round resets this exclusion list. The deck is shuffled once per game and consumed without replacement, with enough questions for an eight-player worst-case game.

## Why SSE rather than WebSockets?

Players issue occasional discrete actions. Most communication is the server pushing state to connected browsers. SSE provides that direction with built-in reconnect behavior, while regular HTTP makes action failures and validation straightforward to test. It can be replaced with WebSockets if the product later requires high-frequency bidirectional interactions.

## Live question preparation

Each room asynchronously prepares its deck in the lobby. A single server-wide provider queues upstream requests at least 5.1 seconds apart and shares an in-flight refresh among concurrent lobbies. It obtains an Open Trivia Database session token and requests up to 50 medium multiple-choice questions using URL3986 encoding. A request times out after five seconds. Invalid, duplicated, or recently played prompts are excluded, and local questions fill the deck to 80. An upstream failure enters a one-minute retry cooldown while the curated bank keeps rooms playable.

No upstream calls occur during bidding, answer turns, or bonus timers. A rematch prepares a new deck before starting. Played question fingerprints are tracked in a bounded, process-local history; unused deck entries do not enter that history. When unseen prompts run out, the oldest played local prompts return. The cache and history are intentionally ephemeral in this first version.

## Why one room state object?

The first version prioritizes transparent rules and race-free behavior in a single process. Room mutations contain no asynchronous work. Two buzzer requests are therefore processed in order; the second sees an occupied buzzer. A turn identifier also rejects retries that refer to a previous phase, answer turn, or question.

The server hides the question during bidding and countdowns. During an answer turn, it sends four shuffled options only to the active player, including the correct answer without a correctness marker. It never sends the accepted-answer metadata or the selected wrong option to other players. The correct answer is revealed after that question is resolved.

## Sessions and lifecycle

Session tokens use 32 cryptographically random bytes; player identifiers are separate. A browser tab stores its token in session storage. A refresh reconnects to the same room and player. If the host loses every stream for 15 seconds, another connected player becomes host. A disconnected player’s answer timeout still counts as a miss. The host can remove disconnected players from the lobby so readiness does not become blocked.

Inactive rooms expire after six hours. The process limits room creation, actions per IP address, total rooms, incoming body size, and streams per player. It escapes user-generated UI text and applies a restrictive content security policy. Production must use HTTPS. Proxy access logs should avoid recording the SSE URL’s session query parameter.

These are initial safeguards, not a claim of independent security audit. A public launch should verify host-specific proxy behavior and capacity.

## Portfolio discussion points

- Precisely translating a verbal scoring example into invariants and tests.
- Designing progressive instructions without hiding complete rules.
- Preventing duplicate awards and stale-input races with server authority and turn identifiers.
- Choosing a transport based on traffic direction rather than defaulting to WebSockets.
- Explaining the single-process tradeoff and the path to durable rooms and multiple instances.

## Next production steps

Verify the published Sites version on two physical devices. Add observability, larger question coverage, and accessibility testing with real players. The standalone Node runtime still needs durable storage before scaling to multiple instances; the hosted runtime already uses D1 and conditional room updates. See [deployment instructions](deployment.md) for both paths.
