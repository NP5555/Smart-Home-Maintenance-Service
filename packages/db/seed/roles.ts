import { execute, literal } from './support.js';

export const staffRoleCodes = ['ADMIN', 'FINANCE', 'AGENT'] as const;
export const allRoleCodes = ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN'] as const;

const permissions: readonly { code: string; description: string; roles: readonly string[] }[] = [
  { code: 'profile.read.own', description: 'Read own profile', roles: ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN'] },
  { code: 'profile.write.own', description: 'Update own profile', roles: ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN'] },
  { code: 'booking.create', description: 'Create a booking', roles: ['CUSTOMER'] },
  { code: 'booking.cancel.own', description: 'Cancel own booking', roles: ['CUSTOMER'] },
  { code: 'booking.accept_offer', description: 'Accept or decline a job offer', roles: ['PROVIDER'] },
  { code: 'booking.execute', description: 'Record execution evidence and complete a job', roles: ['PROVIDER'] },
  { code: 'verification.queue.read', description: 'Read the verification queue', roles: ['AGENT', 'ADMIN'] },
  { code: 'verification.submit', description: 'Submit a verification outcome', roles: ['AGENT', 'ADMIN'] },
  { code: 'recordings.play', description: 'Play call recordings', roles: ['FINANCE', 'ADMIN'] },
  { code: 'ledger.read', description: 'Read the ledger and balances', roles: ['FINANCE', 'ADMIN'] },
  { code: 'refunds.create', description: 'Create a refund', roles: ['FINANCE', 'ADMIN'] },
  { code: 'payouts.manage', description: 'Create and settle payout batches', roles: ['FINANCE', 'ADMIN'] },
  { code: 'providers.approve', description: 'Approve, reject, block or deactivate providers', roles: ['ADMIN'] },
  { code: 'documents.review', description: 'Review identity documents', roles: ['ADMIN'] },
  { code: 'settings.manage', description: 'Edit platform settings', roles: ['ADMIN'] },
  { code: 'roles.manage', description: 'Manage roles and permissions', roles: ['ADMIN'] },
  { code: 'disputes.resolve', description: 'Resolve disputes', roles: ['ADMIN'] },
  { code: 'penalties.apply', description: 'Apply penalties and decide appeals', roles: ['ADMIN'] },
  { code: 'audit.read', description: 'Read the audit log', roles: ['ADMIN'] },
  { code: 'reports.generate', description: 'Generate reports', roles: ['ADMIN', 'FINANCE'] }
];

export const seedRolesAndPermissions = async (): Promise<void> => {
  for (const code of allRoleCodes) {
    await execute(`INSERT INTO roles(code, name) VALUES (${literal(code)}, ${literal(code)}) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`);
  }
  for (const permission of permissions) {
    await execute(
      `INSERT INTO permissions(code, description) VALUES (${literal(permission.code)}, ${literal(permission.description)})
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description`
    );
    for (const role of permission.roles) {
      await execute(
        `INSERT INTO role_permissions(role_code, permission_code) VALUES (${literal(role)}, ${literal(permission.code)}) ON CONFLICT DO NOTHING`
      );
    }
  }
};
