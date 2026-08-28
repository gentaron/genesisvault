/**
 * Phase ι — Continuity Subsystem (過去記事整合性)
 *
 * 過去に公開した記事のデータをまとめ、新しい記事が過去と矛盾・逆行しないよう
 * にするための3エージェント。
 *
 *   VE-004  Vera Holt    (Researcher / 調べる係)   … 過去記事から確定事実を抽出
 *   VE-007  Edda Lindgren(Summarizer / まとめる係) … 抽出結果を正典(台帳)に統合
 *   VE-008  Mira Falk    (Recorder   / 記録・更新係)… 新記事の事実を台帳へ追記・更新
 *
 * 生成される「継続性ブリーフ(brief)」は CEO(Lena)/Writer(Sophia) のプロンプトに
 * 注入され、「貯金200万円の記事のあとに貯金100万円の記事を書く」ような逆行を防ぐ。
 *
 * 構造化された台帳(facts/milestones)は決定的に算出し、自然言語のブリーフのみ LLM を
 * 使う（失敗時は決定的テンプレートにフォールバック）。
 */

import fs from 'fs/promises';
import path from 'path';

// 本モジュールは完全に決定的（AI SDK 非依存）。
// 継続性ブリーフは抽出した確定事実から決定的に組み立てる。LLM 出力をファイル
// (台帳) へ書き込まないことで再現性を保ち、外部データのファイル混入も避ける。
//
// 【継続性の正典ソース】
// 過去記事との整合性（貯金300万→200万のような逆行防止）が問われるのは、本パイプ
// ラインが生成してきた「ミナの日記」= src/content/posts のローカル記事である。
// 一方 gensnotes_3/4/5（現行ブログのエッセイ）は市場分析的な巨額（10億等）を含み、
// 個人の貯金額の正典としてはノイズになる。よって継続性台帳は日記記事のみを走査し、
// 金額には常識的な上限(MONEY_MAX_YEN)を設けてエッセイ由来の誤抽出を排除する。
// （エッセイ群は shared.REFERENCE_FILES 経由で文体・テーマ参照には引き続き使う）

// ─── Ledger types ───────────────────────────────────────────────

// schema 2: 金額以外の指標（継続日数・年数・冊数）を同じ台帳で扱えるように
// `unit` を追加した。schema が変わると auto-post は台帳を記事から作り直す。
export const LEDGER_SCHEMA = 2;
export const LEDGER_REL_PATH = path.join('data', 'continuity-ledger.json');

/** 比較に使う単位。'yen' だけ表記の正規化（万/億）が要るので別扱い。 */
export type MetricUnit = 'yen' | '日' | '年' | '冊' | '回';

export interface PastArticle {
  title: string;
  text: string;
  date: string; // YYYY-MM-DD（不明な場合は ''）
}

export interface MinedFact {
  metric: string; // 例: '貯金額' / '瞑想の継続日数' / '2026年の読了冊数'
  value: string; // 元の表記（例: '200万円'）
  valueNum: number | null; // 比較用の数値。数値化できなければ null
  unit: MetricUnit;
  monotonic: boolean; // true = 単調増加（逆行禁止）の指標
  date: string;
  source: string; // 記事タイトル
  snippet: string;
}

export interface CanonFact {
  metric: string;
  value: string;
  valueNum: number | null;
  unit: MetricUnit;
  monotonic: boolean;
  asOf: string;
  source: string;
}

export interface Milestone {
  date: string;
  event: string;
  source: string;
}

export interface ContinuityLedger {
  schema: number;
  updated: string;
  diaryArticleCount: number;
  facts: CanonFact[];
  milestones: Milestone[];
  brief: string;
}

// 個人の貯金/資産/投資額として現実的な上限（円）。これ以上はエッセイ等の
// 市場分析的な数値とみなして個人事実から除外する。
export const MONEY_MAX_YEN = 100_000_000; // 1億円

// ─── Numeric parsing (Japanese amounts) ─────────────────────────

function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[，]/g, ',');
}

/**
 * "200万円" → 2_000_000, "1,250万円" → 12_500_000, "1億2000万円" → 120_000_000,
 * "3000円" → 3000。数値化できなければ null。
 */
export function parseAmountYen(raw: string): number | null {
  const s = toHalfWidth(raw).replace(/,/g, '');
  let total = 0;
  let matched = false;

  const oku = s.match(/(\d+(?:\.\d+)?)\s*億/);
  if (oku) {
    total += parseFloat(oku[1]) * 1e8;
    matched = true;
  }
  const man = s.match(/(\d+(?:\.\d+)?)\s*万/);
  if (man) {
    total += parseFloat(man[1]) * 1e4;
    matched = true;
  }
  if (matched) {
    // "1億2000万 + 5000円" のような末尾の円部分
    const tail = s.match(/万\s*(\d+)\s*円/);
    if (tail) total += parseFloat(tail[1]);
  } else {
    const yen = s.match(/(\d+(?:\.\d+)?)\s*円/);
    if (yen) {
      total += parseFloat(yen[1]);
      matched = true;
    }
  }
  return matched ? Math.round(total) : null;
}

// ─── Metric definitions ─────────────────────────────────────────

/**
 * 逆行を検出したい指標の定義。
 *
 * 金額だけを見ていると「貯金300万→200万」は止まるが、「瞑想100日目→30日目」
 * 「積立5年目→2年目」は素通りする。読者から見ればどちらも同じ嘘なので、
 * 単位の違う指標を同じ枠組みで扱う。
 *
 * `scope: 'year'` は年ごとにリセットされる指標（今年の読了冊数など）。
 * 年をまたいだ比較は逆行ではないので、台帳のキーに年を含める。
 */
interface MetricDef {
  /** 台帳に載る指標名のもと（scope が 'year' なら「2026年の◯◯」になる）。 */
  base: string;
  unit: MetricUnit;
  monotonic: boolean;
  scope: 'lifetime' | 'year';
  /** 文にこの語が無ければ、この指標の話ではない。 */
  keyword: RegExp;
  /**
   * 値の取り出し方。'amount' は文中の金額トークンを拾う（従来の金額処理）。
   * 正規表現の場合は capture group 1 を数値として読む。
   */
  value: RegExp | 'amount';
}

// 金額トークン: 億/万 で終わる（円は任意）か、円で終わる数値。
// 「300万達成」「貯金300万」のように円を伴わない万単位も拾えるようにする。
const AMOUNT_TOKEN =
  /[0-9０-９][0-9０-９,，]*\s*億(?:\s*[0-9０-９,，]+\s*万)?(?:\s*[0-9０-９,，]+\s*円)?|[0-9０-９][0-9０-９,，]*\s*万(?:\s*[0-9０-９,，]+\s*円)?|[0-9０-９][0-9０-９,，]*\s*円/;

// 個人事実ではなく一般統計の引用を金額抽出から除外するための語。
const MONEY_EXCLUDE = /平均|世帯|中央値|統計|ランキング|と言われ|だそう|らしい|目安|相場/;

/**
 * 相場・ニュース由来の数値を個人の事実から切り離すための語。
 *
 * Phase ν でトレンド情報（AI ニュース＋株式相場）を執筆陣に渡すようになった。
 * 「日経平均が4万2000円」を貯金額として台帳に書き込むと、翌日から到達不能な
 * 下限が居座り、以後すべての原稿が逆行判定で落ちる。外の数字は外の数字。
 */
const MARKET_NOISE =
  /日経平均|ダウ|ナスダック|NASDAQ|S&P|SP500|指数|株価|為替|ドル円|円安|円高|時価総額|市場|銘柄|最高値|終値|相場/i;

const NUM = '([0-9０-９][0-9０-９,，]*)';
/** 主語→数値の順、かつ句読点をまたがない近接に限定して誤検出を抑える。 */
function adjacent(subject: string, tail: string): RegExp {
  return new RegExp(`(?:${subject})[^。、！？]{0,8}?${NUM}\\s*${tail}`);
}

/** 「瞑想を120日続けた」のような継続日数。 */
function streakDays(label: string, subject: string): MetricDef {
  return {
    base: `${label}の継続日数`,
    unit: '日',
    monotonic: true,
    scope: 'lifetime',
    keyword: new RegExp(subject),
    value: adjacent(subject, '日(?:目|連続|続け|続いて)'),
  };
}

/** 「積立5年目」のような継続年数。 */
function streakYears(label: string, subject: string): MetricDef {
  return {
    base: `${label}の継続年数`,
    unit: '年',
    monotonic: true,
    scope: 'lifetime',
    keyword: new RegExp(subject),
    value: adjacent(subject, '年(?:目|続け|続いて|になる|が経|経っ)'),
  };
}

/**
 * 逆行を禁止する指標の一覧。
 *
 * 増やすときの原則: **取りこぼしは安いが、誤検出は高い**。
 * 拾い損ねた事実は「その日の記事に継続性の縛りが1つ減る」だけだが、
 * 誤って拾った事実は台帳に居座り、以後の原稿を毎日落とし続ける。
 * だから主語と数値の近接を要求し、曖昧な言い回しは拾わない。
 */
export const CONTINUITY_METRICS: MetricDef[] = [
  // 金額（従来からの核）
  {
    base: '貯金額',
    unit: 'yen',
    monotonic: true,
    scope: 'lifetime',
    keyword: /貯金|貯蓄|預金/,
    value: 'amount',
  },
  {
    base: '総資産額',
    unit: 'yen',
    monotonic: true,
    scope: 'lifetime',
    keyword: /総資産|純資産|資産総額|資産額/,
    value: 'amount',
  },
  {
    base: '投資額',
    unit: 'yen',
    monotonic: true,
    scope: 'lifetime',
    keyword: /投資額|積立|つみたて|ETF|NISA|iDeCo/,
    value: 'amount',
  },

  // 習慣の継続（日数）
  streakDays('瞑想', '瞑想|マインドフルネス'),
  streakDays('ジャーナリング', 'ジャーナリング|日記'),
  streakDays('散歩', '散歩|ウォーキング'),
  streakDays('早起き', '早起き|朝活'),
  streakDays('ブログ', 'ブログ|更新'),
  streakDays('読書', '読書'),
  streakDays('運動', '筋トレ|ストレッチ|ヨガ|ランニング'),

  // 継続（年数）
  streakYears('積立投資', '積立|つみたて|投資|運用'),
  streakYears('ブログ', 'ブログ'),
  streakYears('ひとり暮らし', 'ひとり暮らし|一人暮らし|独身'),
  streakYears('瞑想', '瞑想'),

  // 読了冊数（今年ぶんは年でリセットするので scope: 'year'）
  {
    base: '読了冊数',
    unit: '冊',
    monotonic: true,
    scope: 'year',
    keyword: /今年|ことし/,
    value: adjacent('今年|ことし', '冊'),
  },
  {
    base: '累計読了冊数',
    unit: '冊',
    monotonic: true,
    scope: 'lifetime',
    keyword: /累計|通算|これまでに/,
    value: adjacent('累計|通算|これまでに', '冊'),
  },

  // 訪れた土地（ひとり旅）
  {
    base: '訪れた都道府県数',
    unit: '回',
    monotonic: true,
    scope: 'lifetime',
    keyword: /都道府県|県目/,
    value: adjacent('都道府県|訪れた|行った', '(?:県|都道府県)目?'),
  },
];

/** 金額指標だけを見たいとき用（相場ノイズの除外など、金額特有の処理がある）。 */
const MONEY_METRICS = CONTINUITY_METRICS.filter((m) => m.unit === 'yen');

/** 年スコープの指標名（記事の年を前置きする）。 */
function metricLabel(def: MetricDef, date: string): string | null {
  if (def.scope !== 'year') return def.base;
  const year = date.slice(0, 4);
  if (!/^\d{4}$/.test(year)) return null; // 日付不明の記事は年で括れない
  return `${year}年の${def.base}`;
}

/** 「120」「1,200」→ 数値。全角も受ける。 */
export function parseCount(raw: string): number | null {
  const n = Number(toHalfWidth(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// マイルストーン系（到達・達成を表す語。数字を伴う短文のみ採用する）
const MILESTONE_KEYWORD = /達成|突破|到達|完済|超え(?:た|る)?/;
const MILESTONE_METRIC = 'マイルストーン';

/**
 * 過去の低い数値に「回想として」触れるのは矛盾ではない。
 * 「あの頃は貯金100万だった」は正しい記述で、止めてはいけない。
 */
const RETROSPECTIVE =
  /あの頃|当時|昔|かつて|最初は|始めた頃|はじめた頃|だった頃|振り返る|振り返っ|去年|昨年|数年前|以前|前回|先日|この前|一年前|１年前|[0-9０-９]+\s*[ヶかカ]月前|思い出|スタート(?:時|地点)|の頃は/;

// ─── Sentence splitting ─────────────────────────────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 200);
}

// ═══════════════════════════════════════════════════════════════
// VE-004 Vera Holt (Researcher / 調べる係)
// ═══════════════════════════════════════════════════════════════

/**
 * 過去記事を走査し、継続性に関わる確定事実の候補を抽出する（決定的）。
 */
export function runResearcher(articles: PastArticle[]): MinedFact[] {
  console.log('\n🔎 [VE-004] Vera Holt (Researcher): 過去記事から確定事実を抽出中…');
  const facts: MinedFact[] = [];

  for (const article of articles) {
    for (const sentence of splitSentences(article.text)) {
      for (const def of CONTINUITY_METRICS) {
        if (!def.keyword.test(sentence)) continue;
        const metric = metricLabel(def, article.date);
        if (metric === null) continue;

        let value: string;
        let valueNum: number | null;

        if (def.value === 'amount') {
          // 金額: 一般統計の引用と、相場・ニュースの数字は個人の事実ではない
          if (MONEY_EXCLUDE.test(sentence) || MARKET_NOISE.test(sentence)) continue;
          const amount = sentence.match(AMOUNT_TOKEN);
          if (!amount) continue;
          value = amount[0].replace(/\s+/g, '');
          valueNum = parseAmountYen(value);
          // 個人の貯金として現実離れした額はエッセイ由来の誤抽出とみなす
          if (valueNum === null || valueNum > MONEY_MAX_YEN) continue;
        } else {
          const hit = sentence.match(def.value);
          if (!hit?.[1]) continue;
          valueNum = parseCount(hit[1]);
          if (valueNum === null || valueNum <= 0) continue;
          value = `${valueNum}${def.unit}`;
        }

        facts.push({
          metric,
          value,
          valueNum,
          unit: def.unit,
          monotonic: def.monotonic,
          date: article.date,
          source: article.title,
          snippet: sentence,
        });
      }
      // マイルストーン（達成・到達系の語 ＋ 金額/数字を含む短文に限定。
      // 見出し記号や一般論は除外し、保守的に絞る）
      //
      // 回想の文（「以前、300万円を超えた時のことを思い出した」）は出来事の
      // 記録ではなく、出来事への言及にすぎない。台帳に入れると、同じ達成が
      // 言及されるたびに増殖して、本当の出来事を枠から押し出してしまう。
      const clean = sentence.replace(/^#+\s*/, '').trim();
      if (
        MILESTONE_KEYWORD.test(clean) &&
        clean.length <= 40 &&
        !clean.includes('#') &&
        !RETROSPECTIVE.test(clean) &&
        AMOUNT_TOKEN.test(clean)
      ) {
        facts.push({
          metric: MILESTONE_METRIC,
          value: clean,
          valueNum: null,
          unit: '回', // 出来事に単位は無い。比較には使わない（valueNum が null）
          monotonic: false,
          date: article.date,
          source: article.title,
          snippet: clean,
        });
      }
    }
  }

  console.log(`  ✅ ${facts.length} 件の候補事実を抽出（記事${articles.length}本から）`);
  return facts;
}

// ─── Consolidation (deterministic) ──────────────────────────────

function byDateDesc(a: { date: string }, b: { date: string }): number {
  return (b.date || '').localeCompare(a.date || '');
}

/** 台帳の並び順を安定させる（金額を先、あとは指標名順）。 */
function byMetricOrder(a: CanonFact, b: CanonFact): number {
  if (a.unit === 'yen' && b.unit !== 'yen') return -1;
  if (b.unit === 'yen' && a.unit !== 'yen') return 1;
  return a.metric.localeCompare(b.metric, 'ja');
}

/**
 * 抽出した候補を正典(台帳)へ統合する。
 * - 単調増加の指標: 確定済みの「最高到達点」を採用（逆行防止の下限になる）
 * - マイルストーン: 直近のものを最大12件保持。ただし到達点を下回るものは捨てる
 *
 * 最後の一文が重要。以前の実装は最高到達点だけを守り、出来事はそのまま
 * 追記していたので、「貯金300万達成」の13日後に「貯金200万達成」という
 * 出来事が台帳に並んでいた。逆行した記事を台帳が追認していたことになる。
 */
export function consolidate(facts: MinedFact[]): { facts: CanonFact[]; milestones: Milestone[] } {
  const canon: CanonFact[] = [];

  const measurable = facts.filter((f) => f.metric !== MILESTONE_METRIC && f.valueNum !== null);
  for (const metric of new Set(measurable.map((f) => f.metric))) {
    const candidates = measurable.filter((f) => f.metric === metric);
    // 最高到達点を正典とする（単調増加 = 後退させない）
    const top = candidates.reduce((best, cur) =>
      (cur.valueNum as number) > (best.valueNum as number) ? cur : best,
    );
    canon.push({
      metric,
      value: top.value,
      valueNum: top.valueNum,
      unit: top.unit,
      monotonic: top.monotonic,
      asOf: top.date,
      source: top.source,
    });
  }
  canon.sort(byMetricOrder);

  const milestones: Milestone[] = dedupeMilestones(
    facts
      .filter((f) => f.metric === MILESTONE_METRIC)
      .filter((f) => !isRegressiveMilestone(f.value, canon))
      .map((f) => ({ date: f.date, event: f.value, source: f.source })),
  ).slice(0, 12);

  return { facts: canon, milestones };
}

/**
 * 同じ到達を指す出来事を1件にまとめ、**最初に起きた日**を残す。
 *
 * 「貯金300万」は達成後も繰り返し言及されるので、素朴に重複排除すると
 * 同じ節目の言い換えが12件並び、他の出来事を枠から押し出す。
 * 出来事として意味があるのは、初めてそこに到達した日のほうである。
 */
export function dedupeMilestones<T extends { date: string; event: string }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = milestoneKey(item.event);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const kept: T[] = [];
  for (const bucket of groups.values()) {
    const dated = bucket.filter((m) => m.date);
    if (dated.length === 0) {
      kept.push(bucket[0]);
      continue;
    }
    kept.push(dated.reduce((first, cur) => (cur.date < first.date ? cur : first)));
  }
  return kept.sort(byDateDesc);
}

/** 出来事の同一性キー。金額系は「指標＋金額」、それ以外は本文そのもの。 */
function milestoneKey(event: string): string {
  for (const def of MONEY_METRICS) {
    if (!def.keyword.test(event)) continue;
    const amount = event.match(AMOUNT_TOKEN);
    if (!amount) continue;
    const parsed = parseAmountYen(amount[0].replace(/\s+/g, ''));
    if (parsed !== null) return `${def.base}:${parsed}`;
  }
  return event;
}

/**
 * 「貯金200万達成！」のような、既に到達済みの水準を下回る出来事か。
 * 台帳に残すと、書き手に「200万を達成したばかり」と読ませてしまう。
 */
export function isRegressiveMilestone(event: string, canon: CanonFact[]): boolean {
  for (const def of MONEY_METRICS) {
    if (!def.keyword.test(event)) continue;
    const known = canon.find((c) => c.metric === def.base);
    if (!known || known.valueNum === null) continue;
    const amount = event.match(AMOUNT_TOKEN);
    if (!amount) continue;
    const claimed = parseAmountYen(amount[0].replace(/\s+/g, ''));
    if (claimed !== null && claimed < known.valueNum) return true;
  }
  return false;
}

// ─── Brief text ─────────────────────────────────────────────────

function formatYen(n: number | null, fallback: string): string {
  if (n === null) return fallback;
  if (n >= 1e8) return `${(n / 1e8).toFixed(n % 1e8 === 0 ? 0 : 1)}億円`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ja-JP')}万円`;
  return `${n.toLocaleString('ja-JP')}円`;
}

/** 台帳の値を人が読む表記に直す（金額は万/億へ、それ以外は単位付き）。 */
export function formatFactValue(fact: Pick<CanonFact, 'valueNum' | 'value' | 'unit'>): string {
  if (fact.unit === 'yen') return formatYen(fact.valueNum, fact.value);
  if (fact.valueNum === null) return fact.value;
  return `${fact.valueNum.toLocaleString('ja-JP')}${fact.unit}`;
}

/**
 * 決定的な台帳サマリ（LLM入力かつフォールバックとして使う）。
 *
 * 「下回るな」だけでは書き手は同じ数字を書き続ける。到達点と一緒に
 * **次に書いてよい下限**を明示して、話題が何であれ前に進ませる。
 */
export function buildDeterministicBrief(facts: CanonFact[], milestones: Milestone[]): string {
  const lines: string[] = [];
  lines.push('【確定済みの到達点（これより低い値を「新たに達成した」ように書かない＝逆行禁止）】');
  if (facts.length === 0) {
    lines.push('  （まだ確定した数値はありません）');
  } else {
    for (const f of facts) {
      const norm = formatFactValue(f);
      const floor = f.monotonic ? `　→ 次に触れるなら ${norm} 以上` : '';
      lines.push(
        `  - ${f.metric}：${norm}（到達済み・出典「${f.source}」${f.asOf ? ` / ${f.asOf}` : ''}）${floor}`,
      );
    }
  }
  if (milestones.length > 0) {
    lines.push('【記録済みの出来事（既に起きた前提。再び「初めて」起きたように書かない）】');
    for (const m of milestones.slice(0, 8)) {
      lines.push(`  - ${m.event}${m.date ? `（${m.date}）` : ''}`);
    }
  }
  lines.push('【全テーマ共通のルール】');
  lines.push(
    '  - 金額・日数・年数・冊数など、話題を問わずすべての数値は過去の到達点を下回らせない',
  );
  lines.push(
    '  - 過去の低い数値に触れてよいのは回想のときだけ。「あの頃は」「始めた頃は」と明示する',
  );
  lines.push('  - 台帳に無い新しい数値を出すのは自由。ただし一度書いたら次からはそれが下限になる');
  return lines.join('\n');
}

// ─── 逆行検出（決定的ゲート） ────────────────────────────────────

export interface Regression {
  metric: string;
  claimed: string;
  claimedNum: number;
  canon: string;
  canonNum: number;
  sentence: string;
}

/**
 * 原稿が台帳の到達点を逆行していないか調べる。
 *
 * ブリーフで「逆行するな」と伝えるのは指示であって、保証ではない。
 * 指示は無視されても何も表示されない — 逆行した記事はいつも通り緑で公開され、
 * 気づくのは読者だけになる。だから最後は決定的なチェックで止める。
 *
 * 回想（「あの頃は貯金100万だった」）は矛盾ではないので通す。
 */
export function detectRegressions(
  article: PastArticle,
  ledger: ContinuityLedger | null,
): Regression[] {
  if (!ledger || ledger.facts.length === 0) return [];
  const found: Regression[] = [];

  for (const fact of runResearcherSilent([article])) {
    if (fact.metric === MILESTONE_METRIC || fact.valueNum === null) continue;
    if (RETROSPECTIVE.test(fact.snippet)) continue;
    const known = ledger.facts.find((f) => f.metric === fact.metric && f.monotonic);
    if (!known || known.valueNum === null) continue;
    if (fact.valueNum >= known.valueNum) continue;

    found.push({
      metric: fact.metric,
      claimed: formatFactValue(fact),
      claimedNum: fact.valueNum,
      canon: formatFactValue(known),
      canonNum: known.valueNum,
      sentence: fact.snippet,
    });
  }

  // 同じ指標で複数の逆行が出たら、最も低い1件だけを報告する（指摘の重複を避ける）
  const worst = new Map<string, Regression>();
  for (const reg of found) {
    const prev = worst.get(reg.metric);
    if (!prev || reg.claimedNum < prev.claimedNum) worst.set(reg.metric, reg);
  }
  return [...worst.values()];
}

/** 差し戻し時に書き手へ渡す、直し方まで書いた指摘文。 */
export function buildRegressionFeedback(regressions: Regression[]): string {
  const lines = ['過去記事の到達点を下回る数値が本文にありました（逆行は公開できません）。'];
  for (const reg of regressions) {
    lines.push(
      `  - ${reg.metric}：本文は「${reg.claimed}」ですが、到達済みの水準は「${reg.canon}」です。` +
        `該当箇所「${reg.sentence.slice(0, 60)}」`,
    );
  }
  lines.push('');
  lines.push('直し方はどちらかです:');
  lines.push('  1. 数値を到達済みの水準以上に書き直す');
  lines.push('  2. 過去の話として書く（「始めた頃は…」と回想であることを本文で明示する）');
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// VE-007 Edda Lindgren (Summarizer / まとめる係)
// ═══════════════════════════════════════════════════════════════

/**
 * 抽出事実を正典(台帳)へ統合し、執筆陣に渡す継続性ブリーフを決定的に組み立てる。
 */
export function runSummarizer(
  minedFacts: MinedFact[],
  prev: ContinuityLedger | null,
): ContinuityLedger {
  console.log('🧾 [VE-007] Edda Lindgren (Summarizer): 過去データを台帳に統合中…');
  const { facts, milestones } = consolidate(minedFacts);

  const ledger: ContinuityLedger = {
    schema: LEDGER_SCHEMA,
    updated: new Date().toISOString().split('T')[0],
    diaryArticleCount: prev?.diaryArticleCount ?? 0,
    facts,
    milestones,
    brief: buildDeterministicBrief(facts, milestones),
  };
  console.log(`  ✅ 台帳統合完了（数値${facts.length}件 / 出来事${milestones.length}件）`);
  return ledger;
}

// ═══════════════════════════════════════════════════════════════
// VE-008 Mira Falk (Recorder / 記録・更新係)
// ═══════════════════════════════════════════════════════════════

/**
 * 新しく書かれた記事から事実を抽出し、台帳を更新する。
 * 指標は「最高到達点」を保持（後退させない）。出来事は追記。
 *
 * 金額に限らず、継続日数・年数・冊数も同じ扱いにする。単位が違うだけで、
 * 読者から見れば「先週120日目と書いた瞑想が今日30日目になっている」のも
 * 「貯金が300万から200万に戻る」のも同じ矛盾だから。
 */
export function runRecorder(ledger: ContinuityLedger, newArticle: PastArticle): ContinuityLedger {
  console.log('🗂️  [VE-008] Mira Falk (Recorder): 新記事の事実を台帳に記録中…');
  const mined = runResearcherSilent([newArticle]);

  const facts: CanonFact[] = ledger.facts.map((f) => ({ ...f }));

  const measurable = mined.filter((m) => m.metric !== MILESTONE_METRIC && m.valueNum !== null);
  for (const metric of new Set(measurable.map((m) => m.metric))) {
    const candidates = measurable.filter((m) => m.metric === metric);
    const top = candidates.reduce((best, cur) =>
      (cur.valueNum as number) > (best.valueNum as number) ? cur : best,
    );
    const existing = facts.find((f) => f.metric === metric);
    if (!existing) {
      facts.push({
        metric,
        value: top.value,
        valueNum: top.valueNum,
        unit: top.unit,
        monotonic: top.monotonic,
        asOf: top.date,
        source: top.source,
      });
    } else if ((top.valueNum as number) > (existing.valueNum ?? Number.NEGATIVE_INFINITY)) {
      existing.value = top.value;
      existing.valueNum = top.valueNum;
      existing.asOf = top.date;
      existing.source = top.source;
    }
  }
  facts.sort(byMetricOrder);

  // 出来事: 新規のみ先頭に追記（最大12件）。
  // 到達点を下回る「達成」は記録しない — 台帳が逆行を追認してしまう。
  const newMilestones = mined
    .filter((m) => m.metric === MILESTONE_METRIC)
    .filter((m) => !isRegressiveMilestone(m.value, facts))
    .map((m) => ({ date: m.date, event: m.value, source: m.source }));
  const milestones = dedupeMilestones(
    [...newMilestones, ...ledger.milestones].filter((m) => !isRegressiveMilestone(m.event, facts)),
  ).slice(0, 12);

  const updated: ContinuityLedger = {
    schema: LEDGER_SCHEMA,
    updated: new Date().toISOString().split('T')[0],
    diaryArticleCount: ledger.diaryArticleCount + 1,
    facts,
    milestones,
    brief: buildDeterministicBrief(facts, milestones),
  };
  console.log(`  ✅ 台帳更新完了（数値${facts.length}件 / 出来事${milestones.length}件）`);
  return updated;
}

/** Recorder 内部用：ログを出さない Researcher。 */
function runResearcherSilent(articles: PastArticle[]): MinedFact[] {
  const orig = console.log;
  console.log = () => {};
  try {
    return runResearcher(articles);
  } finally {
    console.log = orig;
  }
}

// ─── Reference article loading (diary posts) ────────────────────

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
};

/**
 * HTML タグを除去してプレーンテキスト化する。
 * タグ除去は不動点まで繰り返す（`<<x>y>` のような入れ子で取りこぼさないため）。
 */
export function stripHtml(html: string): string {
  let prev: string;
  let out = html;
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, '');
  } while (out !== prev);
  return out
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 継続性の正典ソース = 本パイプラインが生成してきた「ミナの日記」
 * (src/content/posts) を {title, text, date} の配列として読み込む。
 * タイトルにも確定事実（例:「貯金300万達成」）が含まれるため text に含める。
 */
export async function loadDiaryArticles(rootDir: string): Promise<PastArticle[]> {
  const articles: PastArticle[] = [];
  try {
    const postsDir = path.join(rootDir, 'src', 'content', 'posts');
    const files = (await fs.readdir(postsDir)).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const raw = await fs.readFile(path.join(postsDir, file), 'utf-8');
      const titleMatch = raw.match(/^title:\s*"?(.+?)"?\s*$/m);
      const dateMatch = raw.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m);
      const title = titleMatch?.[1] ?? file;
      const body = raw.replace(/^---[\s\S]*?---/, '');
      const text = `${title}。${stripHtml(body)}`;
      if (text.length < 50) continue;
      articles.push({ title, text, date: dateMatch?.[1] ?? '' });
    }
  } catch {
    /* posts dir may not exist yet */
  }
  return articles;
}

// ─── Ledger persistence ─────────────────────────────────────────

export async function loadLedger(rootDir: string): Promise<ContinuityLedger | null> {
  try {
    const raw = await fs.readFile(path.join(rootDir, LEDGER_REL_PATH), 'utf-8');
    return JSON.parse(raw) as ContinuityLedger;
  } catch {
    return null;
  }
}

export async function saveLedger(rootDir: string, ledger: ContinuityLedger): Promise<void> {
  const full = path.join(rootDir, LEDGER_REL_PATH);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, `${JSON.stringify(ledger, null, 2)}\n`, 'utf-8');
}

// ─── Topic Continuity (Phase κ) ───────────────────────────────

/**
 * 過去記事の中から、指定テーマに関連する記事を検索する。
 * 同じテーマを扱う過去記事がある場合、新しい記事はその「続き」として書く必要がある。
 * 例えば「筋トレ5日目」を書くなら「筋トレ1日目」の記事が存在し、
 * 5日続いていることを前提にしなければならない。
 */
export function findRelatedArticles(
  articles: PastArticle[],
  theme: string,
  topic: string,
  maxResults = 5,
): PastArticle[] {
  // テーマ・トピックから検索キーワードを抽出
  const searchTerms = [...extractKeywords(theme), ...extractKeywords(topic)];
  if (searchTerms.length === 0) return [];

  // 各記事をスコアリング（キーワードマッチ数 × 日付の新しさ）
  const scored = articles
    .map((article) => {
      const titleAndText = `${article.title} ${article.text}`;
      let matchCount = 0;
      for (const term of searchTerms) {
        if (titleAndText.includes(term)) matchCount++;
      }
      return { article, score: matchCount, date: article.date };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      // スコアが同じなら日付の新しいものを優先
      if (b.score !== a.score) return b.score - a.score;
      return b.date.localeCompare(a.date);
    });

  return scored.slice(0, maxResults).map((s) => s.article);
}

/**
 * 日本語テキストから意味のあるキーワードを抽出する（決定的）。
 * 助詞・助動詞などを除去し、2文字以上の単語を返す。
 */
function extractKeywords(text: string): string[] {
  // 一般的なストップワードを除去
  const stopWords = new Set([
    'の', 'に', 'は', 'が', 'を', 'で', 'と', 'も', 'から', 'へ', 'より',
    'について', 'についての', 'という', 'による', 'として', 'ための',
    'こと', 'もの', 'ところ', 'ほう', 'とき', 'まま', 'よう',
    'それ', 'これ', 'あれ', 'どれ', 'なに', 'どこ', 'いつ',
    'できる', 'ない', 'ある', 'いる', 'なる', 'する', 'くる', 'いく',
    '毎日', '今日', '最近', '最近の', '新しい', '古い',
  ]);

  // テキストから漢字・カタカナを含む2文字以上の語を抽出
  const words = text
    .replace(/[\s\n\r]/g, ' ')
    .split(/[\s、。！？！？,\.\-\/]/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  // 重複を除去し、意味のあるキーワードのみ返す（最大10個）
  const unique = [...new Set(words)];
  return unique.slice(0, 10);
}

/**
 * 関連記事の情報を執筆ブリーフに追加するセクションを構築する。
 * 同じテーマの過去記事が存在する場合、Writer にその情報を渡す。
 */
export function buildTopicContinuityBrief(
  relatedArticles: PastArticle[],
  theme: string,
): string {
  if (relatedArticles.length === 0) return '';

  const lines: string[] = [];
  lines.push(`【同テーマの過去記事（「${theme}」関連）— 続きとして書くこと】`);
  lines.push('同じテーマを扱う過去記事が存在します。新しい記事はそれらの「続き」として書いてください。');
  lines.push('過去の記事の内容を踏まえつつ、進行・変化・新しい発見があるようにしてください。');
  lines.push('');

  for (const article of relatedArticles) {
    const dateStr = article.date || '日付不明';
    lines.push(`  - ${dateStr} 「${article.title}」`);
  }

  lines.push('');
  lines.push('ルール:');
  lines.push('  - 過去記事で書いた内容と同じデータ・数字を「再発見・再達成」として書かない');
  lines.push('  - 系列物（筋トレ日目、瞑想記録など）は日数・回数が過去の最高値から連続していること');
  lines.push('  - 過去記事のエピソードを参照してもよいが、「前回は〜だったが、今回は〜」のように進行させる');

  return lines.join('\n');
}

// ─── Title Deduplication (Phase κ) ─────────────────────────────

/**
 * 過去90日以内の記事タイトルと重複しているかをチェックする。
 * 完全一致および類似度80%以上のタイトルを重複と判定する。
 *
 * @returns 重複している場合、重複先のタイトルと日付。問題なければ null。
 */
export function detectDuplicateTitle(
  newTitle: string,
  articles: PastArticle[],
  windowDays = 90,
): { title: string; date: string; similarity: number } | null {
  const cutoff = new Date();toISOString().slice(0, 10).replace(/\d{2}$/, '00');
  const windowStart = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);

  const recent = articles.filter((a) => a.date >= windowStart);
  const normalized = newTitle.replace(/[\s！？!?.、,]/g, '');

  for (const article of recent) {
    const existing = article.title.replace(/[\s！？!?.、,]/g, '');

    // 完全一致
    if (normalized === existing) {
      return { title: article.title, date: article.date, similarity: 1.0 };
    }

    // 類似度チェック（文字の bigram 共通率）
    const similarity = bigramSimilarity(normalized, existing);
    if (similarity >= 0.8) {
      return { title: article.title, date: article.date, similarity };
    }
  }

  return null;
}

/**
 * 2つの文字列間の bigram 類似度（0〜1）を計算する。
 */
function bigramSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.slice(i, i + 2));
  }

  const bigramsB = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) {
    bigramsB.add(b.slice(i, i + 2));
  }

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * タイトル重複のフィードバック文を生成する。
 */
export function buildTitleDupFeedback(
  dup: { title: string; date: string; similarity: number },
): string {
  return `タイトルが過去記事と重複しています（${dup.date}「${dup.title}」、類似度${Math.round(dup.similarity * 100)}%）。\n別のタイトルを考えてください。過去90日以内のタイトルとは被らないようにしてください。`;
}
