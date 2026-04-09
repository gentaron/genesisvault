import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { useState, useEffect, useCallback } from 'react';

// --- Config ---
const PRIVY_APP_ID = import.meta.env.PUBLIC_PRIVY_APP_ID || 'INSERT_PRIVY_APP_ID';
const ETH_RECEIVE_ADDRESS = '0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c';
const USDC_AMOUNT = 3;
const ETH_USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const STORAGE_KEY = 'gv_paid_status';

export function isPaid(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return data.paid === true;
  } catch {
    return false;
  }
}

function markPaid(wallet: string, txHash: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    paid: true,
    wallet,
    chain: 'ethereum',
    txHash,
    timestamp: Date.now(),
  }));
}

// --- Inner component (uses Privy hooks) ---
function WalletInner({ onPaymentComplete }: { onPaymentComplete?: () => void }) {
  const { login, logout, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPaid(isPaid());
  }, []);

  const handlePay = useCallback(async () => {
    setError(null);
    setPaying(true);
    try {
      const ethWallet = wallets[0];
      if (!ethWallet) {
        setError('ウォレットが見つかりません。');
        setPaying(false);
        return;
      }

      const provider = await ethWallet.getEthereumProvider();

      // USDC transfer via ERC-20 transfer(address,uint256)
      const amount = USDC_AMOUNT * 1_000_000; // 6 decimals
      const amountHex = amount.toString(16).padStart(64, '0');
      const toHex = ETH_RECEIVE_ADDRESS.slice(2).padStart(64, '0');
      // transfer(address,uint256) selector = 0xa9059cbb
      const data = `0xa9059cbb${toHex}${amountHex}`;

      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: ethWallet.address,
          to: ETH_USDC_CONTRACT,
          data,
        }],
      });

      markPaid(ethWallet.address, txHash as string);
      setPaid(true);
      onPaymentComplete?.();
    } catch (err: any) {
      setError(err.message || '送金に失敗しました');
    } finally {
      setPaying(false);
    }
  }, [wallets, onPaymentComplete]);

  if (paid) {
    return (
      <div className="gv-wallet-status gv-wallet-paid">
        <span>&#10003; 全コンテンツアクセス済み</span>
        {authenticated && (
          <button onClick={logout} className="gv-btn-small">
            Disconnect
          </button>
        )}
      </div>
    );
  }

  if (!authenticated) {
    return (
      <button onClick={login} className="gv-btn-connect">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M22 10H18C16.9 10 16 10.9 16 12C16 13.1 16.9 14 18 14H22" />
        </svg>
        Wallet Connect
      </button>
    );
  }

  return (
    <div className="gv-wallet-panel">
      <div className="gv-wallet-info">
        <span className="gv-wallet-addr">
          {user?.wallet?.address?.slice(0, 6)}...{user?.wallet?.address?.slice(-4)}
        </span>
        <button onClick={logout} className="gv-btn-small">Disconnect</button>
      </div>

      <button
        onClick={handlePay}
        className="gv-btn-pay"
        disabled={paying}
      >
        {paying ? '処理中...' : `${USDC_AMOUNT} USDC で全コンテンツをアンロック`}
      </button>

      {error && <p className="gv-error">{error}</p>}
    </div>
  );
}

// --- Exported wrapper with PrivyProvider (client-only) ---
export default function WalletConnect({ onPaymentComplete }: { onPaymentComplete?: () => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button className="gv-btn-connect" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M22 10H18C16.9 10 16 10.9 16 12C16 13.1 16.9 14 18 14H22" />
        </svg>
        Wallet Connect
      </button>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#A8C5A3',
        },
        loginMethods: ['wallet'],
      }}
    >
      <WalletInner onPaymentComplete={onPaymentComplete} />
    </PrivyProvider>
  );
}
