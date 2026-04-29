/**
 * Genesis Vault — Nostr NIP-23 Long-form Content Broadcaster
 *
 * 新記事生成後、Nostrネットワークに自動ブロードキャストする。
 * NIP-23 (Long-form Content, kind: 30023) を使用。
 * プロトコル: Nostr
 * リレー: 複数パブリックリレー（完全無料）
 *
 * Usage:
 *   node scripts/nostr-broadcast.mjs <markdown-filepath>
 *
 * Required env:
 *   NOSTR_PRIVATE_KEY — 64文字hex (nsecではなくhex形式)
 *
 * Optional env:
 *   RELAY_URLS — カンマ区切りのリレーURL (default: 4 public relays)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { SimplePool, finalizeEvent, verifyEvent } from 'nostr-tools/pure';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Config ──────────────────────────────────────────────────────
const NOSTR_PRIVATE_KEY = process.env.NOSTR_PRIVATE_KEY;

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://relay.nostr.band',
];

function getRelays() {
  const envRelays = process.env.RELAY_URLS;
  if (envRelays) {
    return envRelays.split(',').map(r => r.trim()).filter(Boolean);
  }
  return DEFAULT_RELAYS;
}

// ─── Parse frontmatter from markdown ─────────────────────────────
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content };

  const metadata = {};
  const fm = match[1];
  const body = match[2].trim();

  // Parse YAML-like frontmatter
  for (const line of fm.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // title: "..."
    const titleMatch = trimmed.match(/^title:\s*"(.+?)"$/);
    if (titleMatch) { metadata.title = titleMatch[1]; continue; }

    // date: YYYY-MM-DD
    const dateMatch = trimmed.match(/^date:\s*(\d{4}-\d{2}-\d{2})$/);
    if (dateMatch) { metadata.date = dateMatch[1]; continue; }

    // tags: [...]
    const tagsMatch = trimmed.match(/^tags:\s*\[([^\]]*)\]$/);
    if (tagsMatch) {
      metadata.tags = tagsMatch[1]
        .split(',')
        .map(t => t.trim().replace(/"/g, ''))
        .filter(Boolean);
      continue;
    }

    // description: "..."
    const descMatch = trimmed.match(/^description:\s*"(.+?)"$/);
    if (descMatch) { metadata.description = descMatch[1]; continue; }

    // keywords: [...]
    const kwMatch = trimmed.match(/^keywords:\s*\[([^\]]*)\]$/);
    if (kwMatch) {
      metadata.keywords = kwMatch[1]
        .split(',')
        .map(k => k.trim().replace(/"/g, ''))
        .filter(Boolean);
      continue;
    }
  }

  return { metadata, body };
}

// ─── Build NIP-23 event ──────────────────────────────────────────
function buildNIP23Event(privkey, metadata, body) {
  // NIP-23 tags
  // "d" tag — unique identifier (slug or date-based)
  const dTag = `${metadata.date || new Date().toISOString().split('T')[0]}-genesis-vault`;

  // "title" tag
  const title = metadata.title || 'Untitled';

  // "published_at" tag
  const publishedAt = metadata.date
    ? Math.floor(new Date(metadata.date).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  // Build tags array for NIP-23
  const tags = [
    ['d', dTag],
    ['title', title],
    ['published_at', String(publishedAt)],
  ];

  // Add summary (description) if available
  if (metadata.description) {
    tags.push(['summary', metadata.description]);
  }

  // Add t tags for each keyword/tag
  const allTags = [
    ...(metadata.tags || []),
    ...(metadata.keywords || []),
  ];
  for (const tag of [...new Set(allTags)]) {
    tags.push(['t', tag]);
  }

  const eventTemplate = {
    kind: 30023, // NIP-23 Long-form Content
    created_at: publishedAt,
    tags,
    content: body,
  };

  const event = finalizeEvent(eventTemplate, privkey);

  if (!verifyEvent(event)) {
    throw new Error('Event verification failed — check your private key');
  }

  return event;
}

// ─── Broadcast to relays ─────────────────────────────────────────
async function broadcast(relays, event) {
  const pool = new SimplePool();

  console.log(`📡 Broadcasting to ${relays.length} relays...`);
  console.log(`   Event ID: ${event.id}`);
  console.log(`   Kind: ${event.kind} (NIP-23 Long-form Content)`);
  console.log('');

  const results = [];

  try {
    const publishPromises = relays.map(async (relay) => {
      try {
        await Promise.race([
          pool.publish([relay], event),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 15000)
          ),
        ]);
        console.log(`   [Nostr] OK ${relay}`);
        return { relay, success: true };
      } catch (err) {
        console.log(`   [Nostr] FAIL ${relay}: ${err.message}`);
        return { relay, success: false, error: err.message };
      }
    });

    results.push(...await Promise.all(publishPromises));
  } finally {
    pool.close(relays);
  }

  const successes = results.filter(r => r.success).length;
  const failures = results.filter(r => !r.success).length;

  console.log('');
  console.log(`[Nostr] Broadcast complete: ${successes} success, ${failures} failed`);

  return { successes, failures, results };
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  Genesis Vault — Nostr NIP-23 Broadcaster          ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');

  // Validate environment
  if (!NOSTR_PRIVATE_KEY) {
    console.warn('[Nostr] SKIP: NOSTR_PRIVATE_KEY not set');
    console.warn('[Nostr] To enable, add NOSTR_PRIVATE_KEY to GitHub Secrets');
    console.warn('[Nostr] Generate with: node -e "const{generateSecretKey,getPublicKey}=require(\"nostr-tools\");const sk=generateSecretKey();console.log(\"PK:\",Buffer.from(sk).toString(\"hex\"));console.log(\"Pub:\",getPublicKey(sk))"');
    return;
  }

  // Validate private key format (64 hex chars)
  if (!/^[0-9a-fA-F]{64}$/.test(NOSTR_PRIVATE_KEY)) {
    console.error(`[Nostr] ERROR: NOSTR_PRIVATE_KEY must be 64 hex characters (got ${NOSTR_PRIVATE_KEY.length} chars)`);
    console.error('[Nostr] Make sure you set the hex format, not nsec format');
    process.exit(1);
  }

  // Get the markdown file to broadcast
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('[Nostr] ERROR: No markdown file specified');
    console.error('Usage: node scripts/nostr-broadcast.mjs <markdown-filepath>');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  let content;
  try {
    content = await fs.readFile(absPath, 'utf-8');
  } catch {
    console.error(`[Nostr] ERROR: Cannot read file: ${absPath}`);
    process.exit(1);
  }

  // Parse the markdown
  const { metadata, body } = parseFrontmatter(content);
  console.log(`📄 File: ${path.basename(absPath)}`);
  console.log(`📝 Title: ${metadata.title || '(no title)'}`);
  console.log(`📅 Date: ${metadata.date || '(no date)'}`);
  console.log(`🏷️  Tags: ${(metadata.tags || []).join(', ') || '(none)'}`);
  console.log(`📏 Body: ${body.length} chars`);
  console.log('');

  // Build and broadcast event
  const privkey = NOSTR_PRIVATE_KEY;
  const event = buildNIP23Event(privkey, metadata, body);
  const relays = getRelays();
  const result = await broadcast(relays, event);

  // Output npub for reference
  try {
    const { getPublicKey } = await import('nostr-tools/pure');
    const npub = getPublicKey(privkey);
    console.log(`[Nostr] Public key (hex): ${npub}`);
  } catch {
    // Ignore
  }

  console.log('');
  console.log('Broadcast to Nostr: success');
}

main().catch(err => {
  console.error('[Nostr] Fatal error:', err.message);
  process.exit(1);
});
