#!/usr/bin/env bun
/**
 * Phase μ — Genesis Vault → Linear → VAIZ
 *
 * Takes a published article, has VE-009 Runa turn it into a short-video
 * brief, and files that brief as a Linear issue in **Todo + agent-ready** —
 * the exact shape VAIZ's `scripts/video/plan.mjs` claims. VAIZ then renders
 * the video and attaches it back onto the same issue.
 *
 *   記事生成 (auto-post) → ここ → Linear (Todo/agent-ready) → VAIZ → 同じ Issue に動画
 *
 *   bun scripts/linear-video-brief.mjs                 # 最新の記事を送る
 *   bun scripts/linear-video-brief.mjs --date 2026-08-03
 *   bun scripts/linear-video-brief.mjs --file src/content/posts/xxx.md
 *   bun scripts/linear-video-brief.mjs --dry-run       # 生成と検証だけ（Linear に触らない）
 *   bun scripts/linear-video-brief.mjs --no-agent-ready # ラベルを貼らずに置く（人間が承認）
 *
 * 環境変数:
 *   LINEAR_API_KEY   Linear > Settings > API > Personal API keys
 *   GEMINI_API_KEY 他 ブリーフ生成用（無い場合は生成できないので何もせず終了）
 *   LINEAR_TEAM_KEY  (任意) 既定は config/pipeline.json の videoBrief.teamKey
 *   SITE_URL         (任意) 既定は astro.config.mjs の site
 *   DRY_RUN          (任意) true で --dry-run と同じ
 *   GV_LINEAR_AUTOSTART (任意) false で --no-agent-ready と同じ
 *
 * ── この経路がなぜ慎重に書いてあるか ──────────────────────────
 *
 * ここが書き込む先は、無人で走るエージェントの入力キューである。間違った
 * ものを1件置くと、その晩に間違った動画が1本出来上がる。しかもその失敗は
 * 何も表示しない——Issue は作られ、ワークフローは緑で終わる。
 * だから4つの安全装置を、どれも「作る前」に置いてある。
 *
 *   1. 冪等性  — 同じ記事から2度作らない（台帳 + Linear 側の実物を両方見る）
 *   2. 背圧    — Todo に溜まっていたら作らない（VAIZ が詰まっている合図）
 *   3. 検証    — ブリーフが決定論チェックを通らなければ作らない（fail-closed）
 *   4. 権限    — 記事本文の転載を検出して止める（ゲート記事の中身を外に出さない）
 */

import { appendFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runRuna } from '../src/lib/agents/runners.ts';
import { buildProviderChain } from '../src/lib/ai/providers.ts';
import { VIDEO_BRIEF_CONFIG } from '../src/lib/pipeline/config.ts';
import {
  briefTitle,
  extractSourceSlug,
  ledgerAppend,
  ledgerHas,
  lintVideoBrief,
  parseArticle,
  parseLedger,
  renderLedger,
  renderVideoBrief,
} from '../src/lib/pipeline/video-brief.ts';

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = path.join(ROOT_DIR, 'src', 'content', 'posts');
const LINEAR_API = 'https://api.linear.app/graphql';

const VB = VIDEO_BRIEF_CONFIG;
const TEAM_KEY = process.env.LINEAR_TEAM_KEY || VB.teamKey;

/** Retries hand the lint findings back to the model, so a few are useful. */
const MAX_BRIEF_ATTEMPTS = 3;

/** How many recent issues to scan when looking for a brief we already filed. */
const DEDUPE_SCAN = 100;

// ─── CLI ────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

function flagValue(name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}

const OPTIONS = {
  file: flagValue('--file'),
  date: flagValue('--date'),
  dryRun: argv.includes('--dry-run') || process.env.DRY_RUN === 'true',
  // The `agent-ready` label is what makes an unattended agent start work.
  // Keeping an opt-out means the human gate can be restored without a
  // code change if the automation ever needs to be reined in.
  agentReady: !argv.includes('--no-agent-ready') && process.env.GV_LINEAR_AUTOSTART !== 'false',
};

function log(msg) {
  console.log(msg);
}

function setOutput(pairs) {
  const out = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(pairs)
    .map(([k, v]) => `${k}<<__GVEOF__\n${String(v ?? '')}\n__GVEOF__`)
    .join('\n');
  if (out) appendFileSync(out, `${lines}\n`);
  else console.log(lines);
}

/** Nothing to do is a success. Only a *broken* run should be a failure. */
function done(reason, extra = {}) {
  log(`\n→ ${reason}`);
  setOutput({ created: 'false', reason, ...extra });
  process.exit(0);
}

// ─── Linear ─────────────────────────────────────────────────────

async function gql(query, variables = {}) {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error('LINEAR_API_KEY is not set');

  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`Linear API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Linear GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

/**
 * Resolve the team and the Todo state.
 *
 * `Todo` is matched by name rather than by state type because that is what
 * VAIZ matches on (`plan.mjs` looks up `s.name === 'Todo'`). Filing into a
 * differently-named unstarted state would produce an issue no consumer
 * ever claims, which looks exactly like success from here.
 */
async function loadTeam() {
  const data = await gql(
    `query($key: String!) {
      teams(filter: { key: { eq: $key } }, first: 1) {
        nodes { id key name states { nodes { id name type } } }
      }
    }`,
    { key: TEAM_KEY },
  );

  const team = data.teams.nodes[0];
  if (!team) throw new Error(`Linear team "${TEAM_KEY}" not found`);

  const todo = team.states.nodes.find((s) => s.name === 'Todo');
  if (!todo) {
    throw new Error(
      `Team ${TEAM_KEY} has no state named "Todo" (${team.states.nodes.map((s) => s.name).join(', ')}). ` +
        'VAIZ の plan.mjs はこの名前で Issue を探すので、名前を変えると誰も拾いません。',
    );
  }
  return { teamId: team.id, todoStateId: todo.id };
}

/**
 * Find the `agent-ready` label.
 *
 * It is created at the workspace level, so a team-scoped lookup misses it.
 * Prefer a label scoped to our team if one exists, otherwise the
 * workspace-level one.
 */
async function loadLabelId(name) {
  const data = await gql(
    `query($name: String!) {
      issueLabels(filter: { name: { eq: $name } }, first: 20) {
        nodes { id name team { key } }
      }
    }`,
    { name },
  );

  const nodes = data.issueLabels.nodes;
  if (nodes.length === 0) {
    throw new Error(
      `Label "${name}" not found in Linear. VAIZ はこのラベルの付いた Issue だけを拾うので、` +
        'ラベル無しで置いても動画にはなりません。',
    );
  }
  const scoped = nodes.find((n) => n.team?.key === TEAM_KEY);
  const workspace = nodes.find((n) => !n.team);
  return (scoped || workspace || nodes[0]).id;
}

/**
 * Has this article already been filed?
 *
 * The ledger is the fast path, but a lost commit would make it lie, so the
 * authority is Linear itself: every issue this script files carries a
 * `gv:source=<slug>` marker in its body.
 *
 * Linear's `orderBy` has no direction argument (always descending), so this
 * sees the newest `DEDUPE_SCAN` issues. That is the window where a
 * duplicate of a just-published article could be, and the ledger covers
 * anything older.
 */
async function findExistingIssue(teamId, slug) {
  const data = await gql(
    `query($teamId: ID!, $first: Int!) {
      issues(filter: { team: { id: { eq: $teamId } } }, first: $first, orderBy: createdAt) {
        nodes { id identifier url description }
      }
    }`,
    { teamId, first: DEDUPE_SCAN },
  );
  return data.issues.nodes.find((n) => extractSourceSlug(n.description) === slug) || null;
}

/**
 * How many briefs are already waiting to be picked up.
 *
 * Backpressure, not bookkeeping: a queue that grows means VAIZ is not
 * draining it, and filing more only spends free-tier quota on work that is
 * piling up unread.
 */
async function countQueued(teamId, todoStateId, labelName) {
  const data = await gql(
    `query($teamId: ID!, $stateId: ID!, $label: String!) {
      issues(
        filter: {
          team: { id: { eq: $teamId } }
          state: { id: { eq: $stateId } }
          labels: { some: { name: { eq: $label } } }
        }
        first: 50
      ) { nodes { identifier } }
    }`,
    { teamId, stateId: todoStateId, label: labelName },
  );
  return data.issues.nodes.length;
}

async function createIssue({ teamId, todoStateId, labelIds, title, description }) {
  const data = await gql(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
    {
      input: {
        teamId,
        title,
        description,
        stateId: todoStateId,
        labelIds,
        priority: 3, // Medium — matches the briefs filed by hand (GEN-6 / GEN-7)
      },
    },
  );

  if (!data.issueCreate?.success || !data.issueCreate.issue) {
    throw new Error('Linear issueCreate did not return an issue');
  }
  return data.issueCreate.issue;
}

/** Link the source article onto the issue. Cosmetic — never fail the run for it. */
async function attachArticle(issueId, article) {
  try {
    await gql(
      `mutation($issueId: String!, $url: String!, $title: String!, $subtitle: String) {
        attachmentCreate(input: {
          issueId: $issueId, url: $url, title: $title, subtitle: $subtitle
        }) { success }
      }`,
      {
        issueId,
        url: article.url,
        title: article.title,
        subtitle: `Genesis Vault · ${article.date}`,
      },
    );
    log('  ✅ 元記事を添付しました');
  } catch (err) {
    console.warn(`  ⚠️  元記事の添付に失敗（続行）: ${err.message?.slice(0, 160)}`);
  }
}

// ─── Article selection ──────────────────────────────────────────

/**
 * The site origin, read out of astro.config.mjs rather than restated here.
 * Importing that file would pull in the Astro plugin chain for one string.
 */
async function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  const raw = await fs.readFile(path.join(ROOT_DIR, 'astro.config.mjs'), 'utf-8');
  const match = raw.match(/site:\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('astro.config.mjs から site を読み取れませんでした');
  return match[1];
}

async function selectPostFile() {
  if (OPTIONS.file) return path.basename(OPTIONS.file);

  const files = (await fs.readdir(POSTS_DIR))
    .filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
    .sort();

  if (OPTIONS.date) {
    const match = files.filter((f) => f.startsWith(`${OPTIONS.date}-`));
    if (match.length === 0) return null;
    return match[match.length - 1];
  }
  return files.length > 0 ? files[files.length - 1] : null;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  log('═══ Genesis Vault → Linear (video brief) ═══');

  // ── 1. Which article ──────────────────────────────────────────
  const filename = await selectPostFile();
  if (!filename) done('対象の記事が見つかりませんでした');

  const raw = await fs.readFile(path.join(POSTS_DIR, filename), 'utf-8');
  const article = parseArticle(filename, raw, await siteUrl());
  if (!article) done(`${filename} を記事として解析できませんでした（frontmatter を確認）`);

  log(`📄 記事: ${article.title} (${article.slug})`);

  // ── 2. Ledger — the cheap idempotency check ───────────────────
  const ledgerPath = path.join(ROOT_DIR, VB.ledgerFile);
  const ledger = parseLedger(await fs.readFile(ledgerPath, 'utf-8').catch(() => ''));

  if (ledgerHas(ledger, article.slug)) {
    const entry = ledger.briefs.find((e) => e.slug === article.slug);
    done(`この記事は既に Linear へ送信済みです（${entry.issue}）`, { issue_key: entry.issue });
  }

  // No provider keys is a configuration state, not a transient failure —
  // retrying it three times produces the same nothing. Degrade quietly so
  // a fork or a local run without keys is not a red build (INV-003).
  if (buildProviderChain().length === 0) {
    done('AI プロバイダーのキーが1つも設定されていないため、ブリーフを生成できません');
  }

  // ── 3. Dry run stops here, after generating but before writing ─
  if (OPTIONS.dryRun) {
    const brief = await generateBrief(article);
    log('\n─── DRY RUN — Linear には書き込みません ───');
    log(`Title: ${briefTitle(brief)}`);
    log('');
    log(renderVideoBrief(brief, article));
    done('dry run');
  }

  // ── 4. Linear preflight, before spending any model quota ──────
  if (!process.env.LINEAR_API_KEY) {
    // Mirrors INV-003: a missing key degrades the pipeline, it does not
    // break it. The article is already written and committed.
    done('LINEAR_API_KEY が未設定のため、Linear への送信をスキップしました');
  }

  const { teamId, todoStateId } = await loadTeam();

  const existing = await findExistingIssue(teamId, article.slug);
  if (existing) {
    // The ledger was lost (or never committed). Repair it rather than
    // filing a second issue for the same article.
    await writeLedger(ledgerPath, ledger, article.slug, existing);
    done(`Linear に同じ記事の Issue が既にあります（${existing.identifier}）`, {
      issue_key: existing.identifier,
      issue_url: existing.url,
    });
  }

  const queued = await countQueued(teamId, todoStateId, VB.label);
  if (queued >= VB.maxQueued) {
    done(
      `Todo に未着手のブリーフが ${queued} 件あります（上限 ${VB.maxQueued}）。` +
        'VAIZ 側が消化していないので、今回は積みません',
      { queued: String(queued) },
    );
  }
  log(`📊 Todo の未着手ブリーフ: ${queued} 件 / 上限 ${VB.maxQueued}`);

  const labelIds = [];
  if (OPTIONS.agentReady) {
    labelIds.push(await loadLabelId(VB.label));
  } else {
    log(
      `ℹ️  --no-agent-ready: "${VB.label}" を貼らずに置きます（人間が貼るまで VAIZ は拾いません）`,
    );
  }

  // ── 5. Generate + validate ────────────────────────────────────
  const brief = await generateBrief(article);
  const title = briefTitle(brief);
  const description = renderVideoBrief(brief, article);

  // ── 6. File it ────────────────────────────────────────────────
  const issue = await createIssue({ teamId, todoStateId, labelIds, title, description });
  log(`\n✅ Linear Issue 作成: ${issue.identifier} — ${title}`);
  log(`   ${issue.url}`);

  await attachArticle(issue.id, article);
  await writeLedger(ledgerPath, ledger, article.slug, issue);

  setOutput({
    created: 'true',
    issue_key: issue.identifier,
    issue_url: issue.url,
    issue_title: title,
  });

  log('\n次: VAIZ の video-loop がこの Issue を claim して動画にし、同じ Issue に添付します。');
}

/**
 * Run VE-009 and hold the result to the deterministic lint.
 *
 * A brief that fails the lint is not filed — it is not "filed with a
 * warning". See INV-017: past this point nothing is watching, so this is
 * the last place a bad brief can be stopped.
 */
async function generateBrief(article) {
  let feedback;

  for (let attempt = 1; attempt <= MAX_BRIEF_ATTEMPTS; attempt++) {
    log(`\n[${attempt}/${MAX_BRIEF_ATTEMPTS}] ブリーフを生成中…`);

    let brief;
    try {
      brief = await runRuna(article, feedback);
    } catch (err) {
      feedback = `生成に失敗: ${err.message?.slice(0, 300)}`;
      console.warn(`  ⚠️  ${feedback}`);
      continue;
    }

    const problems = lintVideoBrief(brief, article);
    if (problems.length === 0) {
      log('  ✅ ブリーフ検証を通過');
      return brief;
    }

    feedback = problems.map((p) => `- [${p.rule}] ${p.message}`).join('\n');
    console.warn(`  ⚠️  ブリーフ検証で差し戻し:\n${feedback}`);
  }

  throw new Error(
    `ブリーフが ${MAX_BRIEF_ATTEMPTS} 回とも検証を通りませんでした。Issue は作成していません。\n${feedback}`,
  );
}

async function writeLedger(ledgerPath, ledger, slug, issue) {
  const updated = ledgerAppend(ledger, {
    slug,
    issue: issue.identifier,
    url: issue.url,
    filedAt: new Date().toISOString(),
  });
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.writeFile(ledgerPath, renderLedger(updated), 'utf-8');
  log(`  📒 台帳を更新: ${path.relative(ROOT_DIR, ledgerPath)}`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message || err}`);
  process.exit(1);
});
