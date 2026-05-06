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
