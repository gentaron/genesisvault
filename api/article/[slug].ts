import type { VercelRequest, VercelResponse } from '@vercel/node';
import fs from 'fs/promises';
import path from 'path';
import { hmacVerify, isAllowedWallet } from '../_lib/paywall';

const POSTS_DIR = path.join(process.cwd(), 'src/content/posts');

function extractMarkdownBody(raw: string): string {
  const fmEnd = raw.indexOf('---', raw.indexOf('---') + 3);
  if (fmEnd === -1) return raw;
  return raw.substring(fmEnd + 3).trim();
}

function simpleMarkdownToHtml(md: string): string {
  let html = md;
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\n\n+/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[23]>)/g, '$1');
  html = html.replace(/(<\/h[23]>)<\/p>/g, '$1');
  html = html.replace(/\n/g, '<br>');
  return html;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.query;
  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ error: 'Missing slug' });
  }

  try {
    const files = await fs.readdir(POSTS_DIR);
    const postFile = files.find(f => f.replace(/\.md$/, '') === slug || f.includes(slug));
    if (!postFile) {
      return res.status(404).send('Not found');
    }

    // Check if this is a free post (newest 2)
    const sortedFiles = files.filter(f => f.endsWith('.md')).sort().reverse();
    const postIndex = sortedFiles.indexOf(postFile);
    const isFree = postIndex >= 0 && postIndex < 2;

    if (isFree) {
      const raw = await fs.readFile(path.join(POSTS_DIR, postFile), 'utf-8');
      const body = extractMarkdownBody(raw);
      const html = simpleMarkdownToHtml(body);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(html);
    }

    // Gated posts: verify access
    // Accept either: (1) valid HMAC cookie with owner wallet, or
    //                 (2) X-Owner-Wallet header matching the owner address
    const ownerHeader = (req.headers['x-owner-wallet'] as string | undefined) || '';
    const verification = hmacVerify(req.headers.cookie);
    const wallet = verification.valid ? (verification.wallet || '') : '';
    const authenticatedWallet = isAllowedWallet(wallet) ? wallet : (isAllowedWallet(ownerHeader) ? ownerHeader : '');

    if (!authenticatedWallet) {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('WWW-Authenticate', 'X-Payment realm="USDC" price="3" chain="ethereum"');
      return res.status(402).send('Payment required');
    }

    const raw = await fs.readFile(path.join(POSTS_DIR, postFile), 'utf-8');
    const body = extractMarkdownBody(raw);
    const html = simpleMarkdownToHtml(body);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).send(html);
  } catch (err) {
    console.error('Article endpoint error:', err);
    return res.status(500).json({ error: 'Failed to load article' });
  }
}
