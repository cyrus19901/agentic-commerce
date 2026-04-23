/* eslint-disable @typescript-eslint/no-var-requires */

export interface TxVerificationResult {
  verified: boolean;
  blockNumber?: number;
  gasUsed?: string;
  from?: string;
  to?: string;
  transferAmount?: string;
  transferTo?: string;
  error?: string;
}

const USDC_TRANSFER_EVENT_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class BaseTxVerifier {
  private publicClient: any = null;

  constructor() {
    try {
      const viem: any = require('viem');
      const viemChains: any = require('viem/chains');
      const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
      this.publicClient = viem.createPublicClient({
        chain: viemChains.base,
        transport: viem.http(rpcUrl),
      });
    } catch (err: any) {
      console.error('[BaseTxVerifier] Init error:', err.message);
    }
  }

  async verify(
    txHash: string,
    expected?: { from?: string; amount?: number; to?: string },
  ): Promise<TxVerificationResult> {
    if (!this.publicClient) {
      return { verified: false, error: 'Base public client not initialized' };
    }

    if (!txHash || !txHash.startsWith('0x')) {
      return { verified: false, error: 'Invalid transaction hash' };
    }

    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });

      if (!receipt) {
        return { verified: false, error: 'Transaction receipt not found' };
      }

      if (receipt.status !== 'success') {
        return {
          verified: false,
          blockNumber: Number(receipt.blockNumber),
          from: receipt.from,
          error: 'Transaction reverted on-chain',
        };
      }

      const result: TxVerificationResult = {
        verified: true,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed?.toString(),
        from: receipt.from,
        to: receipt.to,
      };

      const transferLog = receipt.logs?.find(
        (log: any) => log.topics?.[0] === USDC_TRANSFER_EVENT_SIG,
      );

      if (transferLog) {
        const fromAddr = '0x' + transferLog.topics[1].slice(26);
        const toAddr = '0x' + transferLog.topics[2].slice(26);
        const rawAmount = BigInt(transferLog.data);
        const usdcAmount = Number(rawAmount) / 1e6;

        result.transferAmount = usdcAmount.toFixed(6);
        result.transferTo = toAddr;

        if (expected?.from && fromAddr.toLowerCase() !== expected.from.toLowerCase()) {
          result.verified = false;
          result.error = `Sender mismatch: expected ${expected.from}, got ${fromAddr}`;
        }
        if (expected?.to && toAddr.toLowerCase() !== expected.to.toLowerCase()) {
          result.verified = false;
          result.error = `Recipient mismatch: expected ${expected.to}, got ${toAddr}`;
        }
        if (expected?.amount && Math.abs(usdcAmount - expected.amount) > 0.000001) {
          result.verified = false;
          result.error = `Amount mismatch: expected ${expected.amount}, got ${usdcAmount}`;
        }
      }

      return result;
    } catch (err: any) {
      return { verified: false, error: `Verification failed: ${err.message}` };
    }
  }
}
