import * as dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config();

const sessionId = process.argv[2];

if (!sessionId) {
  console.error('❌ Usage: tsx check-stripe-session.ts <session_id>');
  process.exit(1);
}

async function checkSession() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  
  if (!stripeKey) {
    console.error('❌ No STRIPE_SECRET_KEY found');
    process.exit(1);
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2025-02-24.acacia',
  });

  try {
    console.log(`🔍 Retrieving session: ${sessionId}\n`);
    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    console.log('✅ Session found!');
    console.log('   ID:', session.id);
    console.log('   Status:', session.status);
    console.log('   Payment Status:', session.payment_status);
    console.log('   Amount:', session.amount_total ? (session.amount_total / 100) : 0);
    console.log('   Currency:', session.currency);
    console.log('   Created:', new Date(session.created * 1000).toISOString());
    console.log('   Expires:', session.expires_at ? new Date(session.expires_at * 1000).toISOString() : 'N/A');
    console.log('   URL:', session.url);
    console.log('   Success URL:', session.success_url);
    console.log('   Cancel URL:', session.cancel_url);
    console.log('   Metadata:', session.metadata);
    
  } catch (error: any) {
    console.error('\n❌ Error retrieving session:');
    console.error('   Message:', error.message);
    console.error('   Type:', error.type);
    console.error('   Code:', error.code);
    
    if (error.code === 'resource_missing') {
      console.error('\n💡 This session does not exist in your Stripe account.');
      console.error('   Possible reasons:');
      console.error('   1. Session was created with a different Stripe API key');
      console.error('   2. Session ID is incorrect');
      console.error('   3. Session was created in a different Stripe account');
    }
  }
}

checkSession();
