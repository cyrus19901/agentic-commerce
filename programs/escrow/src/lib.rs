use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("5k5ZZHiar9aheemskLMc54Jx5niwKLmKMNySunsCyj9F");

pub mod state;
pub mod errors;

use state::*;
use errors::*;

#[program]
pub mod agentic_escrow {
    use super::*;

    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        amount: u64,
        expires_at: i64,
        nonce: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);

        let clock = Clock::get()?;
        require!(
            expires_at > clock.unix_timestamp,
            EscrowError::InvalidExpiry
        );

        let escrow = &mut ctx.accounts.escrow;
        escrow.payer = ctx.accounts.payer.key();
        escrow.payee = ctx.accounts.payee.key();
        escrow.authority = ctx.accounts.authority.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.escrow_token_account = ctx.accounts.escrow_token_account.key();
        escrow.status = EscrowStatus::Created;
        escrow.created_at = clock.unix_timestamp;
        escrow.expires_at = expires_at;
        escrow.funded_at = 0;
        escrow.settled_at = 0;
        escrow.deposit_signature = [0u8; 64];
        escrow.settle_signature = [0u8; 64];
        escrow.nonce = nonce;
        escrow.bump = ctx.bumps.escrow;

        emit!(EscrowCreated {
            escrow: escrow.key(),
            payer: escrow.payer,
            payee: escrow.payee,
            amount,
            mint: escrow.mint,
            expires_at,
        });

        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Created,
            EscrowError::InvalidStatus
        );

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < escrow.expires_at,
            EscrowError::Expired
        );

        require!(
            ctx.accounts.payer.key() == escrow.payer,
            EscrowError::UnauthorizedPayer
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            escrow.amount,
        )?;

        escrow.status = EscrowStatus::Funded;
        escrow.funded_at = clock.unix_timestamp;

        emit!(EscrowFunded {
            escrow: escrow.key(),
            payer: escrow.payer,
            amount: escrow.amount,
            funded_at: escrow.funded_at,
        });

        Ok(())
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Funded,
            EscrowError::InvalidStatus
        );

        require!(
            ctx.accounts.authority.key() == escrow.authority,
            EscrowError::UnauthorizedAuthority
        );

        let payer_key = escrow.payer;
        let nonce = escrow.nonce;
        let bump = escrow.bump;
        let seeds = &[
            b"escrow".as_ref(),
            payer_key.as_ref(),
            nonce.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.payee_token_account.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                signer_seeds,
            ),
            escrow.amount,
        )?;

        let clock = Clock::get()?;
        escrow.status = EscrowStatus::Released;
        escrow.settled_at = clock.unix_timestamp;

        emit!(EscrowReleased {
            escrow: escrow.key(),
            payee: escrow.payee,
            amount: escrow.amount,
            settled_at: escrow.settled_at,
        });

        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Funded
                || escrow.status == EscrowStatus::Created,
            EscrowError::InvalidStatus
        );

        require!(
            ctx.accounts.authority.key() == escrow.authority,
            EscrowError::UnauthorizedAuthority
        );

        if escrow.status == EscrowStatus::Funded {
            let payer_key = escrow.payer;
            let nonce = escrow.nonce;
            let bump = escrow.bump;
            let seeds = &[
                b"escrow".as_ref(),
                payer_key.as_ref(),
                nonce.as_ref(),
                &[bump],
            ];
            let signer_seeds = &[&seeds[..]];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.payer_token_account.to_account_info(),
                        authority: escrow.to_account_info(),
                    },
                    signer_seeds,
                ),
                escrow.amount,
            )?;
        }

        let clock = Clock::get()?;
        escrow.status = EscrowStatus::Refunded;
        escrow.settled_at = clock.unix_timestamp;

        emit!(EscrowRefunded {
            escrow: escrow.key(),
            payer: escrow.payer,
            amount: escrow.amount,
            settled_at: escrow.settled_at,
        });

        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        let is_payer = ctx.accounts.signer.key() == escrow.payer;
        let is_authority = ctx.accounts.signer.key() == escrow.authority;
        let is_expired = clock.unix_timestamp >= escrow.expires_at;

        require!(
            escrow.status == EscrowStatus::Created,
            EscrowError::InvalidStatus
        );

        require!(
            is_payer || is_authority || is_expired,
            EscrowError::UnauthorizedCancel
        );

        escrow.status = EscrowStatus::Cancelled;
        escrow.settled_at = clock.unix_timestamp;

        emit!(EscrowCancelled {
            escrow: escrow.key(),
            cancelled_by: ctx.accounts.signer.key(),
            settled_at: escrow.settled_at,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, expires_at: i64, nonce: [u8; 32])]
pub struct InitializeEscrow<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + EscrowAccount::INIT_SPACE,
        seeds = [b"escrow", payer.key().as_ref(), nonce.as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        init,
        payer = payer,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: payee is just stored, not signing
    pub payee: UncheckedAccount<'info>,

    /// CHECK: authority is just stored, not signing at init
    pub authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.payer.as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        constraint = escrow_token_account.key() == escrow.escrow_token_account
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = payer_token_account.mint == escrow.mint,
        constraint = payer_token_account.owner == payer.key(),
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.payer.as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        constraint = escrow_token_account.key() == escrow.escrow_token_account
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = payee_token_account.mint == escrow.mint,
        constraint = payee_token_account.owner == escrow.payee,
    )]
    pub payee_token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.payer.as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        constraint = escrow_token_account.key() == escrow.escrow_token_account
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = payer_token_account.mint == escrow.mint,
        constraint = payer_token_account.owner == escrow.payer,
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.payer.as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    pub signer: Signer<'info>,
}

// Events
#[event]
pub struct EscrowCreated {
    pub escrow: Pubkey,
    pub payer: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
    pub mint: Pubkey,
    pub expires_at: i64,
}

#[event]
pub struct EscrowFunded {
    pub escrow: Pubkey,
    pub payer: Pubkey,
    pub amount: u64,
    pub funded_at: i64,
}

#[event]
pub struct EscrowReleased {
    pub escrow: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
    pub settled_at: i64,
}

#[event]
pub struct EscrowRefunded {
    pub escrow: Pubkey,
    pub payer: Pubkey,
    pub amount: u64,
    pub settled_at: i64,
}

#[event]
pub struct EscrowCancelled {
    pub escrow: Pubkey,
    pub cancelled_by: Pubkey,
    pub settled_at: i64,
}
