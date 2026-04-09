import { useState, useEffect } from 'react';
import WalletConnect, { isPaid } from './WalletConnect';

interface Props {
  postIndex: number; // 0-based index of this post in the sorted list
  children: React.ReactNode;
}

const FREE_POST_LIMIT = 2;

export default function PostPaywall({ postIndex, children }: Props) {
  const [paid, setPaid] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setPaid(isPaid());
  }, []);

  // SSR: show content (SEO-friendly); client-side: gate it
  const isFree = postIndex < FREE_POST_LIMIT;
  const hasAccess = !mounted || paid || isFree;

  if (hasAccess) {
    return <>{children}</>;
  }

  return (
    <div className="gv-post-paywall">
      <div className="gv-post-paywall-blur">
        {children}
      </div>
      <div className="gv-post-paywall-gate">
        <div className="gv-locked-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h3 className="gv-gate-title">この記事はプレミアムコンテンツです</h3>
        <p className="gv-gate-description">
          3 USDC で全ての記事にアクセスできます
        </p>
        <WalletConnect onPaymentComplete={() => setPaid(true)} />
      </div>
    </div>
  );
}
