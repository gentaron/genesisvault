/**
 * Phase θ — Pipeline State Machine
 *
 * Models the daily-post pipeline as an explicit state machine with
 * discriminated union types. Each state transition is a pure function.
 * The driver loop reads state, runs the next agent, persists state, repeats.
 *
 * State is persisted to `.pipeline-state/{runId}.json` (gitignored).
 * In CI, persisted as workflow artifact for resume capability.
 */

import type { CEOPlan, SEOData } from '../agents/runners.js';

// ─── Agent identifiers ─────────────────────────────────────────

export type AgentId = 'nova' | 'lena' | 'chloe' | 'sophia' | 'iris';

export const AGENT_IDS: AgentId[] = ['nova', 'lena', 'chloe', 'sophia', 'iris'];

export const AGENT_NAMES: Record<AgentId, string> = {
  nova: 'Nova Harmon',
  lena: 'Lena Strauss',
  chloe: 'Chloe Verdant',
  sophia: 'Sophia Nightingale',
  iris: 'Iris Koenig',
};

export const AGENT_FULL_IDS: Record<AgentId, string> = {
  nova: 'VE-005',
  lena: 'VE-001',
  chloe: 'VE-003',
  sophia: 'VE-002',
  iris: 'VE-006',
};

// ─── Pipeline state (discriminated union) ─────────────────────

export type PipelineState =
  | { phase: 'idle' }
  | { phase: 'nova-running'; runId: string; startedAt: string }
  | { phase: 'nova-done'; runId: string; startedAt: string; nova: string; novaMeta: AgentRunMeta }
  | { phase: 'lena-running'; runId: string; startedAt: string; nova: string; novaMeta: AgentRunMeta }
  | { phase: 'lena-done'; runId: string; startedAt: string; nova: string; novaMeta: AgentRunMeta; lena: CEOPlan; lenaMeta: AgentRunMeta }
  | { phase: 'chloe-running'; runId: string; startedAt: string; nova: string; novaMeta: AgentRunMeta; lena: CEOPlan; lenaMeta: AgentRunMeta }
  | { phase: 'chloe-done'; runId: string; startedAt: string; nova: string; novaMeta: AgentRunMeta; lena: CEOPlan; lenaMeta: AgentRunMeta; chloe: SEOData; chloeMeta: AgentRunMeta }
  | { phase: 'sophia-running'; runId: string; startedAt: string; nova: string; novaMeta: AgentRunMeta; lena: CEOPlan; lenaMeta: AgentRunMeta; chloe: SEOData; chloeMeta: AgentRunMeta }
  | { phase: 'sophia-done'; runId: string; startedAt: string; nova: string; novaMeta: AgentRunMeta; lena: CEOPlan; lenaMeta: AgentRunMeta; chloe: SEOData; chloeMeta: AgentRunMeta; sophia: string; sophiaMeta: AgentRunMeta }
  | { phase: 'iris-running'; runId: string; startedAt: string; nova: string; novaMeta: AgentRunMeta; lena: CEOPlan; lenaMeta: AgentRunMeta; chloe: SEOData; chloeMeta: AgentRunMeta; sophia: string; sophiaMeta: AgentRunMeta }
  | { phase: 'iris-done'; runId: string; startedAt: string; nova: string; novaMeta: AgentRunMeta; lena: CEOPlan; lenaMeta: AgentRunMeta; chloe: SEOData; chloeMeta: AgentRunMeta; sophia: string; sophiaMeta: AgentRunMeta; iris: string; irisMeta: AgentRunMeta }
  | { phase: 'quality-check'; runId: string; startedAt: string; nova: string; novaMeta: AgentRunMeta; lena: CEOPlan; lenaMeta: AgentRunMeta; chloe: SEOData; chloeMeta: AgentRunMeta; sophia: string; sophiaMeta: AgentRunMeta; iris: string; irisMeta: AgentRunMeta }
  | { phase: 'committing'; runId: string; startedAt: string; articleSlug: string; articlePath: string }
  | { phase: 'done'; runId: string; startedAt: string; completedAt: string; articleSlug: string }
  | { phase: 'failed'; runId: string; startedAt: string; failedAt: AgentId; error: string; failedPhase: string };

// ─── Agent run metadata (recorded per phase) ──────────────────

export interface AgentRunMeta {
  provider: string;
  attempts: number;
  latencyMs: number;
  promptVersion: string;
  timestamp: string;
}

// ─── State transition helpers (pure functions) ────────────────

/** Get the next agent to run from the current state. Returns null if done/failed/idle. */
export function getNextAgent(state: PipelineState): AgentId | null {
  switch (state.phase) {
    case 'idle':
    case 'failed':
    case 'done':
      return null;
    case 'nova-running':
      return 'nova';
    case 'nova-done':
      return 'lena';
    case 'lena-running':
      return 'lena';
    case 'lena-done':
      return 'chloe';
    case 'chloe-running':
      return 'chloe';
    case 'chloe-done':
      return 'sophia';
    case 'sophia-running':
      return 'sophia';
    case 'sophia-done':
      return 'iris';
    case 'iris-running':
      return 'iris';
    case 'iris-done':
    case 'quality-check':
    case 'committing':
      return null;
  }
}

/** Check if the pipeline is in a terminal state. */
export function isTerminal(state: PipelineState): boolean {
  return state.phase === 'done' || state.phase === 'failed';
}

/** Check if the pipeline is currently running an agent. */
export function isRunning(state: PipelineState): boolean {
  return state.phase.endsWith('-running');
}

/** Extract all preserved agent outputs from a state (for resume). */
export function extractPreservedOutputs(state: PipelineState): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  if ('nova' in state && typeof state.nova === 'string') outputs.nova = state.nova;
  if ('lena' in state && typeof state.lena === 'object') outputs.lena = state.lena;
  if ('chloe' in state && typeof state.chloe === 'object') outputs.chloe = state.chloe;
  if ('sophia' in state && typeof state.sophia === 'string') outputs.sophia = state.sophia;
  if ('iris' in state && typeof state.iris === 'string') outputs.iris = state.iris;
  return outputs;
}

// ─── Run ID generation (deterministic) ────────────────────────

/**
 * Generate a deterministic runId from the target date.
 * Same date = same runId = idempotent checkpoint matching.
 * Format: `run-YYYY-MM-DD-{hash}`
 */
export function generateRunId(targetDate: string): string {
  // Simple hash from date string
  let hash = 0;
  for (let i = 0; i < targetDate.length; i++) {
    const char = targetDate.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const hexHash = Math.abs(hash).toString(36).substring(0, 6);
  return `run-${targetDate}-${hexHash}`;
}

// ─── Checkpoint persistence ───────────────────────────────────

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const CHECKPOINT_DIR = path.join(ROOT_DIR, '.pipeline-state');

/** Save pipeline state to checkpoint file. */
export async function saveCheckpoint(state: PipelineState): Promise<void> {
  await fs.mkdir(CHECKPOINT_DIR, { recursive: true });
  const runId = 'runId' in state ? state.runId : 'unknown';
  const filePath = path.join(CHECKPOINT_DIR, `${runId}.json`);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

/** Load pipeline state from checkpoint file. Returns null if not found. */
export async function loadCheckpoint(runId: string): Promise<PipelineState | null> {
  try {
    const filePath = path.join(CHECKPOINT_DIR, `${runId}.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as PipelineState;
  } catch {
    return null;
  }
}

/** Load the latest checkpoint (most recently modified file). Returns null if none. */
export async function loadLatestCheckpoint(): Promise<PipelineState | null> {
  try {
    await fs.mkdir(CHECKPOINT_DIR, { recursive: true });
    const files = await fs.readdir(CHECKPOINT_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
    if (jsonFiles.length === 0) return null;
    // Load the most recent (last alphabetically = latest runId)
    const latest = jsonFiles[jsonFiles.length - 1];
    const raw = await fs.readFile(path.join(CHECKPOINT_DIR, latest), 'utf-8');
    return JSON.parse(raw) as PipelineState;
  } catch {
    return null;
  }
}

/** Delete a checkpoint file. */
export async function deleteCheckpoint(runId: string): Promise<void> {
  try {
    const filePath = path.join(CHECKPOINT_DIR, `${runId}.json`);
    await fs.unlink(filePath);
  } catch {
    // Ignore — checkpoint may not exist
  }
}

/** Delete all checkpoint files. */
export async function clearAllCheckpoints(): Promise<void> {
  try {
    const files = await fs.readdir(CHECKPOINT_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        await fs.unlink(path.join(CHECKPOINT_DIR, file));
      }
    }
  } catch {
    // Ignore
  }
}
