import { prisma } from './support.js';
import { printStaffCredentials, seed } from './steps.js';

const main = async (): Promise<void> => {
  try {
    process.stdout.write('Seeding Smart Home foundation data\n');
    await seed();
    printStaffCredentials();
  } finally {
    await prisma.$disconnect();
  }
};

void main();
