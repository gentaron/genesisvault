/**
 * Canon — ミナについての「本当のこと」と「AI に語らせないこと」。
 *
 * 継続性台帳（continuity.ts）は**記事から導出される**。だから AI が一度
 * 「投資9年目」と書くと、台帳はそれを事実として拾い、以後「9年以上で書け」と
 * 強制し続けた（LM-021）。導出物は導出元の嘘を増幅する。
 *
 * 正典は導出しない。人間が `data/canon/canon.json` に書き、assetlog と
 * note.com/gensnotes で裏を取った事実だけを持つ。台帳と食い違えば正典が勝つ。
 *
 * 守り方は継続性と同じ（INV-019 / INV-021）:
 *   - ブリーフで伝える（安い）
 *   - `detectCanonViolations()` が原稿・校正後・テンプレートの3箇所で止める
 *   - `bun run verify` が公開済みの全記事を走査する（1件でもあれば落ちる）
 *
 * ネットワークも LLM も使わない。
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const CANON_REL_PATH = path.join('data', 'canon', 'canon.json');

const CanonSchema = z.object({
  $comment: z.string().optional(),
  schema: z.literal(1),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  facts: z
    .array(
      z.object({
        id: z.string().min(1),
        statement: z.string().min(1),
        source: z.string().min(1),
      }),
    )
    .min(1),
  forbiddenClaims: z
    .array(
      z.object({
        id: z.string().min(1),
        message: z.string().min(1),
        pattern: z.string().min(1),
        /** この語を含む文は対象外（第三者・一般論・未来の話）。 */
        exclude: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

export type Canon = z.infer<typeof CanonSchema>;

export interface CanonViolation {
  rule: string;
  message: string;
  /** 原稿に実在する一致部分（審査の引用と同じく、捏造できない）。 */
  quote: string;
}

/** 検証して返す。不正なら例外（黙って空の正典にしない——INV-001 と同じ理由）。 */
export function parseCanon(raw: unknown): Canon {
  const canon = CanonSchema.parse(raw);
  const ids = new Set<string>();
  for (const rule of canon.forbiddenClaims) {
    if (ids.has(rule.id)) throw new Error(`canon: forbiddenClaims の id が重複: ${rule.id}`);
    ids.add(rule.id);
    try {
      new RegExp(rule.pattern, 'u');
      if (rule.exclude) new RegExp(rule.exclude, 'u');
    } catch (err) {
      throw new Error(
        `canon: ${rule.id} の pattern が正規表現として不正: ${(err as Error).message}`,
      );
    }
  }
  return canon;
}

export function loadCanon(rootDir: string = process.cwd()): Canon {
  return parseCanon(JSON.parse(fs.readFileSync(path.join(rootDir, CANON_REL_PATH), 'utf-8')));
}

/** 原稿が正典に反していないか。タイトル・description も本文として渡すこと。 */
export function detectCanonViolations(text: string, canon: Canon): CanonViolation[] {
  const out: CanonViolation[] = [];
  // 文単位で見る。exclude は「その文が第三者・一般論の話か」を決めるので、文の外を見てはいけない。
  const sentences = text.split(/(?<=[。！？\n])/u);
  for (const rule of canon.forbiddenClaims) {
    const re = new RegExp(rule.pattern, 'gu');
    const exclude = rule.exclude ? new RegExp(rule.exclude, 'u') : null;
    for (const sentence of sentences) {
      if (exclude?.test(sentence)) continue;
      for (const m of sentence.matchAll(re)) {
        out.push({ rule: rule.id, message: rule.message, quote: m[0] });
        if (out.length >= 50) return out;
      }
    }
  }
  return out;
}

/** 書き手に渡す正典ブリーフ。継続性ブリーフより先に置く（こちらが上位）。 */
export function buildCanonBrief(canon: Canon): string {
  return [
    '【正典（最優先・これに反する記述は自動で差し戻される）】',
    ...canon.facts.map((f) => `  - ${f.statement}`),
    '【書いてはいけないこと】',
    ...canon.forbiddenClaims.map((r) => `  - ${r.message.split('。')[0]}`),
    '  - 正典に無い経歴・年数・金額を新しく作らない。分からないことは書かない',
  ].join('\n');
}

/** 差し戻し用のフィードバック（継続性ゲートと同じ形）。 */
export function buildCanonFeedback(violations: CanonViolation[]): string {
  return [
    '【正典違反 — 以下の記述を削除または言い換えて書き直すこと】',
    ...violations.map((v) => `  - 「${v.quote}」: ${v.message}`),
  ].join('\n');
}
