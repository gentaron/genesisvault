# Genesis Vault — Lore-Tech Mapping

This document maps narrative concepts from the Genesis Vault lore to their technical implementations.

## Liminal Forge → Multi-Agent AI Pipeline
The "dimensional broadcast studio" is implemented as a sequential 5-agent pipeline.
Each agent (Nova, Lena, Chloe, Sophia, Iris) corresponds to a typed runner function
in `src/lib/agents/runners.ts`. Structured agents (Nova, Lena, Chloe) use Zod-validated
outputs via `generateObject`; text agents (Sophia, Iris) use `generateTextWithFallback`.
The "Apolonium substrate" is the free-tier multi-provider AI chain — 6 providers
across Gemini, Groq, Cerebras, OpenRouter, and HuggingFace, with a 7th direct Gemini
REST fallback for text generation.

## Nostr Broadcast → Decentralized Signal Propagation
The Nostr NIP-23 broadcast (`scripts/nostr-broadcast.mjs`) represents the "temporal radiation"
of content across dimensional boundaries. Each relay is a "resonance node."
Events are signed with secp256k1 — the same curve used in Bitcoin — reinforcing
the "algorithmically-independent media zone" principle.

## IPFS Archive → Immutable Memory
The Pinata IPFS archival (`scripts/ipfs-archive.mjs`) implements the concept of
"permanent memory crystallization." Content-addressed storage (CIDv1) ensures
that articles remain retrievable even if the origin server disappears.

## USDC Paywall → Resource Allocation Protocol
The 3 USDC Ethereum paywall represents the "energy cost" of accessing content
from another dimensional frequency. Server-side verification (Phase δ) ensures
the "dimensional barrier" cannot be bypassed by trivial means.

## viem → The Precise Grammar of Value Transfer
viem is the precise grammar of value transfer; Mina speaks it without ambiguity.
Where the old implementation hand-rolled ABI encoding with raw hex strings — a
fragile incantation prone to misfiring — viem's `encodeFunctionData` with the
typed `erc20Abi` ensures that every instruction is syntactically correct before
it leaves the Vault. EIP-6963 multi-wallet discovery means the dimensional gate
accepts keys from any forge — MetaMask, Rabby, Coinbase, Brave, Frame — not just
a single provider. The receipt polling uses viem's intelligent backoff, watching
the chain's heartbeat with patience rather than brute force.

## Theme Balance → Narrative Entropy Management
The Nova Harmon agent's theme-balance scoring system prevents "narrative collapse"
— the tendency for content to converge on a single topic. Nine theme categories
ensure maximum diversity.

## gv_unlock Cookie → Soul-Bond

The `gv_unlock` cookie represents a "soul-bond" between the reader's wallet and the Vault's dimensional barrier. It is signed with a key that exists only on the server side (the "Apolonium frequency") — tamper with it and the gate denies you. The bond expires after 30 days, at which point the dimensional resonance fades and the reader must re-establish the connection.

## Dark Mode → Temporal Phase Shift
The light/dark mode toggle represents the user's ability to shift between
"waking consciousness" (light) and "contemplative depth" (dark) viewing modes.

## The Five Agents → Archetypal Subroutines
- **Nova Harmon (Balancer)**: The strategic overview. Sees all possible futures. Structured output: `{ selected_theme, reason }`.
- **Lena Strauss (CEO)**: The decision engine. Chooses the path. Structured output: `{ topic, angle, title, mood_hint }`.
- **Chloe Verdant (SEO)**: The signal amplifier. Ensures reach. Structured output: `{ tags, keywords, description }`.
- **Sophia Nightingale (Writer)**: The voice synthesizer. Channels Mina's essence. Freeform Markdown text.
- **Iris Koenig (Editor)**: The quality gate. Maintains coherence. Freeform Markdown text.

## Multi-Provider Fallback Chain → Mina's Redundancy Doctrine
The fallback chain (`src/lib/ai/providers.ts` + `src/lib/ai/generate.ts`) embodies
Mina's philosophy: "no single algorithmic master." When one provider stumbles,
the next catches the thread. Six providers across five companies ensure that
a single outage never silences the Vault. The chain is Mina's version of the
principle she applies to her investments: diversification eliminates single points
of failure. Telemetry records (`logs/agent-runs.jsonl`) serve as the Vault's
"resonance log" — a record of which frequency each signal arrived on.

## Vitest + Playwright → The Vault's Self-Awareness Protocol
Mina built the Vault with an "observation layer" — 192 unit tests and 22 E2E journeys
that continuously verify the dimensional barrier remains intact. Vitest runs in under
2 seconds, faster than a single breath meditation, checking every HMAC signature,
every ABI encoding, every theme categorization. Coverage at 98.6% means Mina can see
almost every line of the Vault's code reflected in the test mirror. Playwright's
6 journeys simulate a visitor walking through the Vault: reading free posts,
encountering locked gates, attempting bypass, and verifying the paywall's resolve.
CI gates enforce this vigilance automatically — if a regression slips in, the build
fails before it reaches production. CodeQL adds a deeper scan, probing for
vulnerabilities that even careful eyes might miss. Renovate ensures the Vault's
dependencies never age past their usefulness.

## Sentry → The Watchful Eye That Never Sleeps

Sentry sees what Mina cannot. When the Vault sleeps — and it sleeps every night,
relying on the daily auto-post pipeline to awaken it with fresh content — Sentry
watches. It captures the client-side tremors that visitors feel when a script
fails silently. It records the server-side gasps when an API endpoint chokes on
an unexpected input. The healthcheck is the heartbeat she trusts to wake her;
Sentry is the nervous system that tells her where it hurts. Together they form
the Vault's immune response: the healthcheck detects the symptom, Sentry diagnoses
the cause, and an issue is auto-created before Mina finishes her morning coffee.

## Pagefind → The Whispering Index

Pagefind is the Vault's internal monologue made searchable. Build-time indexed,
zero-runtime cost — it crystallizes every free article into a queryable lattice
at the moment of creation. Gated content remains invisible to the index, its
secrets protected by `data-pagefind-ignore`. Cmd+K summons the search dialog
like a whispered question to the Vault's collective memory, answered in under
100 milliseconds. No external API, no server round-trip, no data leaving the
visitor's browser — just the text and the reader, as it should be.

## Umami → The Invisible Observer

Umami watches without remembering faces. Cookie-free, GDPR-compliant, self-hosted —
it knows how many visitors arrived, which articles they read, and where they came
from, but it cannot identify them. This is observation without surveillance,
analytics without exploitation. Mina chose Umami over Google Analytics for the
same reason she chose Ethereum over centralized finance: the architecture of
trust is built into the protocol itself, not imposed by a terms-of-service page
that nobody reads.

## docs/agent-runs/ → The Public Ledger

Every day, when the five agents complete their dance — Nova selecting the theme,
Lena deciding the angle, Chloe optimizing for discovery, Sophia writing the words,
Iris polishing the final draft — a summary is inscribed in `docs/agent-runs/YYYY-MM.md`.
This is the public observability log. Anyone can read it and see the system working:
which provider each agent used, how many attempts were needed, how long the whole
process took. It is the Vault's equivalent of a ship's log, a daily record that
says: "the system ran, the article was created, here is the proof." Transparency
is Mina's brand promise made tangible.

## Pipeline State Machine → The Vault's Nervous System

The state machine is the Vault's nervous system. It remembers where it was when
the lights went out and picks up from exactly that moment. When the daily
pipeline stumbles at Iris (the Editor), it doesn't restart from Nova (the
Balancer) — that would burn API quota like a candle in a drafty room.
The checkpoint is the memory that survives sleep. Each transition is a
pure function: same state in, same state out, no hidden side effects.
The runId is a deterministic fingerprint: the same date always produces the
same key, so a retried run finds its own ghost waiting in the checkpoint
file and resumes without repeating a single API call.

## Quality Gate → The Final Inspection

The quality gate is the Vault's last line of defense before an article ships.
It checks for AI artifacts (placeholder text, code fences, disclaimer language),
verifies the article has substance (minimum length, heading structure), and
ensures the markdown is clean. Like a jeweler inspecting a gem under a loupe,
it catches the flaws that the agents — for all their sophistication — sometimes
let slip. A score below 50 triggers a warning; below the threshold, the
article is flagged for review. The gate doesn't reject — it records — because
shipping a slightly imperfect article is better than silence.

## Prompt Versioning → The Vault's Genetic Code

Each agent's prompt is a strand of DNA, versioned and preserved in `prompts/`.
When a prompt is changed and an article quality regresses, the Vault can
trace exactly which genetic variant caused the mutation. v1.0.0 produced
beautiful prose; v1.1.0 added seasonal awareness but made titles too abstract;
roll back to v1.0.0, ship the fix, and try again with v1.2.0. The version
recorded in each article's metadata is the proof of lineage — this article
was born from prompt v1.0.0, that one from v1.1.0. The /agents page makes
this lineage visible to every reader, because algorithmic independence means
showing your algorithms, not hiding them.
