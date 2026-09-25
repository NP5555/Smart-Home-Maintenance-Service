import { hash } from 'argon2';
import { execute, literal, single } from './support.js';

export const developmentStaffPassword = 'DevPassword!2026';

export type StaffSeed = { id: string; phone: string; email: string; firstName: string; lastName: string; role: 'ADMIN' | 'FINANCE' | 'AGENT' };

export const staffAccounts: readonly StaffSeed[] = [
  { id: '00000000-0000-4000-8000-000000000001', phone: '+923001000001', email: 'admin@smart-home.local', firstName: 'Ayesha', lastName: 'Khan', role: 'ADMIN' },
  { id: '00000000-0000-4000-8000-000000000002', phone: '+923001000002', email: 'finance@smart-home.local', firstName: 'Bilal', lastName: 'Ahmed', role: 'FINANCE' },
  { id: '00000000-0000-4000-8000-000000000003', phone: '+923001000003', email: 'agent1@smart-home.local', firstName: 'Sana', lastName: 'Iqbal', role: 'AGENT' },
  { id: '00000000-0000-4000-8000-000000000004', phone: '+923001000004', email: 'agent2@smart-home.local', firstName: 'Omar', lastName: 'Raza', role: 'AGENT' }
];

export const seedStaff = async (): Promise<void> => {
  const passwordHash = await hash(developmentStaffPassword, { type: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  for (const account of staffAccounts) {
    await execute(
      `INSERT INTO users(id, phone_e164, email, password_hash, first_name, last_name, email_verified_at, phone_verified_at, locale)
       VALUES (${literal(account.id)}::uuid, ${literal(account.phone)}, ${literal(account.email)}, ${literal(passwordHash)},
         ${literal(account.firstName)}, ${literal(account.lastName)}, now(), now(), 'en')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name`
    );
    await execute(`INSERT INTO user_roles(user_id, role_code) VALUES (${literal(account.id)}::uuid, ${literal(account.role)}) ON CONFLICT DO NOTHING`);
  }
  const admin = await single<{ id: string }>(`SELECT id FROM users WHERE id = '00000000-0000-4000-8000-000000000001'`);
  if (admin === null) throw new Error('Admin staff user was not created');
  await execute(
    `INSERT INTO commission_rules(scope, rate_bp, created_by)
     SELECT 'GLOBAL', 1500, ${literal(admin.id)}::uuid
     WHERE NOT EXISTS (SELECT 1 FROM commission_rules WHERE scope = 'GLOBAL' AND effective_to IS NULL)`
  );
};
