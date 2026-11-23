/**
 * テーマ候補の生成と、記号側（決定論）の審査。
 *
 * ニューロシンボリック選定の「シンボリック」半分。ここは LLM もネットワークも
 * 使わず、同じ入力なら同じ候補・同じ特徴量を返す。
 *
 *   1. 候補を作る … 財務パルスの記号の事実 / トレンド・レーダー /
 *                   身内のレーダーの見出し（MPL・Orbital Eternity）/ テーマ残高
 *   2. 硬い規則で落とす … 禁止語・テーマの冷却期間・既出タイトルとの類似
 *   3. 柔らかい特徴量を付ける … 不足度・顕著さ・新しさ（すべて 0〜1）
 *
 * Jev（神経側）に渡すのは 2 を通ったものだけ。Choice の選択肢に落ちた候補を
 * 入れないので、Jev は規則違反の候補を「型の上で」選べない。
 */

import { bigramSimilarity } from '../agents/continuity.js';
import { THEME_KEYWORDS, type ThemePriority } from '../agents/shared.js';
import type { TrendRadar } from '../agents/trends.js';
import type { RadarItem, RadarSweep } from '../ecosystem/radar.js';
import type { FinancePulse } from '../finance/pulse.js';
import { ECOSYSTEM_CONFIG } from '../pipeline/config.js';

export type CandidateSource = 'finance' | 'tech' | 'radar' | 'balance';

export interface TopicCandidate {
  id: string;
  theme: string;
  source: CandidateSource;
  /** 具体的な場面（企画の芯）。 */
  hook: string;
  /** なぜ今日この候補が出てきたか（記号の事実・出典）。 */
  why: string[];
  /**
   * 顕著さ（0〜1）。候補ごとに重みが違う情報源はここに入れる。
   * 無ければ reviewCandidates が情報源ごとの既定値を使う。
   */
  weight?: number;
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
  /**
   * EmbeddingGemma で測った、候補ごとの既出との意味の近さ（semantic.ts）。
   * 取れなかった日は undefined で、字面（bigram）の規則だけが効く。
   */
  semantic?: Record<string, { similarity: number; nearest: string }>;
  maxSemanticSimilarity?: number;
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

// ─── 身内のレーダー（ミナが毎朝読んでいる情報源）─────────────────

/**
 * レーダーの話題分類 → 日記のテーマ。対応表は config/pipeline.json にある
 * （INV-001: 設定は JSON 側に置く。ここに定数を増やさない）。
 *
 * 既定テーマを「AI・テクノロジー」にしていないのは意図的。既定が AI だと、
 * 分類が付いていない見出しが全部 AI の候補になり、以前の「AI時代◯◯」の
 * 山（2026-08 の記事群）が別の入口から再生産される。
 */
export function themeOfRadarItem(item: RadarItem): string {
  const map = ECOSYSTEM_CONFIG.topicThemes;
  for (const topic of item.topics) {
    const theme = map[topic];
    if (theme) return theme;
  }
  return ECOSYSTEM_CONFIG.defaultTheme;
}

/**
 * テーマごとの「ミナがそれを読んだあと実際にすること」。
 *
 * 見出しをそのまま企画にすると論文紹介になる。読者（ミナ）の側の場面を
 * 必ず1つ添えて、日記の芯が生活のほうに残るようにする。
 */
const RADAR_SCENE: Record<string, string> = {
  'AI・テクノロジー': 'ふつうの個人の手元で何が変わるのかを、自分の1日の作業に当てはめて確かめる',
  読書: 'わからないまま読み進めた時間を、どう過ごしたか',
  自己成長: '続けている人の話として、自分の習慣のどこに引き写せるか',
  ジャーナリング: '意味のわからない言葉をノートに書き写してみる',
  '散歩・日常': '歩きながら、その話を思い出してみる',
  '瞑想・マインドフルネス': '座っている5分のあいだ、その規模の話がどう響くか',
};

/** tier が硬いほど顕著。順位（rank_milli）は同点崩しに使うだけで重みにはしない。 */
export function radarSalience(item: RadarItem): number {
  if (item.tier === 1) return 0.75;
  if (item.tier === 2) return 0.6;
  return 0.5;
}

/**
 * レーダーの見出しを候補にする。
 *
 * 見出し・出典・日付をそのまま `why` に載せる。「今日この日にしか起きなかった
 * 具体的な出来事」のような中身の無い芯を置かない——事実が無い芯は、書き手に
 * 出来事を創作させる入口になる。
 */
export function radarCandidates(sweep: RadarSweep | null, limit: number): Omit<TopicCandidate, 'id'>[] {
  if (!sweep || limit <= 0) return [];
  const out: Omit<TopicCandidate, 'id'>[] = [];
  const usedThemes = new Set<string>();

  for (const item of sweep.items) {
    if (out.length >= limit) break;
    const theme = themeOfRadarItem(item);
    // 同じテーマで2本作らない。1日のレーダーが1テーマに偏っても、候補は散らす。
    if (usedThemes.has(theme)) continue;
    usedThemes.add(theme);
    const scene = RADAR_SCENE[theme] ?? '自分の暮らしのどこに引っかかったか';
    out.push({
      theme,
      source: 'radar',
      hook: `${item.title} —— これを読んだ朝に、${scene}`,
      why: [item.productLabel, ...item.sources.slice(0, 1), item.date, item.url].filter(Boolean),
      weight: radarSalience(item),
    });
  }
  return out;
}

export function generateCandidates(
  pulse: FinancePulse | null,
  radar: TrendRadar | null,
  priority: ThemePriority[],
  limit = 12,
  sweep: RadarSweep | null = null,
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

  out.push(...radarCandidates(sweep, ECOSYSTEM_CONFIG.maxCandidates));

  // テーマ残高（いちばん書いていない順）。財務・技術の候補が無い日でも、選定は止まらない。
  for (const p of priority.slice(0, 4)) {
    out.push({
      theme: p.theme,
      source: 'balance',
      // 「今日この日にしか起きなかった具体的な出来事」と書いていた頃は、
      // 芯に事実が1つも無く、書き手が出来事そのものを作るしかなかった。
      // 代わりに、手元で確かめられるものだけを芯にするよう指示する。
      hook: `「${p.theme}」について、今日の天気・予定・持ち物・体調のうち、確かめられる1つだけを芯にする`,
      why: [`theme-balance score=${p.score}`],
    });
  }

  return out.slice(0, limit).map((c, i) => ({ ...c, id: `c${String(i + 1).padStart(2, '0')}` }));
}

// ─── 2 + 3. Symbolic review ─────────────────────────────────────

const THEME_NAMES = new Set(Object.keys(THEME_KEYWORDS));

/**
 * 見出しから、当てはまるテーマを**全部**返す。
 *
 * 以前は最初に当たった1つで打ち切っていた。THEME_KEYWORDS は語が重なって
 * いるので（「AI時代の暗号資産ポートフォリオ」は投資にもAIにも当たる）、
 * 宣言順で先に並んでいるテーマだけが計上され、後ろのテーマは「使っていない」
 * ことになる。結果、同じテーマが冷却期間をすり抜けて何日も続いた
 * （2026-08 の「AI時代◯◯」の山がこれ）。
 *
 * 取りこぼしは安いが、誤検出は高い（AGENTS.md §11.3）——が、ここで誤るのは
 * 「冷却を長めにかける」方向なので、重なりは全部数えるほうが安全側。
 */
export function themesOfTitle(title: string): string[] {
  const themes: string[] = [];
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some((kw) => title.includes(kw))) themes.push(theme);
  }
  return themes;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

const SOURCE_SALIENCE: Record<CandidateSource, number> = {
  finance: 0.0,
  tech: 0.55,
  radar: 0.6,
  balance: 0.3,
};

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
      .flatMap((p) => themesOfTitle(p.title)),
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
    const sem = ctx.semantic?.[c.id];
    if (sem && ctx.maxSemanticSimilarity != null && sem.similarity >= ctx.maxSemanticSimilarity) {
      rejected.push({
        candidate: c,
        rule: 'semantic_duplicate',
        detail: `「${sem.nearest}」と意味の近さ ${Math.round(sem.similarity * 100)}%（EmbeddingGemma）`,
      });
      continue;
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
    const salience = rule ? rule.weight : (c.weight ?? SOURCE_SALIENCE[c.source]);
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
