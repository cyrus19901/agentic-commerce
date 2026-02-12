#!/bin/bash
# Setup script for E2E testing with real Solana devnet

echo "🔧 Setting up Solana devnet for E2E testing..."
echo ""

# Check if Solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo "❌ Solana CLI not found!"
    echo "Install it with: sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
    exit 1
fi

echo "✅ Solana CLI found: $(solana --version)"
echo ""

# Set cluster to devnet
echo "🌐 Setting cluster to devnet..."
solana config set --url https://api.devnet.solana.com
echo ""

# Create new keypair for testing (or use existing)
if [ ! -f ~/.config/solana/test-keypair.json ]; then
    echo "🔑 Generating new test keypair..."
    solana-keygen new --outfile ~/.config/solana/test-keypair.json --no-bip39-passphrase
else
    echo "✅ Using existing test keypair"
fi

PUBKEY=$(solana-keygen pubkey ~/.config/solana/test-keypair.json)
echo "  Public key: $PUBKEY"
echo ""

# Request airdrop
echo "💰 Requesting SOL airdrop..."
solana airdrop 2 $PUBKEY --url devnet
echo ""

# Check balance
echo "💵 Checking balance..."
solana balance $PUBKEY --url devnet
echo ""

# Setup USDC devnet tokens
echo "🪙 USDC Devnet Mint: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
echo ""
echo "📝 To get USDC devnet tokens:"
echo "   1. Go to https://spl-token-faucet.com/?token-name=USDC-Dev"
echo "   2. Or use: spl-token create-account Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
echo "   3. Then: spl-token mint Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr 100"
echo ""

echo "✅ Devnet setup complete!"
echo ""
echo "🧪 Run E2E test with:"
echo "   npm run test:e2e:real"
echo ""
