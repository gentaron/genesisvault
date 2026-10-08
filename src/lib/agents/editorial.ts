/**
 * 編集方針ブリーフ — AI を主軸にしたテーマ選定の材料
 *
 * 3つの姉妹リポジトリから、その日の記事の材料を集めて言葉にする。
 *
 *   IDEAZ    … 毎朝 MYT 5:00 に配られる「今日の角度」と（見つかれば）題材。公開 JSON を読む
 *   edutext  … ミナの世界観の正典。config/pipeline.json → editorial.lore に抜粋済み
 *   QAIZ     … ミナが手を動かしている道具の近況。非公開なので editorial.workshop に手で書く
 *
 * 取得は fail-soft。IDEAZ が読めなくても、軸・関門・世界観・道具の近況だけで書ける。
 * ブリーフは材料であって指示の上書きではない（テーマは Nova が決め、Lena は変えない）。
 */

import { EDITORIAL_CONFIG, type EditorialConfig } from '../pipeline/config.js';
import { fetchText } from './trends.js';

export interface IdeazSlot {
  label: string;
  /** open = 題材の縛りなし / judgement = 判断AIの枠 */
  kind: string;
  lens: string;
  topic: { title: string; whatChanged: string } | null;
}

/** IDEAZ の current.json から枠を取り出す。形が想定と違えば空配列（落とさない）。 */
export function parseIdeazCurrent(body: string): IdeazSlot[] {
  try {
    const doc = JSON.parse(body) as { slots?: unknown };
    if (!Array.isArray(doc.slots)) return [];
    return doc.slots
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .filter((s) => typeof s.lens === 'string' && s.lens.length > 0)
      .map((s) => {
        const t = s.topic as Record<string, unknown> | null | undefined;
        return {
          label: typeof s.label === 'string' ? s.label : '',
          kind: typeof s.kind === 'string' ? s.kind : 'open',
          lens: s.lens as string,
          topic:
            t && typeof t.title === 'string'
              ? {
                  title: t.title,
                  whatChanged: typeof t.whatChanged === 'string' ? t.whatChanged : '',
                }
              : null,
        };
      });
  } catch {
    return [];
  }
}

export async function fetchIdeazSlots(
  cfg: EditorialConfig = EDITORIAL_CONFIG,
  timeoutMs = 8000,
): Promise<IdeazSlot[]> {
  const body = await fetchText(cfg.ideaz.endpoint, timeoutMs);
  return body ? parseIdeazCurrent(body) : [];
}

export function isAiTheme(theme: string): boolean {
  return theme.startsWith('AI');
}

/** テーマに合う IDEAZ の枠を選ぶ。判断AIなら judgement 枠を先頭に、それ以外は open 枠。 */
export function pickSlots(slots: IdeazSlot[], theme: string | null, max: number): IdeazSlot[] {
  if (theme === 'AI・判断するAI') {
    return [...slots]
      .sort((a, b) => Number(b.kind === 'judgement') - Number(a.kind === 'judgement'))
      .slice(0, max);
  }
  // 題材が決まっている枠を先に出す（角度だけの枠より具体的）
  return slots
    .filter((s) => s.kind !== 'judgement' || theme === null)
    .sort((a, b) => Number(!!b.topic) - Number(!!a.topic))
    .slice(0, max);
}

function formatSlot(s: IdeazSlot): string {
  return s.topic
    ? `  - 題材「${s.topic.title}」— ${s.topic.whatChanged.slice(0, 120)}`
    : `  - 角度: ${s.lens}`;
}

/**
 * テーマ選定前（Nova 向け）は theme=null。軸と今日の角度だけを渡す。
 * テーマ決定後（Lena / Sophia 向け）は、そのテーマに要る材料だけを渡す。
 */
export function buildEditorialBrief(
  slots: IdeazSlot[],
  theme: string | null,
  cfg: EditorialConfig = EDITORIAL_CONFIG,
): string {
  const lines: string[] = [];
  lines.push(`【編集の軸】${cfg.axis}`);

  const ai = theme === null || isAiTheme(theme);
  if (ai) {
    const picked = pickSlots(slots, theme, cfg.ideaz.maxSlots);
    if (picked.length > 0) {
      lines.push('【今日の角度（IDEAZ が今朝配ったもの。合えば使い、合わなければ外してよい）】');
      for (const s of picked) lines.push(formatSlot(s));
    }
    if (theme !== null) {
      lines.push(`【書く前に埋める一文】${cfg.gate}`);
      lines.push(
        '  埋まらない題材は使わない。「起動できた」と「実用になる」を混同しない。派手な数字や新しさだけを理由にしない。',
      );
    }
  }

  if (theme === 'AI×市場分析') {
    lines.push(`【手元の道具の近況（${cfg.workshop.asOf} 時点）】`);
    for (const item of cfg.workshop.items) {
      lines.push(`  - ${item.name}: ${item.what}`);
      lines.push(`    最近: ${item.latest}`);
      lines.push(`    書ける切り口: ${item.angles.join(' / ')}`);
    }
    lines.push(`  ${cfg.workshop.usage}`);
  }

  if (theme !== null) {
    lines.push('【ミナの背景（edutext 正典）】');
    for (const f of cfg.lore.facts) lines.push(`  - ${f}`);
    lines.push(`  ${cfg.lore.usage}`);
  }

  return lines.join('\n');
}
