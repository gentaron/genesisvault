/**
 * Vault — note.com/gensnotes を Obsidian 風の Markdown ノートに落とす。
 *
 * Genesis Vault の本体は note（2500記事超、うち API で読めるのは公開中の分）。
 * 日記パイプラインはそこで語られた事実と矛盾してはいけないので、note を
 * 毎朝クロールし `data/vault/note/<date>-<key>.md` に1記事1ノートで写す。
 *
 * - ノートは frontmatter（title / date / url / tags / eyecatch）+ 本文テキスト
 * - タグは `[[tag/<名前>]]` の wikilink にして、Obsidian で開けばグラフになる
 * - ここはパースと整形だけ。通信は scripts/sync-note.mjs が持つ（INV-004）
 *
 * 有料記事は読める範囲（無料部分）だけを写す。課金の境界を越えて写さない。
 */

export interface NoteSummary {
  key: string;
  title: string;
  /** YYYY-MM-DD（JST の publishAt の日付部分） */
  date: string;
  url: string;
  hashtags: string[];
  eyecatch: string | null;
  price: number;
  excerpt: string;
}

export interface NoteDoc extends NoteSummary {
  /** 本文テキスト（HTML を剥がしたもの）。 */
  body: string;
}

interface RawContent {
  key?: unknown;
  name?: unknown;
  publishAt?: unknown;
  noteUrl?: unknown;
  hashtags?: { hashtag?: { name?: unknown } }[] | null;
  eyecatch?: unknown;
  price?: unknown;
  body?: unknown;
  status?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 一覧 API（/api/v2/creators/<id>/contents）の1ページを読む。壊れた応答は空。 */
export function parseNoteListPage(json: unknown): { items: NoteSummary[]; isLastPage: boolean } {
  const data = (json as { data?: { contents?: RawContent[]; isLastPage?: unknown } })?.data;
  if (!data || !Array.isArray(data.contents)) return { items: [], isLastPage: true };
  const items: NoteSummary[] = [];
  for (const c of data.contents) {
    const key = str(c.key);
    const title = str(c.name).trim();
    const date = str(c.publishAt).slice(0, 10);
    if (!/^n[0-9a-z]+$/.test(key) || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (c.status && c.status !== 'published') continue;
    items.push({
      key,
      title,
      date,
      url: str(c.noteUrl) || `https://note.com/gensnotes/n/${key}`,
      hashtags: (c.hashtags ?? [])
        .map((h) => str(h?.hashtag?.name).replace(/^#/, '').trim())
        .filter(Boolean),
      eyecatch: str(c.eyecatch) || null,
      price: typeof c.price === 'number' ? c.price : 0,
      excerpt: str(c.body).replace(/\s+/g, ' ').trim().slice(0, 400),
    });
  }
  return { items, isLastPage: data.isLastPage !== false };
}

/** note の本文 HTML → プレーンテキスト（段落は改行で残す）。 */
export function noteHtmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|blockquote|pre|figure)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 詳細 API（/api/v3/notes/<key>）から本文を取り出す。読めなければ null。 */
export function parseNoteDetail(json: unknown): string | null {
  const body = (json as { data?: { body?: unknown } })?.data?.body;
  if (typeof body !== 'string' || body.length === 0) return null;
  const text = noteHtmlToText(body);
  return text.length > 0 ? text : null;
}

export function noteFileName(doc: Pick<NoteSummary, 'date' | 'key'>): string {
  return `${doc.date}-${doc.key}.md`;
}

const yamlStr = (s: string) => JSON.stringify(s);

/** Obsidian で開ける1ノート。タグは wikilink にしてグラフに載せる。 */
export function renderNoteMarkdown(doc: NoteDoc): string {
  const fm = [
    '---',
    `title: ${yamlStr(doc.title)}`,
    `date: ${doc.date}`,
    `source: note`,
    `key: ${doc.key}`,
    `url: ${doc.url}`,
    `tags: [${doc.hashtags.map(yamlStr).join(', ')}]`,
    doc.eyecatch ? `eyecatch: ${doc.eyecatch}` : null,
    doc.price > 0 ? `paid: true` : null,
    '---',
  ].filter((l): l is string => l !== null);
  const links = doc.hashtags.map((t) => `[[tag/${t}]]`).join(' ');
  return `${fm.join('\n')}\n\n# ${doc.title}\n\n${links ? `${links}\n\n` : ''}${doc.body}\n`;
}

/** renderNoteMarkdown の逆。vault を読み戻すとき（RAG・正典チェック）に使う。 */
export function parseVaultNote(raw: string): NoteDoc | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const fm = m[1];
  const get = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? '';
  let title = get('title');
  try {
    title = JSON.parse(title);
  } catch {
    /* 素の文字列 */
  }
  const tags = [...get('tags').matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  const body = m[2]
    .replace(/^\s*#\s.*\n+/, '')
    .replace(/^(\[\[tag\/[^\]]+\]\]\s*)+\n+/, '')
    .trim();
  const date = get('date');
  const key = get('key');
  if (!title || !date || !key) return null;
  return {
    key,
    title,
    date,
    url: get('url'),
    hashtags: tags,
    eyecatch: get('eyecatch') || null,
    price: get('paid') === 'true' ? 1 : 0,
    excerpt: body.slice(0, 400),
    body,
  };
}

/** タグ → ノートの MOC（Map of Content）。Obsidian の入口として vault 直下に置く。 */
export function renderMoc(docs: NoteSummary[], syncedAt: string): string {
  const byTag = new Map<string, NoteSummary[]>();
  for (const d of docs) for (const t of d.hashtags) byTag.set(t, [...(byTag.get(t) ?? []), d]);
  const tags = [...byTag.entries()]
    .filter(([, list]) => list.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 60);
  const lines = [
    '# Genesis Vault — MOC',
    '',
    `note.com/gensnotes から ${docs.length} 記事を同期（${syncedAt}）。`,
    'このファイルは `scripts/sync-note.mjs` の生成物。手で編集しない。',
    '',
  ];
  for (const [tag, list] of tags) {
    lines.push(`## [[tag/${tag}]]（${list.length}）`, '');
    for (const d of [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)) {
      lines.push(`- [[note/${noteFileName(d).replace(/\.md$/, '')}|${d.title}]]`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
