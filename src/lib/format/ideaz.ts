/**
 * IDEAZ の型で書くためのブリーフを組み立てる。
 *
 * 正本は gentaron/IDEAZ の memory/。ここには写し（prompts/ideaz/）を置き、
 * `scripts/sync-ideaz.mjs` が毎朝取り寄せ直す。取れない日は写しのまま書く。
 * IDEAZ 側の組み立て（src/build.mjs）と同じく、見出し単位で抜き出して並べる
 * だけで、文言は一切ここに持たない — 二重管理の場所を作らないため。
 *
 * IDEAZ の軸は「強いAIを、ふつうの個人が使えるようになる変化」で、シグナルも
 * AI の題材を前提に書かれている。この日記では題材が投資・瞑想・散歩のことも
 * あるので、AI 以外の題材のときだけ「読み替え」を1段添える。型そのもの
 * （関門の一文・シグナル・ノイズ・タイトル規格・文体・読みやすさ）は崩さない。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT_CONFIG } from '../pipeline/config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const IDEAZ_FILES = [
  'canon.md',
  'title.md',
  'voice.md',
  'forbidden.md',
  'winning-patterns.md',
  'exclusions.md',
] as const;
export type IdeazFile = (typeof IDEAZ_FILES)[number];

export function readIdeaz(name: IdeazFile, rootDir = ROOT): string {
  return readFileSync(path.join(rootDir, FORMAT_CONFIG.dir, name), 'utf-8');
}

/** `## 見出し` のブロックだけ抜く（IDEAZ の section() と同じ規則）。 */
export function section(md: string, heading: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`IDEAZ format: section not found: ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

/** 見出し行を落として本文だけにする。 */
export function body(md: string): string {
  return md
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 見出しの前方一致で抜く（「読みやすさ。読者が…」のような長い見出し向け）。 */
function sectionStartingWith(md: string, prefix: string): string {
  const line = md.split('\n').find((l) => l.startsWith(`## ${prefix}`));
  if (!line) throw new Error(`IDEAZ format: section not found: ${prefix}`);
  return section(md, line.slice(3).trim());
}

/** この日記のサイトで型を使うための読み替え。IDEAZ の正本には無い、ここだけの規則。 */
export function siteAdaptation(isTech: boolean): string {
  const lines = [
    'タイトルは本文に書かない（タイトルは別に決めてある）。本文だけを返す。',
    'ハッシュタグと区切り線は書かない（タグは別の係がつける）。',
    `分量は ${FORMAT_CONFIG.minChars}〜${FORMAT_CONFIG.maxChars}字。`,
    '書き手はこの日記の著者本人。散歩・瞑想・ひとり旅・ジャーナリング・読書・投資・AI が好きな、ひとり暮らしの女性。一人称は「わたし」。',
  ];
  if (!isTech) {
    lines.push(
      '今日の題材は AI そのものではない。軸とシグナルは次のように読み替える。',
      '「強いAI」→ 今日の題材の中にある、前は手が届かなかったやり方や考え方。',
      '「自分のPCで動く・無料枠で試せる」→ 今日の自分の暮らし・時間・お金の範囲で、読者が明日そのまま試せる。',
      '「起動できた／実用になる」→ 1回やってみた／習慣として続いた。この2つを混ぜない。',
    );
  }
  return lines.join('\n');
}

/** 書き手（Sophia）に渡す、IDEAZ の型一式。 */
export function buildIdeazWriterBrief(opts: { isTech: boolean }, rootDir = ROOT): string {
  const canon = readIdeaz('canon.md', rootDir);
  const voice = readIdeaz('voice.md', rootDir);
  const win = readIdeaz('winning-patterns.md', rootDir);
  const forbidden = readIdeaz('forbidden.md', rootDir);

  const parts = [
    `【軸】\n${section(canon, '軸。意識するのはこれだけ')}`,
    `【書く前に必ず埋める一文。ここが関門】\n${section(canon, '書く前に必ず埋める一文。ここが関門')}`,
    `【必ず入れるシグナル5つ】\n${section(canon, '必ず入れるシグナル5つ')}`,
    `【採用理由にもタイトルの主役にもしないノイズ6つ】\n${section(canon, '採用理由にもタイトルの主役にもしないノイズ6つ')}`,
    `【いちばん強い型】\n${section(win, 'いちばん強い型')}`,
    `【出力の形。ここ絶対】\n${section(voice, '出力の形。ここ絶対')}`,
    `【文体】\n${section(voice, '文体')}`,
    `【読みやすさ】\n${sectionStartingWith(voice, '読みやすさ')}`,
    `【中身】\n${section(voice, '中身')}`,
    `【冒頭】\n${section(voice, '冒頭')}`,
    `【底に流れる思考の型（記事の中で語らない）】\n${section(voice, '底に流れる思考の型（記事の中で語らない）')}`,
    `【ちょっとだけ入れるもの】\n${section(voice, 'ちょっとだけ入れるもの')}`,
    `【永久禁止と安全条件】\n${body(forbidden)}`,
    `【このサイトでの読み替え（上の型より優先）】\n${siteAdaptation(opts.isTech)}`,
  ];
  if (opts.isTech) {
    parts.push(
      `【すでに使った題材の家族。ここに当たるものは選ばない】\n${body(readIdeaz('exclusions.md', rootDir))}`,
    );
  }
  return parts.join('\n\n');
}

/** 企画（Lena）に渡すタイトル規格。 */
export function buildIdeazTitleRules(rootDir = ROOT): string {
  return body(readIdeaz('title.md', rootDir));
}

/** 校正（Iris）に渡す、型を壊さないための規則。 */
export function buildIdeazEditorRules(rootDir = ROOT): string {
  const voice = readIdeaz('voice.md', rootDir);
  return [
    `【出力の形。ここ絶対】\n${section(voice, '出力の形。ここ絶対')}`,
    `【文体】\n${section(voice, '文体')}`,
    `【読みやすさ】\n${sectionStartingWith(voice, '読みやすさ')}`,
    `【このサイトでの読み替え】\n${siteAdaptation(true).split('\n').slice(0, 3).join('\n')}`,
  ].join('\n\n');
}

export function isIdeazFormat(): boolean {
  return FORMAT_CONFIG.profile === 'ideaz';
}
