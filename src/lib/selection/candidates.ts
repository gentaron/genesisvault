/**
 * テーマ候補の生成と、記号側（決定論）の審査。
 *
 * ニューロシンボリック選定の「シンボリック」半分。ここは LLM もネットワークも
 * 使わず、同じ入力なら同じ候補・同じ特徴量を返す。
 *
 *   1. 候補を作る … 財務パルスの記号の事実 / トレンド・レーダー / テーマ残高
 *   2. 硬い規則で落とす … 禁止語・テーマの冷却期間・既出タイトルとの類似
 *   3. 柔らかい特徴量を付ける … 不足度・顕著さ・新しさ（すべて 0〜1）
 *
 * Jev（神経側）に渡すのは 2 を通ったものだけ。Choice の選択肢に落ちた候補を
 * 入れないので、Jev は規則違反の候補を「型の上で」選べない。
 */

import { bigramSimilarity } from '../agents/continuity.js';
import { THEME_KEYWORDS, type ThemePriority } from '../agents/shared.js';
import type { TrendRadar } from '../agents/trends.js';
import type { FinancePulse } from '../finance/pulse.js';

export type CandidateSource = 'finance' | 'tech' | 'balance';

export interface TopicCandidate {
  id: string;
  theme: string;
  source: CandidateSource;
  /** 具体的な場面（企画の芯）。 */
  hook: string;
  /** なぜ今日この候補が出てきたか（記号の事実・出典）。 */
  why: string[];
}

export interface Rejection {
  candidate: TopicCandidate;
  rule: string;
  detail: string;
}

export interface ScoredCandidate extends TopicCandidate {
  features: { deficit: number; salience: number; novelty: number };
  symbolic: number;
}

export interface SymbolicContext {
  priority: ThemePriority[];
  /** 新しい順の過去記事（日付・タイトル・テーマ判定に使う）。 */
  recentPosts: { date: string; title: string }[];
  /** 公開済みの他媒体の見出し（重複除け。無くてもよい）。 */
  publishedTitles?: string[];
  forbiddenTerms: string[];
  themeCooldownDays: number;
  maxTitleSimilarity: number;
  today: string;
}

// ─── 1. Candidate generation ────────────────────────────────────

/**
 * 財務の記号 → 企画の芯。左辺の記号は finance/pulse.ts の derivePredicates が出す名前。
 * 1つの記号から出る候補は1つ。数字は書かず、場面だけを置く（数字は書き手がブリーフから拾う）。
 */
export const FINANCE_RULES: { when: string; theme: string; hook: string; weight: number }[] = [
  {
    when: 'portfolio.new_high',
    theme: '投資・資産形成',
    hook: '資産の記録がいちばん高いところに来た日に、あえて何も触らないでいられるか',
    weight: 0.9,
  },
  {
    when: 'portfolio.drawdown',
    theme: '瞑想・マインドフルネス',
    hook: '高値から離れたままの画面を毎朝見るときの、呼吸と心拍の変化',
    weight: 0.9,
  },
  {
    when: 'portfolio.big_down_day',
    theme: 'ジャーナリング',
    hook: '大きく下がった日の夜に、ノートの一行目に何を書いたか',
    weight: 1.0,
  },
  {
    when: 'portfolio.big_up_day',
    theme: '自己成長',
    hook: '大きく上がった日に浮かれた自分を、次の朝どう見たか',
    weight: 0.8,
  },
  {
    when: 'portfolio.down_streak',
    theme: '瞑想・マインドフルネス',
    hook: '何日も続けて下がっている間、アプリを開く回数をどう減らしたか',
    weight: 0.85,
  },
  {
    when: 'portfolio.up_streak',
    theme: '読書',
    hook: '上がり続ける週に、相場と関係ない本を1冊読み切ってみた',
    weight: 0.6,
  },
  {
    when: 'portfolio.quiet_day',
    theme: '散歩・日常',
    hook: '相場が何も起きなかった日の、いつもより長い散歩道',
    weight: 0.4,
  },
  {
    when: 'market.risk_off',
    theme: '投資・資産形成',
    hook: '世の中が守りに入った週に、自分で決めたルールを読み返した',
    weight: 0.75,
  },
  {
    when: 'market.vol_high',
    theme: '瞑想・マインドフルネス',
    hook: '値動きが荒い日ほど、画面を閉じて5分だけ座る',
    weight: 0.7,
  },
  {
    when: 'market.rotation_new_leader',
    theme: '投資・資産形成',
    hook: '先頭を走る業種が入れ替わった週に、自分の持ち物の偏りを眺めた',
    weight: 0.65,
  },
  {
    when: 'divergence.market_up_me_down',
    theme: '投資・資産形成',
    hook: 'みんな上がっているのに自分だけ下がっている1週間',
    weight: 1.0,
  },
  {
    when: 'divergence.market_down_me_up',
    theme: '自己成長',
    hook: '外は下がっているのに自分は上がっていた週、それを実力だと思いそうになった話',
    weight: 0.9,
  },
  {
    when: 'market.bear',
    theme: '暗号資産',
    hook: '下向きの相場で、暗号資産の画面をいちばん見なかった日',
    weight: 0.5,
  },
];

export function generateCandidates(
  pulse: FinancePulse | null,
  radar: TrendRadar | null,
  priority: ThemePriority[],
  limit = 12,
): TopicCandidate[] {
  const out: Omit<TopicCandidate, 'id'>[] = [];
  const predicates = new Set(pulse?.predicates ?? []);

  for (const rule of FINANCE_RULES) {
    if (!predicates.has(rule.when)) continue;
    out.push({
      theme: rule.theme,
      source: 'finance',
      hook: rule.hook,
      why: [
        rule.when,
        ...(pulse?.portfolio ? [`assetlog ${pulse.portfolio.asOf}`] : []),
        ...(pulse?.market ? ['QAIZ'] : []),
      ],
    });
  }

  for (const signal of (radar?.tech ?? []).slice(0, 3)) {
    out.push({
      theme: 'AI・テクノロジー',
      source: 'tech',
      hook: `「${signal.title}」が、ふつうの個人の毎日の何を変えるか`,
      why: [
        `${signal.source}${signal.score != null ? ` ${signal.score}pt` : ''}`,
        signal.url,
      ].filter(Boolean),
    });
  }

  // テーマ残高（いちばん書いていない順）。財務・技術の候補が無い日でも、選定は止まらない。
  for (const p of priority.slice(0, 4)) {
    out.push({
      theme: p.theme,
      source: 'balance',
      hook: `「${p.theme}」の中で、今日この日にしか起きなかった具体的な出来事`,
      why: [`theme-balance score=${p.score}`],
    });
  }

  return out.slice(0, limit).map((c, i) => ({ ...c, id: `c${String(i + 1).padStart(2, '0')}` }));
}

// ─── 2 + 3. Symbolic review ─────────────────────────────────────

const THEME_NAMES = new Set(Object.keys(THEME_KEYWORDS));

function themeOfTitle(title: string): string | null {
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some((kw) => title.includes(kw))) return theme;
  }
  return null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

const SOURCE_SALIENCE: Record<CandidateSource, number> = { finance: 0.0, tech: 0.55, balance: 0.3 };

export function reviewCandidates(
  candidates: TopicCandidate[],
  ctx: SymbolicContext,
): { accepted: ScoredCandidate[]; rejected: Rejection[] } {
  const accepted: ScoredCandidate[] = [];
  const rejected: Rejection[] = [];

  const scores = ctx.priority.map((p) => p.score);
  const lo = Math.min(...scores, 0);
  const hi = Math.max(...scores, 1);
  const deficitOf = (theme: string): number => {
    const p = ctx.priority.find((x) => x.theme === theme);
    if (!p || hi === lo) return 0.5;
    return 1 - (p.score - lo) / (hi - lo);
  };

  const cooled = new Set(
    ctx.recentPosts
      .filter((p) => {
        const age = daysBetween(ctx.today, p.date);
        return age >= 0 && age <= ctx.themeCooldownDays;
      })
      .map((p) => themeOfTitle(p.title))
      .filter(Boolean) as string[],
  );

  const pastTitles = [...ctx.recentPosts.map((p) => p.title), ...(ctx.publishedTitles ?? [])];
  const seenHooks = new Set<string>();

  for (const c of candidates) {
    if (!THEME_NAMES.has(c.theme)) {
      rejected.push({ candidate: c, rule: 'unknown_theme', detail: c.theme });
      continue;
    }
    const banned = ctx.forbiddenTerms.find((t) => c.theme.includes(t) || c.hook.includes(t));
    if (banned) {
      rejected.push({ candidate: c, rule: 'forbidden_term', detail: banned });
      continue;
    }
    if (cooled.has(c.theme)) {
      rejected.push({
        candidate: c,
        rule: 'theme_cooldown',
        detail: `${ctx.themeCooldownDays}日以内に使ったテーマ`,
      });
      continue;
    }
    if (seenHooks.has(c.hook)) {
      rejected.push({ candidate: c, rule: 'duplicate_hook', detail: c.hook });
      continue;
    }
    seenHooks.add(c.hook);

    let maxSim = 0;
    let nearest = '';
    for (const t of pastTitles) {
      const s = bigramSimilarity(c.hook, t);
      if (s > maxSim) {
        maxSim = s;
        nearest = t;
      }
    }
    if (maxSim >= ctx.maxTitleSimilarity) {
      rejected.push({
        candidate: c,
        rule: 'too_similar',
        detail: `「${nearest}」と ${Math.round(maxSim * 100)}%`,
      });
      continue;
    }

    const rule = FINANCE_RULES.find((r) => c.source === 'finance' && r.hook === c.hook);
    const salience = rule ? rule.weight : SOURCE_SALIENCE[c.source];
    const features = {
      deficit: round3(deficitOf(c.theme)),
      salience: round3(salience),
      novelty: round3(1 - maxSim),
    };
    accepted.push({
      ...c,
      features,
      symbolic: round3(0.4 * features.deficit + 0.35 * features.salience + 0.25 * features.novelty),
    });
  }

  accepted.sort((a, b) => b.symbolic - a.symbolic || a.id.localeCompare(b.id));
  return { accepted, rejected };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
