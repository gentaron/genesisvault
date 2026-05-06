/**
 * Phase θ — Pipeline Resume CLI
 *
 * Usage: bun run gen:resume [runId]
 *
 * Resumes a partially-failed pipeline from the last checkpoint.
 * If no runId is provided, loads the latest checkpoint.
 */

import { loadLatestCheckpoint, loadCheckpoint, isTerminal, getNextAgent, type PipelineState } from '../src/lib/pipeline/state.js';

async function main() {
  const runIdArg = process.argv[2];
  let state: PipelineState | null;

  if (runIdArg) {
    state = await loadCheckpoint(runIdArg);
    if (!state) {
      console.error(`Checkpoint not found for runId: ${runIdArg}`);
      process.exit(1);
    }
  } else {
    state = await loadLatestCheckpoint();
    if (!state) {
      console.error('No checkpoints found. Run the pipeline first.');
      process.exit(1);
    }
  }

  const stateRunId = 'runId' in state ? state.runId : 'unknown';

  if (isTerminal(state)) {
    if (state.phase === 'done') {
      console.log(`Pipeline ${stateRunId} already completed successfully.`);
    } else if (state.phase === 'failed') {
      console.log(`Pipeline ${stateRunId} failed at ${state.failedAt}: ${state.error}`);
      console.log(`To retry, delete the checkpoint and run: bun run auto-post`);
    }
    process.exit(0);
  }

  const nextAgent = getNextAgent(state);
  console.log(`\nResuming pipeline ${stateRunId}`);
  console.log(`Current phase: ${state.phase}`);
  console.log(`Next agent: ${nextAgent || 'none (quality check or committing)'}`);
  console.log(`\nTo continue, run: bun run auto-post`);
  console.log(`(The pipeline will detect the checkpoint and resume from ${state.phase})\n`);
}

main().catch(console.error);
