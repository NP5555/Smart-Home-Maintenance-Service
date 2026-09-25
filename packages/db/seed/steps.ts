import { execute, json, literal, type SeedStep } from './support.js';
import { seedBreachTypes } from './breachTypes.js';
import { seedCatalogue } from './catalogue.js';
import { seedNotificationTemplates } from './notificationTemplates.js';
import { seedPlaces } from './places.js';
import { seedRolesAndPermissions } from './roles.js';
import { developmentStaffPassword, seedStaff, staffAccounts } from './staff.js';
import { settingsDefinitions } from './settings.js';

const seedSettings = async (): Promise<void> => {
  for (const definition of settingsDefinitions) {
    await execute(
      `INSERT INTO settings(key, value, description)
       VALUES (${literal(definition.key)}, ${json(definition.value)}, ${literal(definition.description)})
       ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`
    );
  }
};

const steps: readonly SeedStep[] = [
  { name: 'places (Lahore and its areas)', run: seedPlaces },
  { name: 'catalogue (categories, services, checklists)', run: seedCatalogue },
  { name: 'roles and permissions', run: seedRolesAndPermissions },
  { name: 'staff users and global commission', run: seedStaff },
  { name: 'settings defaults', run: seedSettings },
  { name: 'breach types', run: seedBreachTypes },
  { name: 'notification templates (en and ur)', run: seedNotificationTemplates }
];

export const seed = async (): Promise<void> => {
  for (const step of steps) {
    await step.run();
    process.stdout.write(`  seeded ${step.name}\n`);
  }
};

export const printStaffCredentials = (): void => {
  process.stdout.write('\nDevelopment staff accounts (the same password for every account):\n');
  for (const account of staffAccounts) {
    process.stdout.write(`  ${account.role.padEnd(7)} ${account.email}  password: ${developmentStaffPassword}\n`);
  }
  process.stdout.write('\n');
};
