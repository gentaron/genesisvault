/**
 * 一覧カード用のカバー絵を静的な SVG ファイルとして書き出す（/art/<slug>.svg）。
 * 一覧に 148 枚をインラインで埋めると HTML が 400KB 太るので、カードは
 * <img loading="lazy"> で見えたものから読む。記事ページの大きな絵はインライン（動きつき）。
 */

import { getCollection } from 'astro:content';
import type { APIRoute, GetStaticPaths } from 'astro';
import { buildCoverSvg } from '../../lib/art/cover';

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getCollection('posts', ({ data }) => data.draft !== true);
  return posts.map((post) => ({
    params: { slug: post.slug },
    props: { title: post.data.title, tags: post.data.tags },
  }));
};

export const GET: APIRoute = ({ params, props }) =>
  new Response(
    buildCoverSvg({
      slug: String(params.slug),
      title: String(props.title),
      tags: props.tags as string[],
    }),
    { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } },
  );
