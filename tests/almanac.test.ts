import { describe, expect, it } from 'vitest';
import { findDuplicateAdrNumbers } from '../scripts/build-almanac.mjs';

// ═══════════════════════════════════════════════════════════════
// Phase κ — Almanac (memory infrastructure)
// ═══════════════════════════════════════════════════════════════

describe('Phase κ — Almanac', () => {
  describe('findDuplicateAdrNumbers (LM-001 regression)', () => {
    it('finds nothing when every number is unique', () => {
      expect(findDuplicateAdrNumbers(['0001-a.md', '0002-b.md', '0014-c.md'])).toEqual([]);
    });

    it('detects the historical 0006/0008/0010 collisions', () => {
      const duplicates = findDuplicateAdrNumbers([
        '0006-test-strategy.md',
        '0006-test-suite.md',
        '0008-agent-hardening.md',
        '0008-pipeline-state-machine.md',
        '0010-provider-diversification.md',
        '0010-tiered-agent-routing.md',
        '0011-ai-slop-detection.md',
      ]);
      expect(duplicates.map(([num]) => num).sort()).toEqual(['0006', '0008', '0010']);
    });

    it('reports every colliding file for a number', () => {
      const duplicates = findDuplicateAdrNumbers(['0007-a.md', '0007-b.md', '0007-c.md']);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0][1]).toEqual(['0007-a.md', '0007-b.md', '0007-c.md']);
    });

    it('ignores files without a leading number', () => {
      expect(findDuplicateAdrNumbers(['README.md', 'template.md'])).toEqual([]);
    });
  });

  describe('the real docs/adr directory', () => {
    it('has no duplicate ADR numbers', async () => {
      const { readdir } = await import('node:fs/promises');
      const files = (await readdir('docs/adr')).filter((f) => f.endsWith('.md'));
      expect(findDuplicateAdrNumbers(files)).toEqual([]);
    });
  });
});
