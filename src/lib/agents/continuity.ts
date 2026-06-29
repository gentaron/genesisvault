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
import { PERSONA } from './shared.js';

// 注: AI SDK(`../ai/generate`) は polishBrief 内で動的 import する。
// これにより継続性の決定的コア（抽出・統合・台帳IO）は AI SDK 非依存で動き、
// 単体テストやオフラインの台帳生成が可能になる。
//
// 【継続性の正典ソース】
// 過去記事との整合性（貯金300万→200万のような逆行防止）が問われるのは、本パイプ
// ラインが生成してきた「ミナの日記」= src/content/posts のローカル記事である。
// 一方 gensnotes_3/4/5（現行ブログのエッセイ）は市場分析的な巨額（10億等）を含み、
// 個人の貯金額の正典としてはノイズになる。よって継続性台帳は日記記事のみを走査し、
// 金額には常識的な上限(MONEY_MAX_YEN)を設けてエッセイ由来の誤抽出を排除する。
// （エッセイ群は shared.REFERENCE_FILES 経由で文体・テーマ参照には引き続き使う）

// ─── Ledger types ───────────────────────────────────────────────

export const LEDGER_SCHEMA = 1;
export const LEDGER_REL_PATH = path.join('data', 'continuity-ledger.json');

export interface PastArticle {
  title: string;
  text: string;
  date: string; // YYYY-MM-DD（不明な場合は ''）
}

export interface MinedFact {
  metric: string; // 例: '貯金額'
  value: string; // 元の表記（例: '200万円'）
  valueNum: number | null; // 比較用の数値（円換算）。数値化できなければ null
  monotonic: boolean; // true = 単調増加（逆行禁止）の指標
  date: string;
  source: string; // 記事タイトル
  snippet: string;
}

export interface CanonFact {
  metric: string;
  value: string;
  valueNum: number | null;
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
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
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

interface MetricDef {
  metric: string;
  keyword: RegExp;
  monotonic: boolean;
}

// 金額系（単調増加 = 逆行禁止）。貯金200万→100万のような後退を検出するための核。
const MONEY_METRICS: MetricDef[] = [
  { metric: '貯金額', keyword: /貯金|貯蓄|預金/, monotonic: true },
  { metric: '総資産額', keyword: /総資産|純資産|資産総額|資産額/, monotonic: true },
  { metric: '投資額', keyword: /投資額|積立|つみたて|ETF|NISA|iDeCo/, monotonic: true },
];

// 金額トークン: 億/万 で終わる（円は任意）か、円で終わる数値。
// 「300万達成」「貯金300万」のように円を伴わない万単位も拾えるようにする。
const AMOUNT_TOKEN =
  /[0-9０-９][0-9０-９,，]*\s*億(?:\s*[0-9０-９,，]+\s*万)?(?:\s*[0-9０-９,，]+\s*円)?|[0-9０-９][0-9０-９,，]*\s*万(?:\s*[0-9０-９,，]+\s*円)?|[0-9０-９][0-9０-９,，]*\s*円/;

// 個人事実ではなく一般統計の引用を金額抽出から除外するための語。
const MONEY_EXCLUDE = /平均|世帯|中央値|統計|ランキング|と言われ|だそう|らしい|目安|相場/;

// マイルストーン系（到達・達成を表す語。数字を伴う短文のみ採用する）
const MILESTONE_KEYWORD = /達成|突破|到達|完済|超え(?:た|る)?/;

// ─── Sentence splitting ─────────────────────────────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length <= 200);
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
      // 金額系メトリクス（個人の現実的な上限を超える額・統計引用はノイズとして除外）
      if (!MONEY_EXCLUDE.test(sentence)) {
        for (const def of MONEY_METRICS) {
          if (!def.keyword.test(sentence)) continue;
          const amount = sentence.match(AMOUNT_TOKEN);
          if (!amount) continue;
          const value = amount[0].replace(/\s+/g, '');
          const valueNum = parseAmountYen(value);
          if (valueNum === null || valueNum > MONEY_MAX_YEN) continue;
          facts.push({
            metric: def.metric,
            value,
            valueNum,
            monotonic: def.monotonic,
            date: article.date,
            source: article.title,
            snippet: sentence,
          });
        }
      }
      // マイルストーン（達成・到達系の語 ＋ 金額/数字を含む短文に限定。
      // 見出し記号や一般論は除外し、保守的に絞る）
      const clean = sentence.replace(/^#+\s*/, '').trim();
      if (
        MILESTONE_KEYWORD.test(clean) &&
        clean.length <= 40 &&
        !clean.includes('#') &&
        AMOUNT_TOKEN.test(clean)
      ) {
        facts.push({
          metric: 'マイルストーン',
          value: clean,
          valueNum: null,
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

/**
 * 抽出した候補を正典(台帳)へ統合する。
 * - 金額系: 確定済みの「最高到達点」を採用（逆行防止の下限になる）
 * - マイルストーン: 直近のものを最大12件保持
 */
export function consolidate(facts: MinedFact[]): { facts: CanonFact[]; milestones: Milestone[] } {
  const canon: CanonFact[] = [];

  for (const def of MONEY_METRICS) {
    const candidates = facts.filter(f => f.metric === def.metric && f.valueNum !== null);
    if (candidates.length === 0) continue;
    // 最高額を正典とする（金額は単調増加 = 後退させない）
    const top = candidates.reduce((best, cur) =>
      (cur.valueNum as number) > (best.valueNum as number) ? cur : best,
    );
    canon.push({
      metric: def.metric,
      value: top.value,
      valueNum: top.valueNum,
      monotonic: def.monotonic,
      asOf: top.date,
      source: top.source,
    });
  }

  const milestones: Milestone[] = facts
    .filter(f => f.metric === 'マイルストーン')
    .sort(byDateDesc)
    .filter((m, i, arr) => arr.findIndex(x => x.value === m.value) === i) // dedupe
    .slice(0, 12)
    .map(m => ({ date: m.date, event: m.value, source: m.source }));

  return { facts: canon, milestones };
}

// ─── Brief text ─────────────────────────────────────────────────

function formatYen(n: number | null, fallback: string): string {
  if (n === null) return fallback;
  if (n >= 1e8) return `${(n / 1e8).toFixed(n % 1e8 === 0 ? 0 : 1)}億円`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ja-JP')}万円`;
  return `${n.toLocaleString('ja-JP')}円`;
}

/** 決定的な台帳サマリ（LLM入力かつフォールバックとして使う）。 */
export function buildDeterministicBrief(facts: CanonFact[], milestones: Milestone[]): string {
  const lines: string[] = [];
  lines.push('【確定済みの数値（これより低い値を「新たに達成した」ように書かない＝逆行禁止）】');
  if (facts.length === 0) {
    lines.push('  （まだ確定した数値はありません）');
  } else {
    for (const f of facts) {
      const norm = formatYen(f.valueNum, f.value);
      lines.push(`  - ${f.metric}：${norm}（到達済み・出典「${f.source}」${f.asOf ? ` / ${f.asOf}` : ''}）`);
    }
  }
  if (milestones.length > 0) {
    lines.push('【記録済みの出来事（既に起きた前提。再び「初めて」起きたように書かない）】');
    for (const m of milestones.slice(0, 8)) {
      lines.push(`  - ${m.event}${m.date ? `（${m.date}）` : ''}`);
    }
  }
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// VE-007 Edda Lindgren (Summarizer / まとめる係)
// ═══════════════════════════════════════════════════════════════

/**
 * 抽出事実を正典(台帳)へ統合し、執筆陣に渡す自然言語ブリーフを生成する。
 * 構造化部分は決定的。ブリーフ文だけ LLM で読みやすく整え、失敗時は決定的版を使う。
 */
export async function runSummarizer(
  minedFacts: MinedFact[],
  prev: ContinuityLedger | null,
): Promise<ContinuityLedger> {
  console.log('🧾 [VE-007] Edda Lindgren (Summarizer): 過去データを台帳に統合中…');
  const { facts, milestones } = consolidate(minedFacts);
  const deterministic = buildDeterministicBrief(facts, milestones);

  const brief = await polishBrief(deterministic, 'VE-007', 'Edda Lindgren');

  const ledger: ContinuityLedger = {
    schema: LEDGER_SCHEMA,
    updated: new Date().toISOString().split('T')[0],
    diaryArticleCount: prev?.diaryArticleCount ?? 0,
    facts,
    milestones,
    brief,
  };
  console.log(`  ✅ 台帳統合完了（数値${facts.length}件 / 出来事${milestones.length}件）`);
  return ledger;
}

// ═══════════════════════════════════════════════════════════════
// VE-008 Mira Falk (Recorder / 記録・更新係)
// ═══════════════════════════════════════════════════════════════

/**
 * 新しく書かれた記事から事実を抽出し、台帳を更新する。
 * 金額は「最高到達点」を保持（後退させない）。出来事は追記。
 */
export async function runRecorder(
  ledger: ContinuityLedger,
  newArticle: PastArticle,
): Promise<ContinuityLedger> {
  console.log('🗂️  [VE-008] Mira Falk (Recorder): 新記事の事実を台帳に記録中…');
  const mined = runResearcherSilent([newArticle]);

  const facts: CanonFact[] = ledger.facts.map(f => ({ ...f }));

  // 金額系: 新記事の値が既存より高ければ更新（逆行は無視）
  for (const def of MONEY_METRICS) {
    const candidates = mined.filter(m => m.metric === def.metric && m.valueNum !== null);
    if (candidates.length === 0) continue;
    const top = candidates.reduce((best, cur) =>
      (cur.valueNum as number) > (best.valueNum as number) ? cur : best,
    );
    const existing = facts.find(f => f.metric === def.metric);
    if (!existing) {
      facts.push({
        metric: def.metric,
        value: top.value,
        valueNum: top.valueNum,
        monotonic: def.monotonic,
        asOf: top.date,
        source: top.source,
      });
    } else if ((top.valueNum as number) > (existing.valueNum ?? -Infinity)) {
      existing.value = top.value;
      existing.valueNum = top.valueNum;
      existing.asOf = top.date;
      existing.source = top.source;
    }
  }

  // 出来事: 新規のみ先頭に追記（最大12件）
  const newMilestones = mined
    .filter(m => m.metric === 'マイルストーン')
    .map(m => ({ date: m.date, event: m.value, source: m.source }));
  const merged = [...newMilestones, ...ledger.milestones];
  const milestones = merged
    .filter((m, i, arr) => arr.findIndex(x => x.event === m.event) === i)
    .slice(0, 12);

  const deterministic = buildDeterministicBrief(facts, milestones);
  const brief = await polishBrief(deterministic, 'VE-008', 'Mira Falk');

  const updated: ContinuityLedger = {
    schema: LEDGER_SCHEMA,
    updated: new Date().toISOString().split('T')[0],
    diaryArticleCount: ledger.diaryArticleCount + 1,
    facts,
    milestones,
    brief,
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

// ─── Brief polishing (LLM, with deterministic fallback) ─────────

async function polishBrief(
  deterministic: string,
  agentId: string,
  agentName: string,
): Promise<string> {
  const prompt = `あなたは Genesis Vault ブログの「継続性アーカイブ担当」です。
以下は過去記事から機械的に抽出した確定事実です。これを、記事執筆AIへ渡す
「継続性メモ」として簡潔に（300字以内）整えてください。

## 抽出された確定事実
${deterministic}

## メモ作成ルール
1. 事実（金額・出来事）は一切変更・捏造しない。抽出結果の数値をそのまま使う
2. 「過去にこれより低い金額を新たに達成したように書いてはいけない」という逆行禁止を明記する
3. 箇条書き中心で、執筆AIが一目で守れる形にする
4. 余計な前置き・後書きは書かない。メモ本文のみ出力する`;

  try {
    const { generateTextWithFallback } = await import('../ai/generate.js');
    const result = await generateTextWithFallback({
      system: PERSONA,
      prompt,
      agentId,
      agentName,
      maxOutputTokens: 800,
      temperature: 0.3,
    });
    if (result.text && result.text.trim().length > 20) {
      console.log(`  📡 Provider: ${result.providerUsed} (${result.attempts} attempts, ${result.latencyMs}ms)`);
      return result.text.trim();
    }
  } catch (err) {
    console.warn(`  ⚠️  Brief polish failed: ${(err as Error).message?.substring(0, 120)} — 決定的版を使用`);
  }
  return deterministic;
}

// ─── Reference article loading (current blog + local posts) ─────

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;/g, m => HTML_ENTITIES[m] ?? m)
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
    const files = (await fs.readdir(postsDir)).filter(f => f.endsWith('.md'));
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
