/**
 * Phase θ — Prompt Version Manager
 *
 * Reads the current prompt version for each agent from the prompts/ directory.
 * The version used for each run is recorded in the article frontmatter.
 *
 * Structure:
 *   prompts/
 *     nova/v1.0.0.md
 *     lena/v1.0.0.md
 *     ...
 *
 * Current version is determined by the latest file in each agent's directory.
 */

import fs from 'fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const PROMPTS_DIR = path.join(ROOT_DIR, 'prompts');

export type AgentId = 'nova' | 'lena' | 'chloe' | 'sophia' | 'iris';

export interface PromptVersion {
  agent: AgentId;
  version: string;
  path: string;
}

/** Get the current (latest) prompt version for an agent. */
export async function getCurrentPromptVersion(agent: AgentId): Promise<PromptVersion> {
  const agentDir = path.join(PROMPTS_DIR, agent);
  try {
    const files = await fs.readdir(agentDir);
    const mdFiles = files.filter(f => f.endsWith('.md') && f !== 'CHANGELOG.md');
    // Sort by semver descending (simple version sort)
    mdFiles.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const latest = mdFiles[0];
    if (latest) {
      const version = latest.replace('.md', '');
      return { agent, version, path: path.join(agentDir, latest) };
    }
  } catch {
    // Agent directory doesn't exist
  }
  return { agent, version: '1.0.0', path: '' };
}

/** Get all agents' current prompt versions. */
export async function getAllPromptVersions(): Promise<Record<AgentId, PromptVersion>> {
  const agents: AgentId[] = ['nova', 'lena', 'chloe', 'sophia', 'iris'];
  const versions: Record<string, PromptVersion> = {};
  for (const agent of agents) {
    versions[agent] = await getCurrentPromptVersion(agent);
  }
  return versions as Record<AgentId, PromptVersion>;
}

/** Read the prompt file content for a specific agent + version. */
export async function readPrompt(agent: AgentId, version?: string): Promise<string> {
  const promptVersion = version
    ? { agent, version, path: path.join(PROMPTS_DIR, agent, `${version}.md`) }
    : await getCurrentPromptVersion(agent);

  if (!promptVersion.path) return '';
  try {
    return await fs.readFile(promptVersion.path, 'utf-8');
  } catch {
    return '';
  }
}
