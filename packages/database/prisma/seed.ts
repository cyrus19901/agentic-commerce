import { PrismaClient, PolicyType, PeriodType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create default user
  const user = await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {},
    create: {
      id: 'user-123',
      email: 'user@example.com',
      name: 'Test User',
      role: 'USER',
      active: true,
    },
  });
  console.log('✅ Created user:', user.email);

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'ADMIN',
      active: true,
    },
  });
  console.log('✅ Created admin:', admin.email);

  // Create policies
  const monthlyBudgetPolicy = await prisma.policy.upsert({
    where: { id: 'policy-monthly-budget' },
    update: {},
    create: {
      id: 'policy-monthly-budget',
      name: 'Monthly Budget $1000',
      description: 'Maximum $1000 spending per month',
      type: PolicyType.BUDGET_LIMIT,
      active: true,
      priority: 100,
      amount: 1000,
      periodType: PeriodType.MONTHLY,
      merchants: [],
      categories: [],
      daysOfWeek: [],
    },
  });
  console.log('✅ Created policy:', monthlyBudgetPolicy.name);

  const transactionLimitPolicy = await prisma.policy.upsert({
    where: { id: 'policy-transaction-limit' },
    update: {},
    create: {
      id: 'policy-transaction-limit',
      name: 'Max $500 per Transaction',
      description: 'No single purchase over $500',
      type: PolicyType.TRANSACTION_LIMIT,
      active: true,
      priority: 90,
      amount: 500,
      merchants: [],
      categories: [],
      daysOfWeek: [],
    },
  });
  console.log('✅ Created policy:', transactionLimitPolicy.name);

  // Create category allowlist policy
  const categoryPolicy = await prisma.policy.upsert({
    where: { id: 'policy-category-allowlist' },
    update: {},
    create: {
      id: 'policy-category-allowlist',
      name: 'Approved Categories',
      description: 'Only allow purchases from approved categories',
      type: PolicyType.CATEGORY_ALLOWLIST,
      active: true,
      priority: 80,
      merchants: [],
      categories: [
        'Bags & Purses',
        'Office Supplies',
        'Paper & Party Supplies',
        'Office & Business',
        'Travel & Accessories',
      ],
      daysOfWeek: [],
    },
  });
  console.log('✅ Created policy:', categoryPolicy.name);

  // Assign policies to user
  await prisma.userPolicy.upsert({
    where: {
      userId_policyId: {
        userId: user.id,
        policyId: monthlyBudgetPolicy.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      policyId: monthlyBudgetPolicy.id,
      active: true,
    },
  });

  await prisma.userPolicy.upsert({
    where: {
      userId_policyId: {
        userId: user.id,
        policyId: transactionLimitPolicy.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      policyId: transactionLimitPolicy.id,
      active: true,
    },
  });

  await prisma.userPolicy.upsert({
    where: {
      userId_policyId: {
        userId: user.id,
        policyId: categoryPolicy.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      policyId: categoryPolicy.id,
      active: true,
    },
  });

  console.log('✅ Assigned policies to user');

  console.log('🎉 Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

