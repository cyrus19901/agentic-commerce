use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Invalid amount: must be greater than zero")]
    InvalidAmount,

    #[msg("Invalid expiry: must be in the future")]
    InvalidExpiry,

    #[msg("Escrow has expired")]
    Expired,

    #[msg("Invalid escrow status for this operation")]
    InvalidStatus,

    #[msg("Unauthorized: signer is not the expected payer")]
    UnauthorizedPayer,

    #[msg("Unauthorized: signer is not the platform authority")]
    UnauthorizedAuthority,

    #[msg("Unauthorized: only payer, authority, or expired escrow can be cancelled")]
    UnauthorizedCancel,
}
