/**
 * Genesis Vault — Linear Bridge
 *
 * 使い方:
 *   bun scripts/linear-sync.mjs claim               … Todo の企画を1件確保して In Progress へ
 *   bun scripts/linear-sync.mjs report <id> <url>   … PR URL を返して In Review へ
 *   bun scripts/linear-sync.mjs fail   <id> <理由>  … 失敗を返して Backlog へ戻す
 *
 * 環境変数:
 *   LINEAR_API_KEY   (必須)  Linear > Settings > Security & access > Personal API keys
 *   LINEAR_TEAM_KEY  (任意)  既定 GEN
 */

import { appendFileSync } from 'node:fs';

const API = 'https://api.linear.app/graphql';
const TEAM_KEY = process.env.LINEAR_TEAM_KEY || 'GEN';

// Linear 側の既定ステータス名にそのまま合わせてある。
// 失敗の戻し先を queued と別にしてあるのは、無限ループを防ぐため。
const STATE = {
  queued: 'Todo',
  writing: 'In Progress',
  review: 'In Review',
  failed: 'Backlog',
};

async function gql(query, variables = {}) {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error('LINEAR_API_KEY is not set');

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`Linear API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Linear GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

/** チームの「状態名 → ID」対応表を1リクエストで引く */
async function loadStates() {
  const data = await gql(
    `query($key: String!) {
      teams(filter: { key: { eq: $key } }, first: 1) {
        nodes { id name key states { nodes { id name } } }
      }
    }`,
    { key: TEAM_KEY },
  );

  const team = data.teams.nodes[0];
  if (!team) throw new Error(`Team "${TEAM_KEY}" not found`);

  const map = Object.fromEntries(team.states.nodes.map((s) => [s.name, s.id]));

  // 名前がひとつでも欠けていたら、静かに失敗せずここで落とす
  for (const [role, name] of Object.entries(STATE)) {
    if (!map[name]) {
      throw new Error(
        `Status "${name}" (${role}) not found in team ${TEAM_KEY}. ` +
          `Available: ${Object.keys(map).join(', ')}`,
      );
    }
  }
  return { teamId: team.id, map };
}

function setOutput(pairs) {
  const lines = Object.entries(pairs)
    .map(([k, v]) => `${k}<<__GVEOF__\n${String(v ?? '')}\n__GVEOF__`)
    .join('\n');

  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `${lines}\n`);
  else console.log(lines);
}

async function moveTo(issueId, stateId) {
  await gql(
    `mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success }
    }`,
    { id: issueId, stateId },
  );
}

async function comment(issueId, body) {
  await gql(
    `mutation($id: String!, $body: String!) {
      commentCreate(input: { issueId: $id, body: $body }) { success }
    }`,
    { id: issueId, body },
  );
}

/** Todo の中で最も古い企画を1件だけ確保し、In Progress へ動かす */
async function claim() {
  const { map } = await loadStates();

  const data = await gql(
    `query($key: String!, $state: String!) {
      issues(
        filter: { team: { key: { eq: $key } }, state: { name: { eq: $state } } }
        first: 20
      ) {
        nodes { id identifier title description createdAt }
      }
    }`,
    { key: TEAM_KEY, state: STATE.queued },
  );

  const nodes = [...data.issues.nodes].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  );
  const issue = nodes[0];

  if (!issue) {
    console.log(`No issue in "${STATE.queued}". Nothing to do.`);
    setOutput({ found: 'false' });
    return;
  }

  await moveTo(issue.id, map[STATE.writing]);

  console.log(`Claimed ${issue.identifier}: ${issue.title}`);
  setOutput({
    found: 'true',
    issue_id: issue.id,
    issue_key: issue.identifier,
    theme: issue.title,
    brief: issue.description || '',
  });
}

async function report(issueId, url) {
  const { map } = await loadStates();
  await comment(issueId, `Draft is ready for review.\n\n${url}`);
  await moveTo(issueId, map[STATE.review]);
  console.log(`Reported: ${url}`);
}

async function fail(issueId, reason) {
  const { map } = await loadStates();
  await comment(issueId, `The run did not finish.\n\n\`\`\`\n${reason}\n\`\`\``);
  await moveTo(issueId, map[STATE.failed]);
  console.log(`Returned to ${STATE.failed}: ${reason}`);
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'claim') await claim();
  else if (cmd === 'report') await report(args[0], args[1]);
  else if (cmd === 'fail') await fail(args[0], args.slice(1).join(' '));
  else {
    console.error('Usage: linear-sync.mjs claim | report <id> <url> | fail <id> <reason>');
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
