import { useState, useEffect } from 'react';
import WalletConnect, { isPaid } from './WalletConnect';

interface Post {
  slug: string;
  title: string;
  date: string;
  mood?: string;
  weather?: string;
  tags: string[];
  description?: string;
}

const FREE_POST_LIMIT = 2;

export default function PaywalledContent({ posts }: { posts: Post[] }) {
  const [paid, setPaid] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setPaid(isPaid());
  }, []);

  const visiblePosts = paid ? posts : posts.slice(0, FREE_POST_LIMIT);
  const lockedCount = paid ? 0 : Math.max(0, posts.length - FREE_POST_LIMIT);

  return (
    <div>
      {/* Wallet Connect + Payment */}
      <div className="gv-paywall-header">
        <WalletConnect onPaymentComplete={() => setPaid(true)} />
      </div>

      {/* Post grid */}
      <div className="grid gap-8">
        {visiblePosts.map((post) => (
          <article key={post.slug} className="card-hover">
            <a href={`/posts/${post.slug}`} className="block">
              <div className="post-meta">
                <time>{new Date(post.date).toLocaleDateString('ja-JP', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  weekday: 'short',
                })}</time>
                {post.mood && <span className="text-lg">{post.mood}</span>}
                {post.weather && <span className="text-lg">{post.weather}</span>}
              </div>
              <h2 className="post-title">{post.title}</h2>
              {post.description && (
                <p className="post-description">{post.description}</p>
              )}
              {post.tags.length > 0 && (
                <div className="tags">
                  {post.tags.map((tag) => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              )}
            </a>
          </article>
        ))}
      </div>

      {/* Locked overlay */}
      {mounted && !paid && lockedCount > 0 && (
        <div className="gv-locked-section">
          <div className="gv-locked-overlay">
            <div className="gv-locked-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <p className="gv-locked-text">
              残り <strong>{lockedCount}件</strong> の記事がロックされています
            </p>
            <p className="gv-locked-subtext">
              3 USDC で全コンテンツをアンロック
            </p>
          </div>
        </div>
      )}

      {posts.length === 0 && (
        <div className="text-center py-20">
          <p style={{ color: 'var(--color-gray-dark)' }}>まだ記事がありません</p>
        </div>
      )}
    </div>
  );
}
