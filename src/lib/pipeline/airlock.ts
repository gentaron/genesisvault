/**
 * Phase Ω — Airlock: Agent Inter-Process Data Integrity
 *
 * Implements SHA-256 chained packets between agent stages.
 * Inspired by claude-obsidian's airlock pattern for immutable
 * knowledge transfer between agents.
 *
 * Each agent's output is sealed with a hash before passing to the next.
 * The judge (or any verifier) can replay the chain to confirm no
 * data was tampered with or dropped between stages.
 *
 * @module pipeline/airlock
 */

import { createHash } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────

export type AgentId =
  | 'scout' | 'researcher' | 'balancer' | 'ceo'
  | 'seo' | 'writer' | 'editor' | 'summarizer'
  | 'recorder' | 'briefer' | 'symbolic_guard';

export interface AgentPacket {
  payload: unknown;
  from: AgentId;
  to: AgentId;
  prevSha256: string;
  timestamp: string;
  provenance: string[];
}

export interface SealedPacket extends AgentPacket {
  sha256: string;
}

// ─── Hash Utilities ──────────────────────────────────────────

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function serializePayload(payload: unknown): string {
  return JSON.stringify(payload, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}

// ─── Seal & Verify ───────────────────────────────────────────

/**
 * Seal an agent packet: compute SHA-256 of payload + prev hash.
 * The chain property ensures tampering is detectable.
 */
export function sealPacket(packet: AgentPacket): SealedPacket {
  const payloadStr = serializePayload(packet.payload);
  const hashInput = payloadStr + ':' + packet.prevSha256;
  const hash = sha256(hashInput);
  return {
    ...packet,
    sha256: hash,
    timestamp: packet.timestamp || new Date().toISOString(),
  };
}

/**
 * Verify a complete chain of sealed packets.
 * Returns true if every link in the chain is intact.
 */
export function verifyChain(packets: SealedPacket[]): {
  if (packets.length === 0) return true;

  // First packet: prevSha256 must be empty or 'genesis'
  if (packets[0].prevSha256 !== '' && packets[0].prevSha256 !== 'genesis') {
    return false;
  }

  // Verify each packet's hash and chain link
  for (let i = 0; i < packets.length; i++) {
    const p = packets[i];
    const payloadStr = serializePayload(p.payload);
    const expectedHash = sha256(payloadStr + ':' + p.prevSha256);
    if (p.sha256 !== expectedHash) return false;

    // Verify chain link
    if (i > 0) {
      if (p.prevSha256 !== packets[i - 1].sha256) return false;
    }
  }

  return true;
}

/**
 * Create an initial packet (no previous hash — genesis).
 */
export function createGenesisPacket(
  from: AgentId,
  to: AgentId,
  payload: unknown,
  provenance: string[] = [],
): SealedPacket {
  return sealPacket({
    payload,
    from,
    to,
    prevSha256: 'genesis',
    timestamp: new Date().toISOString(),
    provenance,
  });
}

/**
 * Create a chained packet that follows a previous one.
 */
export function chainPacket(
  prev: SealedPacket,
  from: AgentId,
  to: AgentId,
  payload: unknown,
  provenance: string[] = [],
): SealedPacket {
  return sealPacket({
    payload,
    from,
    to,
    prevSha256: prev.sha256,
    timestamp: new Date().toISOString(),
    provenance: [
      ...new Set([...prev.provenance, ...provenance]),
    ],
  });
}

/**
 * Extract the full provenance path from a chain.
 * Returns all upstream node IDs that contributed to the final output.
 */
export function extractProvenance(packets: SealedPacket[]): string[] {
  if (packets.length === 0) return [];
  const last = packets[packets.length - 1];
  return last.provenance;
}
