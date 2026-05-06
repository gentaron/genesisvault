/**
 * Phase γ — Agent Telemetry
 *
 * Records per-agent-call telemetry to `logs/agent-runs.jsonl`.
 * Each line is a JSON object with timestamp, agentId, provider,
 * latency, success/failure, and optional error details.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'agent-runs.jsonl');

export interface TelemetryEntry {
  timestamp: string;
  agentId: string;
  agentName: string;
  provider: string;
  attempts: number;
  latencyMs: number;
  success: boolean;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  errors?: { provider: string; message: string }[];
}

let initialized = false;

async function ensureLogDir() {
  if (!initialized) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    initialized = true;
  }
}

export async function recordTelemetry(entry: TelemetryEntry): Promise<void> {
  try {
    await ensureLogDir();
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(LOG_FILE, line, 'utf-8');
  } catch {
    // Telemetry should never break the pipeline
  }
}

export async function readRecentTelemetry(lines = 50): Promise<TelemetryEntry[]> {
  try {
    await ensureLogDir();
    const raw = await fs.readFile(LOG_FILE, 'utf-8');
    const allLines = raw.trim().split('\n').filter(Boolean);
    const recent = allLines.slice(-lines);
    return recent.map(line => JSON.parse(line));
  } catch {
    return [];
  }
}
