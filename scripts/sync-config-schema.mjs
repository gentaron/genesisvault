#!/usr/bin/env bun
/**
 * Phase κ — Regenerate config/pipeline.schema.json from the Zod schema.
 *
 * The JSON Schema is committed so editors can autocomplete and validate
 * `config/pipeline.json` without running any project code. It is derived,
 * never hand-edited: `src/lib/pipeline/config.ts` is the source of truth.
 *
 * `bun run verify` fails if the committed file has drifted from the Zod
 * schema, so a schema change cannot silently ship without the JSON Schema.
 *
 *   bun run config:schema
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PipelineConfigSchema } from '../src/lib/pipeline/config.ts';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(rootDir, 'config', 'pipeline.schema.json');

/** Serialized exactly as the drift check in tests/pipeline-config.test.ts expects. */
export function renderSchema() {
  return `${JSON.stringify(z.toJSONSchema(PipelineConfigSchema, { io: 'input' }), null, 2)}\n`;
}

if (import.meta.main) {
  await writeFile(target, renderSchema(), 'utf-8');
  console.log(`✅ config/pipeline.schema.json を再生成しました`);
}
