/**
 * Chain Configuration Registry
 *
 * Single source of truth for all EVM chain constants used across the platform:
 * middleware, demo signer, MCP server, agents, etc.
 *
 * Keyed by CAIP-2 identifier (e.g. "eip155:8453" for Base mainnet).
 */

export interface ChainConfig {
  name: string;
  caip2: string;
  chainId: number;
  usdcAddress: string;
  usdcName: string;
  usdcVersion: string;
  rpcUrl: string;
  explorerUrl: string;
  explorerTxPath: string;
}

export const CHAIN_REGISTRY: Record<string, ChainConfig> = {
  'eip155:8453': {
    name: 'Base',
    caip2: 'eip155:8453',
    chainId: 8453,
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcName: 'USD Coin',
    usdcVersion: '2',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    explorerTxPath: '/tx/',
  },
  'eip155:84532': {
    name: 'Base Sepolia',
    caip2: 'eip155:84532',
    chainId: 84532,
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcName: 'USDC',
    usdcVersion: '2',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    explorerTxPath: '/tx/',
  },
  'eip155:137': {
    name: 'Polygon',
    caip2: 'eip155:137',
    chainId: 137,
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    usdcName: 'USD Coin',
    usdcVersion: '2',
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    explorerTxPath: '/tx/',
  },
  'eip155:42161': {
    name: 'Arbitrum',
    caip2: 'eip155:42161',
    chainId: 42161,
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    usdcName: 'USD Coin',
    usdcVersion: '2',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    explorerTxPath: '/tx/',
  },
};

const SHORTNAME_MAP: Record<string, string> = {
  'base': 'eip155:8453',
  'base-mainnet': 'eip155:8453',
  'base-sepolia': 'eip155:84532',
  'polygon': 'eip155:137',
  'arbitrum': 'eip155:42161',
  'ethereum': 'eip155:1',
};

const CAIP2_TO_CDP: Record<string, string> = {
  'eip155:8453': 'base',
  'eip155:84532': 'base-sepolia',
  'eip155:137': 'polygon',
  'eip155:42161': 'arbitrum',
  'eip155:1': 'ethereum',
};

/** Convert a short network name to CAIP-2, or pass through if already CAIP-2 */
export function toCaip2(network: string): string {
  return SHORTNAME_MAP[network] || network;
}

/** Convert CAIP-2 to the short CDP network name expected by Coinbase facilitator */
export function toCdpNetwork(network: string): string {
  const caip2 = toCaip2(network);
  return CAIP2_TO_CDP[caip2] || network;
}

/** Get chain config by CAIP-2 or short name. Returns undefined if unsupported. */
export function getChainConfig(network: string): ChainConfig | undefined {
  return CHAIN_REGISTRY[toCaip2(network)];
}

/** List all supported CAIP-2 network IDs */
export function supportedNetworks(): string[] {
  return Object.keys(CHAIN_REGISTRY);
}

/** Build an explorer transaction URL */
export function explorerTxUrl(network: string, txHash: string): string | null {
  const chain = getChainConfig(network);
  if (!chain) return null;
  return `${chain.explorerUrl}${chain.explorerTxPath}${txHash}`;
}

/** Default network when none specified */
export const DEFAULT_NETWORK = 'eip155:8453';
