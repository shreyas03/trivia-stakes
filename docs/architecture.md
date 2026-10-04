# Architecture and decisions

## Data flow

A browser sends a create, join, or game action over HTTP. The room service authenticates its session and advances any expired deadline. The game engine validates the action against the current phase, active player, turn identifier, and balance. The service then sends an individualized public snapshot to every room member over server-sent events.

The browser renders that snapshot and uses server time to calculate its countdown. Changing a device clock does not change the server’s scoring or deadline. The server checks deadlines every 100 milliseconds and again before every action.

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

## Why one room state object?

The first version prioritizes transparent rules and race-free behavior in a single process. Room mutations contain no asynchronous work. Two buzzer requests are therefore processed in order; the second sees an occupied buzzer. A turn identifier also rejects retries that refer to a previous phase, answer turn, or question.

The server hides the question during bidding and countdowns, and never exposes its accepted answers through the state API. Private answer data remains in server source. Revealed answers are shown only after the question is resolved.

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

Verify on two physical devices. Choose a Node-capable public host. Add durable room storage if games must survive restarts. For multiple instances, use shared atomic room updates or one authoritative actor per room and fan updates out through a broker. Add observability, larger question coverage, and accessibility testing with real players.
