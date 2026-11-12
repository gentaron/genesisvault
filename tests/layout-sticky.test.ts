/**
 * スクロールしても記事のタイトルが降りてこないこと（LM-025）。
 *
 * 素の `header { position: sticky }` は、記事ページのタイトル部分の <header> にも
 * 当たってしまう。固定してよいのはサイトのナビ（.site-header）だけ。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '..');
const cssFiles = readdirSync(path.join(root, 'src/styles'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => path.join(root, 'src/styles', f));

/** CSS をルール（セレクタ → 本文）に分ける。@media などの入れ子も中身ごと拾う。 */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

describe('sticky / fixed はサイトのナビ以外の見出しに当てない', () => {
  it.each(cssFiles)('%s', (file) => {
    for (const r of rules(readFileSync(file, 'utf-8'))) {
      if (!/position\s*:\s*(sticky|fixed)/.test(r.body)) continue;
      for (const sel of r.selector.split(',').map((s) => s.trim())) {
        // 要素名だけの header / h1 / h2 や、記事タイトルのクラスを固定してはいけない
        expect(sel, `${path.basename(file)}: ${sel}`).not.toMatch(
          /(^|[\s>+~])(header|h1|h2|article)(?![\w-])|\.page-title|\.post-title/,
        );
      }
    }
  });

  it('サイトのナビは .site-header クラスで固定している', () => {
    const layout = readFileSync(path.join(root, 'src/layouts/BaseLayout.astro'), 'utf-8');
    expect(layout).toContain('<header class="site-header">');
  });

  it('記事ページのタイトル部分は site-header ではない', () => {
    const page = readFileSync(path.join(root, 'src/pages/posts/[...slug].astro'), 'utf-8');
    expect(page).not.toMatch(/<header[^>]*site-header/);
  });
});
