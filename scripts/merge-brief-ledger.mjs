#!/usr/bin/env bun
/**
 * Conflict resolver for `data/video-briefs.json`.
 *
 * Runs from `scripts/push-with-rebase.sh` while a rebase is stopped on a
 * conflict in the brief ledger. The ledger is append-only and keyed by
 * slug, so the two sides never actually disagree — they each appended a
 * different article at the end of the same array. The resolution is the
 * union of both (see `mergeLedgers`).
 *
 * `merge=union` in `.gitattributes` is the equivalent fix for the plain-text
 * logs, but it cannot be used here: this file is JSON, and union would
 * splice both arrays together into broken syntax *without* reporting a
 * conflict, so nobody would find out (LM-015).
 *
 * Reads the two sides straight out of the index rather than the working
 * tree, because the working tree copy is the one with conflict markers in
 * it:
 *
 *   :2:<path>  ours   — during a rebase this is upstream (origin/main)
 *   :3:<path>  theirs — during a rebase this is the commit being replayed
 *
 * The merge is symmetric, so that inversion does not change the result;
 * it is spelled out because reading it backwards is the usual way to get
 * a rebase resolution wrong.
 *
 * Usage: bun scripts/merge-brief-ledger.mjs [path]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { mergeLedgers, parseLedger, renderLedger } from '../src/lib/pipeline/video-brief.ts';

const LEDGER_PATH = process.argv[2] ?? 'data/video-briefs.json';

/** Read one merge stage. A side that has no stage (added on the other side only) reads as empty. */
function readStage(stage, file) {
  const out = spawnSync('git', ['show', `:${stage}:${file}`], { encoding: 'utf-8' });
  return out.status === 0 ? out.stdout : '';
}

const ours = readStage(2, LEDGER_PATH);
const theirs = readStage(3, LEDGER_PATH);

if (!ours && !theirs) {
  console.error(
    `merge-brief-ledger: ${LEDGER_PATH} の衝突ステージが読めません（衝突中ではない？）`,
  );
  process.exit(1);
}

const merged = mergeLedgers(parseLedger(ours), parseLedger(theirs));
fs.writeFileSync(LEDGER_PATH, renderLedger(merged), 'utf-8');

const before = Math.max(parseLedger(ours).briefs.length, parseLedger(theirs).briefs.length);
console.log(
  `  🔀 ${LEDGER_PATH}: ${before} → ${merged.briefs.length} 件に統合（両側の記録を残しました）`,
);
