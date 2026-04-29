/**
 * Genesis Vault — IPFS Archiver via Pinata Free Tier
 *
 * 記事のMarkdownファイルをIPFSにpinし、分散アーカイブを実現する。
 * Pinata API (free tier: 1GB) を使用。
 *
 * Usage:
 *   node scripts/ipfs-archive.mjs <markdown-filepath>
 *
 * Required env:
 *   PINATA_JWT — Pinata API のJWTトークン
 *
 * Cost: FREE (Pinata free tier = 1GB)
 *   73 articles x ~8KB = ~600KB → well within free tier
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Config ──────────────────────────────────────────────────────
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_API_BASE = 'https://api.pinata.cloud';

// ─── Pinata API: Pin file to IPFS ────────────────────────────────
async function pinToPinata(filename, content) {
  const url = `${PINATA_API_BASE}/pinning/pinFileToIPFS`;

  // Build FormData
  const formData = new FormData();
  const blob = new Blob([content], { type: 'text/markdown' });
  formData.append('file', blob, filename);

  // Add metadata
  const metadata = {
    name: `genesis-vault-${filename}`,
    keyvalues: {
      source: 'genesis-vault',
      type: 'blog-post',
      date: new Date().toISOString().split('T')[0],
    },
  };
  formData.append('pinataMetadata', JSON.stringify(metadata));

  // Add options
  const options = {
    cidVersion: 1,
  };
  formData.append('pinataOptions', JSON.stringify(options));

  console.log(`[IPFS] Uploading ${filename} to Pinata...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PINATA_JWT}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Pinata API error (${res.status}): ${errText}`);
  }

  const json = await res.json();
  return json;
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  Genesis Vault — IPFS Archiver (Pinata Free Tier)  ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');

  // Validate environment
  if (!PINATA_JWT) {
    console.warn('[IPFS] SKIP: PINATA_JWT not set');
    console.warn('[IPFS] To enable, add PINATA_JWT to GitHub Secrets');
    console.warn('[IPFS] Get your JWT from: https://app.pinata.cloud → API Keys');
    return;
  }

  // Get the markdown file to archive
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('[IPFS] ERROR: No markdown file specified');
    console.error('Usage: node scripts/ipfs-archive.mjs <markdown-filepath>');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  let content;
  try {
    content = await fs.readFile(absPath, 'utf-8');
  } catch {
    console.error(`[IPFS] ERROR: Cannot read file: ${absPath}`);
    process.exit(1);
  }

  const filename = path.basename(absPath);
  console.log(`[IPFS] File: ${filename}`);
  console.log(`[IPFS] Size: ${Buffer.byteLength(content, 'utf-8')} bytes`);
  console.log('');

  try {
    const result = await pinToPinata(filename, content);

    const cid = result.IpfsHash;
    const pinSize = result.PinSize;
    const timestamp = result.Timestamp;

    console.log(`[IPFS] CID: ${cid}`);
    console.log(`[IPFS] PinSize: ${pinSize} bytes`);
    console.log(`[IPFS] Timestamp: ${timestamp}`);
    console.log(`[IPFS] Gateway URL: https://ipfs.io/ipfs/${cid}`);
    console.log(`[IPFS] Pinata URL: https://gateway.pinata.cloud/ipfs/${cid}`);
    console.log('');
    console.log('IPFS archive: success');

  } catch (err) {
    console.error(`[IPFS] ERROR: ${err.message}`);
    console.error('[IPFS] Check your PINATA_JWT and try again');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[IPFS] Fatal error:', err.message);
  process.exit(1);
});
