import { randomUUID } from 'crypto';

export type EscrowStatus = 'created' | 'funded' | 'released' | 'refunded' | 'disputed' | 'expired';

export interface EscrowAgreement {
  id: string;
  payerWallet: string;
  payeeWallet: string;
  amount: number;
  currency: string;
  status: EscrowStatus;
  serviceType: string;
  description: string;
  policyCheckPassed: boolean;
  policyDetails?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  fundedAt?: string;
  releasedAt?: string;
  refundedAt?: string;
  expiresAt: string;
  transactionHash?: string;
  metadata?: Record<string, unknown>;
}

export interface EscrowCreateParams {
  payerWallet: string;
  payeeWallet: string;
  amount: number;
  currency?: string;
  serviceType: string;
  description: string;
  policyCheckPassed: boolean;
  policyDetails?: Record<string, unknown>;
  ttlMinutes?: number;
  metadata?: Record<string, unknown>;
}

export interface EscrowSettlement {
  escrowId: string;
  status: 'settled' | 'refunded';
  amount: number;
  currency: string;
  payerWallet: string;
  payeeWallet: string;
  settledAt: string;
  transactionHash?: string;
}

/**
 * In-memory escrow facilitator for agentic payment settlement.
 * In production this would interact with on-chain smart contracts
 * or a custodial settlement layer. For the demo it tracks state
 * in memory and simulates the full lifecycle.
 */
export class EscrowService {
  private escrows: Map<string, EscrowAgreement> = new Map();
  private settlements: EscrowSettlement[] = [];

  async createEscrow(params: EscrowCreateParams): Promise<EscrowAgreement> {
    if (!params.policyCheckPassed) {
      throw new Error('Cannot create escrow: policy check failed');
    }

    const id = `esc_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();
    const ttl = params.ttlMinutes ?? 60;
    const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();

    const escrow: EscrowAgreement = {
      id,
      payerWallet: params.payerWallet,
      payeeWallet: params.payeeWallet,
      amount: params.amount,
      currency: params.currency || 'USDC',
      status: 'created',
      serviceType: params.serviceType,
      description: params.description,
      policyCheckPassed: params.policyCheckPassed,
      policyDetails: params.policyDetails,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      metadata: params.metadata,
    };

    this.escrows.set(id, escrow);
    console.log(`[Escrow] Created ${id}: $${params.amount} ${escrow.currency} (${params.serviceType})`);
    return escrow;
  }

  async fundEscrow(escrowId: string, transactionHash?: string): Promise<EscrowAgreement> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new Error(`Escrow ${escrowId} not found`);
    if (escrow.status !== 'created') throw new Error(`Escrow ${escrowId} cannot be funded (status: ${escrow.status})`);
    if (new Date(escrow.expiresAt) < new Date()) {
      escrow.status = 'expired';
      escrow.updatedAt = new Date().toISOString();
      throw new Error(`Escrow ${escrowId} has expired`);
    }

    escrow.status = 'funded';
    escrow.fundedAt = new Date().toISOString();
    escrow.updatedAt = escrow.fundedAt;
    if (transactionHash) escrow.transactionHash = transactionHash;

    console.log(`[Escrow] Funded ${escrowId}: $${escrow.amount} ${escrow.currency}`);
    return escrow;
  }

  async releaseEscrow(escrowId: string): Promise<EscrowSettlement> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new Error(`Escrow ${escrowId} not found`);
    if (escrow.status !== 'funded') throw new Error(`Escrow ${escrowId} cannot be released (status: ${escrow.status})`);

    escrow.status = 'released';
    escrow.releasedAt = new Date().toISOString();
    escrow.updatedAt = escrow.releasedAt;

    const settlement: EscrowSettlement = {
      escrowId,
      status: 'settled',
      amount: escrow.amount,
      currency: escrow.currency,
      payerWallet: escrow.payerWallet,
      payeeWallet: escrow.payeeWallet,
      settledAt: escrow.releasedAt,
      transactionHash: escrow.transactionHash,
    };

    this.settlements.push(settlement);
    console.log(`[Escrow] Released ${escrowId}: $${escrow.amount} ${escrow.currency} -> ${escrow.payeeWallet}`);
    return settlement;
  }

  async refundEscrow(escrowId: string, reason?: string): Promise<EscrowSettlement> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new Error(`Escrow ${escrowId} not found`);
    if (!['created', 'funded'].includes(escrow.status)) {
      throw new Error(`Escrow ${escrowId} cannot be refunded (status: ${escrow.status})`);
    }

    escrow.status = 'refunded';
    escrow.refundedAt = new Date().toISOString();
    escrow.updatedAt = escrow.refundedAt;

    const settlement: EscrowSettlement = {
      escrowId,
      status: 'refunded',
      amount: escrow.amount,
      currency: escrow.currency,
      payerWallet: escrow.payerWallet,
      payeeWallet: escrow.payeeWallet,
      settledAt: escrow.refundedAt,
      transactionHash: escrow.transactionHash,
    };

    this.settlements.push(settlement);
    console.log(`[Escrow] Refunded ${escrowId}: $${escrow.amount} ${escrow.currency} (reason: ${reason || 'none'})`);
    return settlement;
  }

  async getEscrow(escrowId: string): Promise<EscrowAgreement | null> {
    return this.escrows.get(escrowId) || null;
  }

  async listEscrows(filters?: {
    status?: EscrowStatus;
    payerWallet?: string;
    payeeWallet?: string;
    limit?: number;
  }): Promise<EscrowAgreement[]> {
    let results = Array.from(this.escrows.values());

    if (filters?.status) {
      results = results.filter(e => e.status === filters.status);
    }
    if (filters?.payerWallet) {
      results = results.filter(e => e.payerWallet === filters.payerWallet);
    }
    if (filters?.payeeWallet) {
      results = results.filter(e => e.payeeWallet === filters.payeeWallet);
    }

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return results.slice(0, filters?.limit || 50);
  }

  async getSettlementHistory(limit: number = 50): Promise<EscrowSettlement[]> {
    return this.settlements.slice(-limit).reverse();
  }

  async getEscrowStats(): Promise<{
    total: number;
    byStatus: Record<EscrowStatus, number>;
    totalVolume: number;
    settledVolume: number;
    refundedVolume: number;
  }> {
    const all = Array.from(this.escrows.values());
    const byStatus: Record<string, number> = {};
    let totalVolume = 0;
    let settledVolume = 0;
    let refundedVolume = 0;

    for (const e of all) {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      totalVolume += e.amount;
      if (e.status === 'released') settledVolume += e.amount;
      if (e.status === 'refunded') refundedVolume += e.amount;
    }

    return {
      total: all.length,
      byStatus: byStatus as Record<EscrowStatus, number>,
      totalVolume,
      settledVolume,
      refundedVolume,
    };
  }
}
