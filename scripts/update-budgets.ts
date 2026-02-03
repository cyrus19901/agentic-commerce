import { DB } from '../packages/database/src/index.js';

const db = new DB('./data/shopping.db');

async function updateBudgets() {
  console.log('Updating budget policies...\n');

  // Update Monthly Budget
  const monthlyPolicy = await db.getPolicyById('policy-1-monthly-budget');
  if (monthlyPolicy) {
    monthlyPolicy.name = 'Monthly Budget Limit - $5000';
    monthlyPolicy.rules = {
      ...monthlyPolicy.rules,
      maxAmount: 5000,
    };
    await db.updatePolicy(monthlyPolicy);
    console.log('✓ Updated: Monthly Budget Limit - $5000');
  } else {
    console.log('✗ Monthly budget policy not found');
  }

  // Update Daily Budget
  const dailyPolicy = await db.getPolicyById('policy-3-daily-budget');
  if (dailyPolicy) {
    dailyPolicy.name = 'Daily Spending Cap - $1000';
    dailyPolicy.rules = {
      ...dailyPolicy.rules,
      maxAmount: 1000,
    };
    await db.updatePolicy(dailyPolicy);
    console.log('✓ Updated: Daily Spending Cap - $1000');
  } else {
    console.log('✗ Daily budget policy not found');
  }

  // Update Weekly Budget
  const weeklyPolicy = await db.getPolicyById('policy-4-weekly-budget');
  if (weeklyPolicy) {
    weeklyPolicy.name = 'Weekly Spending Limit - $2500';
    weeklyPolicy.rules = {
      ...weeklyPolicy.rules,
      maxAmount: 2500,
    };
    await db.updatePolicy(weeklyPolicy);
    console.log('✓ Updated: Weekly Spending Limit - $2500');
  } else {
    console.log('✗ Weekly budget policy not found');
  }

  console.log('\n✅ Budget updates complete!');
  
  // Show updated policies
  console.log('\nUpdated budget policies:');
  const allPolicies = await db.getAllPolicies();
  const budgetPolicies = allPolicies.filter(p => p.type === 'budget');
  budgetPolicies.forEach(p => {
    console.log(`  - ${p.name}: $${p.rules.maxAmount} (${p.rules.period})`);
  });
}

updateBudgets().catch(console.error);
