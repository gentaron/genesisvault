/**
 * Title Guard — 同じ言い回しのタイトルが何度も降りてこないようにする。
 *
 * 既存の重複チェック（detectDuplicateTitle）はタイトル全体の bigram 類似度で見ていた。
 * それだと「1万歩超え、AI進化の裏側とQAIZの静かな日」と
 * 「1万歩超えの道草、AI進化と静かな市場で…」は類似度 0.6 未満で通ってしまい、
 * 2週間で「1万歩超え」が4回、「5分瞑想」が3回タイトルに出た（LM-022）。
 *
 * 読者に見えるのは全体の類似度ではなく**同じフレーズ**。だから直近 windowDays 日の
 * タイトルと、minSharedChars 文字以上の共通部分文字列を持つかで判定する。
 * テーマ名のような一般語（allowedShared）は共有してよい。
 *
 * LLM もネットワークも使わない。止める場所は2つ:
 *   - 企画（Lena）の直後: 差し戻して書き直させる（maxRetries 回）。直らなければ書かない
 *   - `bun run verify`: enforceFrom 以降の公開記事で使い回しが1件でもあれば落ちる
 */

import { TITLE_GUARD_CONFIG, type TitleGuardConfig } from './config.js';

export interface TitleEcho {
  /** 共有してしまった言い回し。 */
  phrase: string;
  date: string;
  title: string;
}

/** 記号・空白・括弧を落として比較用にする。全角英数は半角へ。 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/[\s「」『』【】（）()［］[\]、。，．,.!！?？:：;；・〜~"'”“…―\-|｜/]/g, '')
    .toLowerCase();
}

/** a と b の最長共通部分文字列（同じ長さなら先に見つかったもの）。 */
export function longestCommonSubstring(a: string, b: string): string {
  if (!a || !b) return '';
  let best = '';
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagPrev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diagPrev + 1 : 0;
      if (prev[j] > best.length) best = a.slice(i - prev[j], i);
      diagPrev = tmp;
    }
  }
  return best;
}

/** 共通部分から一般語を取り除いた残りが minSharedChars 以上か。 */
function meaningfulShared(shared: string, cfg: TitleGuardConfig): string | null {
  let rest = shared;
  for (const word of cfg.allowedShared) rest = rest.split(normalizeTitle(word)).join('');
  return rest.length >= cfg.minSharedChars ? shared : null;
}

const DAY = 86_400_000;

/**
 * 直近 windowDays 日のタイトルと言い回しを共有していれば、その一覧を返す。
 * `today` 当日のタイトル自身（再実行時の同一記事）は比較しない。
 */
export function findTitleEchoes(
  title: string,
  recent: { date: string; title: string }[],
  today: string,
  cfg: TitleGuardConfig = TITLE_GUARD_CONFIG,
): TitleEcho[] {
  if (!cfg.enabled) return [];
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const mine = normalizeTitle(title);
  const out: TitleEcho[] = [];
  for (const r of recent) {
    const t = Date.parse(`${r.date}T00:00:00Z`);
    if (!Number.isFinite(t) || t >= t0 || t0 - t > cfg.windowDays * DAY) continue;
    const shared = meaningfulShared(longestCommonSubstring(mine, normalizeTitle(r.title)), cfg);
    if (shared) out.push({ phrase: shared, date: r.date, title: r.title });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Lena への差し戻し文。使い回した言い回しを名指しで禁じる。 */
export function buildTitleEchoFeedback(echoes: TitleEcho[]): string {
  const phrases = [...new Set(echoes.map((e) => e.phrase))];
  return [
    '【タイトルの使い回し — 差し戻し】',
    `次の言い回しは直近${TITLE_GUARD_CONFIG.windowDays}日のタイトルで既に使った。今回のタイトルに入れないこと: ${phrases.map((p) => `「${p}」`).join('、')}`,
    ...echoes.slice(0, 5).map((e) => `  - ${e.date}「${e.title}」`),
    '数字の実績（歩数・分数など）や同じ情景で引きつけるのをやめ、今日だけの具体的な問い・発見を見出しにする。',
  ].join('\n');
}

/** verify 用: コーパス全体で enforceFrom 以降の記事の使い回しを列挙する。 */
export function auditTitleEchoes(
  posts: { date: string; title: string; file: string }[],
  cfg: TitleGuardConfig = TITLE_GUARD_CONFIG,
): { file: string; title: string; echoes: TitleEcho[] }[] {
  const out: { file: string; title: string; echoes: TitleEcho[] }[] = [];
  for (const p of posts) {
    if (p.date < cfg.enforceFrom) continue;
    const echoes = findTitleEchoes(p.title, posts, p.date, cfg);
    if (echoes.length > 0) out.push({ file: p.file, title: p.title, echoes });
  }
  return out;
}
