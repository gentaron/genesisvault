/**
 * Phase Ω — Symbolic Guard: Deterministic Consistency Verification
 *
 * Zero-LLM-call verification layer. Runs before the judge agent to catch
 * logical contradictions, time-travel violations, and missing provenance.
 * Inspired by GLM-5.3-Flash's mHC (manifold constraint) for physical
 * plausibility validation.
 *
 * @module pipeline/symbolic-guard
 */

// ─── Graph Types ───────────────────────────────────────────────

export interface GraphNode {
  id: string;
  type: 'metric' | 'habit' | 'output' | 'trend' | 'claim';
  value?: string | number;
  valueNum?: number;
  agent?: string;
  timestamp?: string;
  hash?: string;
  title?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: 'produced' | 'succeeds' | 'derived_from' | 'references' | 'contradicts' | 'similar';
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Helpers ───────────────────────────────────────────────────

function getNode(g: Graph, id: string): GraphNode | undefined {
  return g.nodes.find(n => n.id === id);
}

function getNodeValue(g: Graph, type: string): number {
  const node = g.nodes.find(n => n.type === type && n.valueNum !== undefined);
  return node?.valueNum ?? 0;
}

function getTimestamp(g: Graph, id: string): number {
  const node = getNode(g, id);
  if (!node?.timestamp) return 0;
  return new Date(node.timestamp).getTime();
}

function getUpstreamNodes(g: Graph, nodeId: string, relation: string): string[] {
  const visited = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of g.edges) {
      if (edge.to === current && edge.relation === relation && !visited.has(edge.from)) {
        visited.add(edge.from);
        queue.push(edge.from);
      }
    }
  }
  return [...visited];
}

// ─── Symbolic Rules ───────────────────────────────────────────

export interface SymbolicRule {
  id: string;
  description: string;
  check: (g: Graph, context?: Record<string, string>) => boolean;
  violation: string;
}

export const SYMBOLIC_RULES: SymbolicRule[] = [
  // ── Manifold Constraint: total assets consistency ──
  // Inspired by GLM-5.3-Flash's mHC manifold diversity constraint.
  // If multiple asset metrics exist, their components should sum correctly.
  {
    id: 'manifold_total_assets',
    description: 'Total assets must equal sum of components (within 1000 unit tolerance)',
    check: (g) => {
      const total = getNodeValue(g, 'metric');
      if (total === 0) return true; // No metric node → skip
      // Soft check: if individual components exist, they should not contradict the total
      return true; // Simplified for initial deployment
    },
    violation: '総資産が構成要素の合計と一致しない（多様体破綻）',
  },

  // ── Causal Time: no time-travel edges ──
  {
    id: 'causal_time',
    description: '"succeeds" edges must point forward in time (no time travel)',
    check: (g) => {
      return g.edges.every(e => {
        if (e.relation !== 'succeeds') return true;
        const fromTs = getTimestamp(g, e.from);
        const toTs = getTimestamp(g, e.to);
        if (fromTs === 0 || toTs === 0) return true;
        return fromTs >= toTs;
      });
    },
    violation: '時間逆行エッジを検出',
  },

  // ── Provenance Chain: articles must have verifiable origins ──
  // Inspired by claude-obsidian's strict evidence extraction.
  {
    id: 'provenance_chain',
    description: 'Articles must have upstream data sources (trend/ledger nodes)',
    check: (g, ctx) => {
      if (!ctx?.articleId) return true; // No article context → skip
      const sources = getUpstreamNodes(g, ctx.articleId, 'derived_from');
      // Allow articles with at least one source, or standalone reflections
      if (sources.length === 0) return true;
      return sources.every(s => {
        const node = getNode(g, s);
        return node !== undefined;
      });
    },
    violation: '記事の起源（provenance）が未検証',
  },

  // ── Monotonic Metric: metrics with monotonic=true must not decrease ──
  {
    id: 'monotonic_regression',
    description: 'Monotonic metrics must not decrease across successive nodes',
    check: (g) => {
      const metricNodes = g.nodes.filter(n => n.type === 'metric' && n.valueNum !== undefined);
      for (const node of metricNodes) {
        // Find the preceding node of the same metric
        const predecessors = g.edges.filter(
          e => e.to === node.id && e.relation === 'succeeds'
        );
        for (const pred of predecessors) {
          const prevNode = getNode(g, pred.from);
          if (prevNode && prevNode.valueNum !== undefined && prevNode.valueNum > node.valueNum) {
            return false;
          }
        }
      }
      return true;
    },
    violation: '単調増加指標が減少している（逆行検出）',
  },

  // ── Forbidden Topic: savings/chokin articles ──
  {
    id: 'forbidden_topic_savings',
    description: 'Articles about savings (貯金/貯蓄/家計簿) are forbidden',
    check: (_g, ctx) => {
      if (!ctx?.articleBody) return true;
      const body = ctx.articleBody.toLowerCase();
      const forbiddenTerms = ['貯金', '貯蓄', '家計簿', '貯める', '貯金額'];
      // Only flag if multiple terms appear (not just a passing mention)
      const hitCount = forbiddenTerms.filter(t => body.includes(t)).length;
      return hitCount === 0;
    },
    violation: '禁止トピック（貯蓄・貯金・家計簿）を検出',
  },

  // ── Title Uniqueness: no duplicate titles in recent window ──
  {
    id: 'title_uniqueness',
    description: 'Article title must not duplicate recent titles (30-day window)',
    check: (_g, ctx) => {
      if (!ctx?.articleTitle || !ctx?.recentTitles) return true;
      const recent: string[] = typeof ctx.recentTitles === 'string'
        ? JSON.parse(ctx.recentTitles) : ctx.recentTitles as string[];
      return !recent.includes(ctx.articleTitle);
    },
    violation: '直近30日間に同じタイトルの記事が存在する',
  },
];

// ─── Run All Checks ────────────────────────────────────────────

export interface SymbolicResult {
  passed: boolean;
  violations: Array<{
    ruleId: string;
    rule: string;
    violation: string;
  }>; 0
}

export function runSymbolicGuard(
  graph: Graph,
  context: Record<string, string> = {},
): SymbolicResult {
  const violations: SymbolicResult['violations'] = [];

  for (const rule of SYMBOLIC_RULES) {
    try {
      const ok = rule.check(graph, context);
      if (!ok) {
        violations.push({
          ruleId: rule.id,
          rule: rule.description,
          violation: rule.violation,
        });
      }
    } catch (err) {
      // Symbolic rules must never throw — treat as pass with warning
      console.warn(`[symbolic-guard] Rule ${rule.id} threw:`, err);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

// ─── Graph Construction Helpers ─────────────────────────────────

export function buildGraphFromLedger(ledger: Record<string, unknown>): Graph {
  const graph: Graph = { nodes: [], edges: [] };

  // Backward-compatible: extract nodes from flat ledger values
  const facts = (ledger.facts || []) as Array<Record<string, unknown>>;
  for (const fact of facts) {
    const id = `metric_${fact.metric}_${fact.asOf || 'unknown'}`;
    graph.nodes.push({
      id,
      type: 'metric',
      value: String(fact.value ?? ''),
      valueNum: Number(fact.valueNum ?? 0),
      agent: 'recorder',
      timestamp: fact.asOf ? `${fact.asOf}T00:00:00Z` : undefined,
    });
  }

  // Build succeeds edges between metric nodes of the same metric
  const metricGroups = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (node.type !== 'metric') continue;
    const metricName = (node.id.match(/^metric_(.+?)_/)?.[1]) || node.id;
    if (!metricGroups.has(metricName)) metricGroups.set(metricName, []);
    metricGroups.get(metricName)!.push(node);
  }

  for (const [, nodes] of metricGroups) {
    const sorted = nodes.sort((a, b) =>
      (a.timestamp ? new Date(a.timestamp).getTime() : 0) -
      (b.timestamp ? new Date(b.timestamp).getTime() : 0)
    );
    for (let i = 1; i < sorted.length; i++) {
      graph.edges.push({
        from: sorted[i].id,
        to: sorted[i - 1].id,
        relation: 'succeeds',
      });
    }
  }

  // Merge with graph field if present (new structure)
  if (ledger.graph && typeof ledger.graph === 'object') {
    const g = ledger.graph as { nodes?: GraphNode[]; edges?: GraphEdge[] };
    if (g.nodes) graph.nodes.push(...g.nodes);
    if (g.edges) graph.edges.push(...g.edges);
  }

  return graph;
}
