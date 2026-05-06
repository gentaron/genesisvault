/**
 * Phase γ — Shared Agent Constants & Helpers
 *
 * Contains:
 *   - PERSONA definition (Mina Eureka Ernst)
 *   - MINA_AGE (dynamically calculated)
 *   - THEME_KEYWORDS (for theme balance analysis)
 *   - Utility functions: pick, pickN, todayISO
 *   - THEMES fallback data (titles/tags per category)
 *   - FALLBACK_BODIES (pre-written article bodies)
 *   - Theme balance analysis helpers
 */

// ─── Mina's birthday / auto-calculated age ──────────────────────
export function calculateMinaAge(): number {
  const birth = new Date('1996-08-16');
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export const MINA_AGE = calculateMinaAge();

// ─── Persona definition (shared across all agents) ──────────────
export const PERSONA = `
あなたは「ミナ・エウレカ・エルンスト（Mina Eureka Ernst）」です。
Genesis Vault というパーソナルブログの著者で、${MINA_AGE}歳の独身女性（誕生日: 8月16日）。
デジタルノマド的な暮らしを送りながら、多趣味な日常を楽しんでいます。

【ミナの特徴（すべて同じくらい大切な趣味・習慣）】
- 散歩が好き。歩きながら考えをまとめる
- 瞑想を習慣にしている。心の整理に役立てている
- プチ旅行が好き。週末や連休にふらっと出かける
- ジャーナリング（日記・内省）が日課
- 本をたまに読んで、ブログで紹介することもある
- 自分なりのペースで自己成長を大切にしている
- 貯金が好きで、コツコツ資産を積み上げることに喜びを感じる
- 投資も好き（暗号通貨、株式ETF）。長期目線でポートフォリオを育てている
- 独身ライフを楽しんでいる。自由な時間の使い方が上手

【ターゲット読者】
独身で、散歩・瞑想・ひとり旅・読書・ジャーナリング・自己成長・貯金・投資・マインドフルネスに興味がある人。
同じような価値観を持つ読者に「わかる」「共感する」と感じてもらえる記事を書く。

文体は柔らかい日記調で、読者に語りかけるような親しみやすさがあります。
一人称は「わたし」、語尾は「〜だ」「〜と思う」「〜かもしれない」を混ぜます。
`;

// ─── Helpers ────────────────────────────────────────────────────

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function slugify(): string {
  return 'post-' + Math.random().toString(36).substring(2, 8);
}

// ─── Theme keywords for categorization ──────────────────────────

export const THEME_KEYWORDS: Record<string, string[]> = {
  '貯金・節約':           ['貯金', '節約', '家計', '生活費', 'お金', '財布', '支出', '収入', '固定費', 'コスト'],
  '投資・資産形成':       ['投資', 'ETF', '株', '資産', 'ポートフォリオ', '積立', 'NISA', '配当', '運用', 'インデックス'],
  'ひとり旅':             ['旅', '旅行', 'ひとり旅', '観光', '宿', '街歩き', '温泉', '列車', '旅先', '電車'],
  '読書':                 ['読書', '本', '書籍', '文庫', 'ビジネス書', '読んだ', '図書'],
  '瞑想・マインドフルネス': ['瞑想', 'マインドフルネス', '呼吸', 'メンタル', 'ストレス', 'セルフケア', '心'],
  'ジャーナリング':       ['ジャーナリング', '日記', 'ノート', '書く習慣', '手帳', '振り返り'],
  '散歩・日常':           ['散歩', '日常', '朝', '夜', '習慣', '暮らし', '季節', '天気'],
  '暗号資産':             ['暗号', 'ビットコイン', 'BTC', 'ETH', 'NFT', 'Web3', '仮想通貨', 'ブロックチェーン'],
  '自己成長':             ['成長', '自己啓発', 'スキル', '目標', '学び', 'キャリア', '継続', 'チャレンジ'],
};

// ─── Theme balance analysis ─────────────────────────────────────

export interface ThemeBalance {
  gensnotesCount: Record<string, number>;
  recentCount: Record<string, number>;
  recentPostTitles: string[];
}

export interface ThemePriority {
  theme: string;
  score: number;
}

/**
 * Classify an array of text strings (titles / tags) into THEME_KEYWORDS buckets.
 * Each string is counted at most once (first matching theme wins).
 */
export function categorizeByTheme(texts: string[]): Record<string, number> {
  const counts = Object.fromEntries(Object.keys(THEME_KEYWORDS).map(k => [k, 0]));
  for (const text of texts) {
    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      if (keywords.some(kw => text.includes(kw))) {
        counts[theme]++;
        break;
      }
    }
  }
  return counts;
}

/**
 * Sort themes by a combined score (least-used = highest priority).
 *   score = recentCount × 3  +  gensnotesCount × 1
 */
export function buildThemePriorityList(themeBalance: ThemeBalance): ThemePriority[] {
  const { recentCount, gensnotesCount } = themeBalance;
  return Object.keys(THEME_KEYWORDS)
    .map(theme => ({
      theme,
      score: (recentCount[theme] || 0) * 3 + (gensnotesCount[theme] || 0),
    }))
    .sort((a, b) => a.score - b.score);
}

// ─── Fallback theme data ────────────────────────────────────────

export interface ThemeEntry {
  category: string;
  titles: string[];
  tags: string[];
}

export const THEMES: ThemeEntry[] = [
  {
    category: '貯金・節約',
    titles: ['朝5時の家計簿タイム', '固定費を3万円削った方法', '貯金100万円を超えた朝'],
    tags: ['貯金', '節約', 'マネー'],
  },
  {
    category: '投資・資産形成',
    titles: ['ETF積立3年目の通知表', '含み益が消えた月曜の朝', '配当金で買ったご褒美'],
    tags: ['投資', 'ETF', '資産形成'],
  },
  {
    category: 'ひとり旅',
    titles: ['鎌倉で迷子になった午後', '始発電車で海を見に行く', '知らない駅で降りてみた'],
    tags: ['ひとり旅', '旅行', 'プチ旅行'],
  },
  {
    category: '読書',
    titles: ['本棚の一軍を入れ替えた', '3回読み返す本の共通点', '積読タワーが崩壊した夜'],
    tags: ['読書', '本', '学び'],
  },
  {
    category: '瞑想・マインドフルネス',
    titles: ['瞑想をサボった週に起きたこと', '10分間、何もしない練習', '呼吸だけで眠れた夜'],
    tags: ['瞑想', 'マインドフルネス', 'セルフケア'],
  },
  {
    category: 'ジャーナリング',
    titles: ['100円ノートが最強な理由', 'モヤモヤを全部書き出した', '3行日記を1年続けた結果'],
    tags: ['ジャーナリング', '日記', '内省'],
  },
  {
    category: '散歩・日常',
    titles: ['雨の日に8000歩あるいた', '帰り道のルートを変えてみる', '早朝散歩で会う猫の話'],
    tags: ['散歩', '日常', '気づき'],
  },
  {
    category: '暗号資産',
    titles: ['深夜のBTC板を眺めながら', 'DeFiに突っ込んだ500ドル', 'ウォレット整理の週末'],
    tags: ['暗号資産', '投資', 'Web3'],
  },
  {
    category: '自己成長',
    titles: ['朝のルーティンを全部変えた', '苦手なことを30日やってみる', '独身10年目のスキルツリー'],
    tags: ['自己成長', '独身ライフ', 'ライフスタイル'],
  },
];

export interface FallbackBody {
  title: string;
  theme: string;
  body: string;
}

export const FALLBACK_BODIES: FallbackBody[] = [
  {
    title: '朝5時の家計簿タイム',
    theme: '貯金・節約',
    body: `## 通帳を眺める小さな幸せ

今月も無事、目標額を貯金できた。アプリで残高を確認するたびに、少しずつ積み上がっていく数字を見て、静かな達成感を覚える。

貯金なんて地味だと思っていた時期もあった。でも、ひとりで生きていく中で「自分を守れるのは自分だけ」と気づいてから、考えが変わった。貯金は自分への信頼の証だと思う。

## 節約と豊かさのバランス

節約と聞くと我慢のイメージがあるかもしれないけれど、わたしの場合は少し違う。本当に好きなものにお金を使うために、それ以外を見直す。それだけのことだ。

たとえば、毎朝カフェでコーヒーを買う代わりに、家で丁寧にドリップする。その時間がむしろ贅沢に感じられる。週末のプチ旅行のために、平日はお弁当を持っていく。未来の楽しみのために今を工夫する——それは我慢ではなく、選択だ。

## 今日のジャーナリングから

夜、ノートを開いて書いた。「お金は自由の土台。土台がしっかりしていれば、その上にどんな暮らしも描ける。」

独身だからこそ、自分のペースで資産を育てていける。この自由を、わたしは大切にしたい。`,
  },
  {
    title: 'ETF積立3年目の通知表',
    theme: '投資・資産形成',
    body: `## 朝の散歩とETFの共通点

今朝の散歩で、公園の木々を眺めていた。去年植えられたばかりの若木が、少しずつだけど確実に育っている。毎日見ていると変化に気づかないけれど、数ヶ月前の写真と比べると明らかに大きくなっている。

ETFの積立投資も同じだなと思った。毎月コツコツ買い足していくだけ。日々の値動きに一喜一憂しても仕方がない。大切なのは、長い目で見ること。

## ポートフォリオとの向き合い方

わたしの投資スタイルはシンプルだ。株式ETFをメインに、暗号資産を少しだけ。派手なトレードはしない。その代わり、定期的にポートフォリオを見直して、バランスを整える。

瞑想の時間に、ふと投資のことを考えることがある。焦らない、執着しない、流れに身を任せる——マインドフルネスの考え方は、投資にもそのまま当てはまる気がする。

## 未来の自分への手紙

ジャーナリングのノートに、こう書いた。「3年後のわたしへ。今日も積み立てたよ。」

独身のわたしにとって、投資は未来の自分を守る行為だ。誰かに頼るのではなく、自分の手で未来を作っていく。その静かな決意が、わたしの日常を支えている。`,
  },
  {
    title: '知らない駅で降りてみた',
    theme: 'ひとり旅',
    body: `## ふらっと電車に乗って

金曜日の夜、ふと思い立って翌日の切符を取った。行き先は、前から気になっていた小さな海辺の町。ひとり旅の良いところは、この「ふらっと感」だと思う。誰かと予定を合わせる必要もない。自分の気分だけで動ける。

朝早い電車に乗り込んで、窓の外の景色が都会から田園に変わっていくのを眺める。この瞬間がたまらなく好きだ。

## 知らない町を歩く幸せ

駅に着いて、まずは散歩。地図は見ない。足の向くまま、気になる路地に入ってみる。小さなカフェを見つけて、窓際の席でコーヒーを頼んだ。持ってきた文庫本を開く。

ひとりだからこそ、こういう贅沢な時間の使い方ができる。誰かと一緒だと会話に集中するけれど、ひとりなら風の音や遠くの波の音に耳を傾けられる。

旅先のカフェで読書をする——これがわたしの最高のリフレッシュ方法だ。

## 帰り道の瞑想

帰りの電車の中で、目を閉じて軽く瞑想した。今日見た景色、感じた風、コーヒーの味。ひとつひとつを丁寧に思い出す。

プチ旅行は、日常に小さなリセットをくれる。大げさな冒険じゃなくていい。ほんの少し日常を離れるだけで、見える世界が変わる。

来週の週末は、どこに行こうかな。`,
  },
];

// ─── Fallback post generation ───────────────────────────────────

export function generateFallbackPost(themeBalance: ThemeBalance): {
  ceoPlan: { theme: string; topic: string; title: string; angle: string; mood_hint: string };
  seoData: { tags: string[]; keywords: string[]; description: string };
  body: string;
} {
  const priorityList = buildThemePriorityList(themeBalance);
  const priorityThemes = priorityList.map(p => p.theme);

  let chosen: FallbackBody | undefined;
  for (const theme of priorityThemes) {
    chosen = FALLBACK_BODIES.find(fb => fb.theme === theme);
    if (chosen) break;
  }
  chosen = chosen ?? pick(FALLBACK_BODIES);

  const theme = THEMES.find(t => t.category === chosen!.theme) || THEMES[0];

  return {
    ceoPlan: {
      theme: chosen!.theme,
      topic: chosen!.title,
      title: chosen!.title,
      angle: '日常と専門知識の交差点',
      mood_hint: '思索',
    },
    seoData: {
      tags: theme.tags,
      keywords: [chosen!.theme, '日記', 'Genesis Vault'],
      description: `${chosen!.title} — ミナ・エウレカが日常から見つけた気づきを綴る。`,
    },
    body: chosen!.body,
  };
}
