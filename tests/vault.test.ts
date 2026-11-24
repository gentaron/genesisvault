import { describe, expect, it } from 'vitest';
import {
  noteHtmlToText,
  parseNoteDetail,
  parseNoteListPage,
  parseVaultNote,
  renderMoc,
  renderNoteMarkdown,
} from '../src/lib/vault/note';
import {
  bigrams,
  buildIndex,
  buildVaultBrief,
  searchVault,
  type VaultDoc,
} from '../src/lib/vault/retrieve';

describe('vault/note — note.com の写し', () => {
  const page = {
    data: {
      isLastPage: false,
      contents: [
        {
          key: 'n012cfc9f47c5',
          name: '脱スマホ日誌 Day 1',
          publishAt: '2026-11-12T08:00:00+09:00',
          noteUrl: 'https://note.com/gensnotes/n/n012cfc9f47c5',
          hashtags: [{ hashtag: { name: '#脱スマホ' } }],
          eyecatch: 'https://assets.st-note.com/x.png',
          price: 0,
          body: '本文の抜粋',
          status: 'published',
        },
        { key: 'bad key', name: 'x', publishAt: '2026-11-12' },
      ],
    },
  };

  it('一覧ページを読む（壊れた項目は捨てる）', () => {
    const { items, isLastPage } = parseNoteListPage(page);
    expect(isLastPage).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'n012cfc9f47c5',
      date: '2026-11-12',
      hashtags: ['脱スマホ'],
    });
    expect(parseNoteListPage({ nope: 1 })).toEqual({ items: [], isLastPage: true });
  });

  it('本文 HTML をテキストにする', () => {
    expect(noteHtmlToText('<p>一行目</p><p>二行&amp;目<br>改行</p>')).toBe(
      '一行目\n\n二行&目\n改行',
    );
    expect(parseNoteDetail({ data: { body: '<p>こんにちは</p>' } })).toBe('こんにちは');
    expect(parseNoteDetail({})).toBeNull();
  });

  it('Obsidian ノートとして書いて、読み戻せる', () => {
    const item = parseNoteListPage(page).items[0];
    const md = renderNoteMarkdown({ ...item, body: '今日はスマホを置いた。' });
    expect(md).toContain('[[tag/脱スマホ]]');
    const back = parseVaultNote(md);
    expect(back).toMatchObject({
      key: item.key,
      title: item.title,
      date: '2026-11-12',
      body: '今日はスマホを置いた。',
    });
    expect(renderMoc([item, item, item], '2026-11-12')).toContain('[[tag/脱スマホ]]');
  });
});

describe('vault/retrieve — ローカルの決定論 RAG', () => {
  const docs: VaultDoc[] = [
    {
      id: 'a',
      source: 'note',
      date: '2026-11-11',
      title: 'スマホ依存から抜け出す',
      url: 'u1',
      text: 'スマホを置いたら夕焼けが綺麗だった。デジタルデトックスを始めた。',
    },
    {
      id: 'b',
      source: 'diary',
      date: '2026-11-01',
      title: '散歩の朝',
      url: 'u2',
      text: '公園を散歩した。木々が揺れていた。',
    },
    {
      id: 'c',
      source: 'diary',
      date: '2026-10-01',
      title: '瞑想の夜',
      url: 'u3',
      text: '瞑想で呼吸を整えた。',
    },
  ];
  const index = buildIndex(docs);

  it('bigram は記号を落とす', () => {
    expect(bigrams('AI、進化')).toEqual(['ai', 'i進', '進化']);
  });

  it('関係の深い文書が上に来て、抜粋は問い合わせに近い文', () => {
    const hits = searchVault(index, 'スマホ デジタルデトックス', { topK: 2, minScore: 0 });
    expect(hits[0].doc.id).toBe('a');
    expect(hits[0].snippet).toContain('デジタルデトックス');
  });

  it('除外と空クエリ', () => {
    expect(
      searchVault(index, 'スマホ', { exclude: (d) => d.source === 'note', minScore: 0.01 }).map(
        (h) => h.doc.id,
      ),
    ).not.toContain('a');
    expect(searchVault(index, '、。')).toEqual([]);
  });

  it('ブリーフに出典が付く', () => {
    const brief = buildVaultBrief(searchVault(index, 'スマホ', { topK: 1, minScore: 0 }));
    expect(brief).toContain('note 2026-11-11');
    expect(brief).toContain('u1');
    expect(buildVaultBrief([])).toBe('');
  });
});
