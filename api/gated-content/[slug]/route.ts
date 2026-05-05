import type { VercelRequest, VercelResponse } from '@vercel/node';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const HMAC_SECRET = process.env.PAYWALL_SECRET || 'genesis-vault-hmac-secret-change-me';

function verifyCookie(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const match = cookie.match(/gv_token=([^;]+)/);
  if (!match) return false;
  const parts = match[1].split('.');
  if (parts.length !== 2) return false;
  const [token, sig] = parts;
  if (!token || !sig) return false;

  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(token).digest('base64url');
  if (sig !== expected) return false;

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString());
    return payload.paid === true && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.query;
  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ error: 'Missing slug' });
  }

  const isPaid = verifyCookie(req.headers.cookie);

  // Count posts to determine free limit
  try {
    const postsDir = path.join(process.cwd(), 'src/content/posts');
    const files = (await fs.readdir(postsDir))
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();

    const postIndex = files.findIndex(f => f.includes(slug));
    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const FREE_LIMIT = 2;
    const isLocked = !isPaid && postIndex >= FREE_LIMIT;

    return res.status(200).json({
      slug,
      postIndex,
      isPaid,
      isLocked,
      freeLimit: FREE_LIMIT,
    });
  } catch (err) {
    console.error('Gated content error:', err);
    return res.status(500).json({ error: 'Failed to check content access' });
  }
}
