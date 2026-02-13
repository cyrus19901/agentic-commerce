#!/bin/bash

set -e

echo "🚀 Agentic Commerce - HTTPS Tunnel Setup"
echo ""
echo "Choose tunnel provider:"
echo "  1) Cloudflare (Free, no signup required)"
echo "  2) Ngrok (Free, requires account)"
echo ""
read -p "Enter choice (1 or 2): " choice

case $choice in
  1)
    echo ""
    echo "🌥️  Starting Cloudflare tunnel..."
    make tunnel
    echo ""
    echo "✅ Done! Your tunnel is running."
    echo ""
    echo "To get your URL anytime, run:"
    echo "  make tunnel-url"
    ;;
  2)
    if [ -z "$NGROK_AUTHTOKEN" ]; then
      echo ""
      echo "⚠️  Ngrok requires authentication."
      echo ""
      echo "1. Sign up at: https://dashboard.ngrok.com/signup"
      echo "2. Get your token: https://dashboard.ngrok.com/get-started/your-authtoken"
      echo "3. Run: export NGROK_AUTHTOKEN=your_token_here"
      echo "4. Re-run this script"
      exit 1
    fi
    
    echo ""
    echo "🚇 Starting ngrok tunnel..."
    make ngrok
    echo ""
    echo "✅ Done! Your tunnel is running."
    echo ""
    echo "🌐 Ngrok Dashboard: http://localhost:4040"
    echo ""
    echo "To get your URL anytime, run:"
    echo "  make ngrok-url"
    ;;
  *)
    echo "Invalid choice. Please run again and select 1 or 2."
    exit 1
    ;;
esac

echo ""
echo "📋 Next Steps:"
echo "  1. Copy your HTTPS URL"
echo "  2. Open ChatGPT GPT editor"
echo "  3. Update the server URL in Actions"
echo "  4. Test both flows (shopping and services)!"
