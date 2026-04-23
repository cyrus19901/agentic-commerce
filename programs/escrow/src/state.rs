use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowStatus {
    Created,
    Funded,
    Released,
    Refunded,
    Cancelled,
    Expired,
}

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    pub payer: Pubkey,
    pub payee: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub escrow_token_account: Pubkey,
    pub status: EscrowStatus,
    pub created_at: i64,
    pub expires_at: i64,
    pub funded_at: i64,
    pub settled_at: i64,
    pub deposit_signature: [u8; 64],
    pub settle_signature: [u8; 64],
    pub nonce: [u8; 32],
    pub bump: u8,
}
