# Genesis Vault — Lore-Tech Mapping

This document maps narrative concepts from the Genesis Vault lore to their technical implementations.

## Liminal Forge → Multi-Agent AI Pipeline
The "dimensional broadcast studio" is implemented as a sequential 5-agent pipeline.
Each agent (Nova, Lena, Chloe, Sophia, Iris) corresponds to a persona prompt in `scripts/auto-post.mjs`.
The "Apolonium substrate" is the free-tier Gemini API.

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

## Theme Balance → Narrative Entropy Management
The Nova Harmon agent's theme-balance scoring system prevents "narrative collapse"
— the tendency for content to converge on a single topic. Nine theme categories
ensure maximum diversity.

## Dark Mode → Temporal Phase Shift
The light/dark mode toggle represents the user's ability to shift between
"waking consciousness" (light) and "contemplative depth" (dark) viewing modes.

## The Five Agents → Archetypal Subroutines
- **Nova Harmon (Balancer)**: The strategic overview. Sees all possible futures.
- **Lena Strauss (CEO)**: The decision engine. Chooses the path.
- **Chloe Verdant (SEO)**: The signal amplifier. Ensures reach.
- **Sophia Nightingale (Writer)**: The voice synthesizer. Channels Mina's essence.
- **Iris Koenig (Editor)**: The quality gate. Maintains coherence.
