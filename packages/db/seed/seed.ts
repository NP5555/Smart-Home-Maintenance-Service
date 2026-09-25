import { hash } from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const execute = (sql: string) => prisma.$executeRawUnsafe(sql);
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

const areas = ['Gulberg', 'DHA Phase 5', 'DHA Phase 6', 'Johar Town', 'Faisal Town', 'Model Town', 'Bahria Town', 'Cantt', 'Shalimar', 'Green Town', 'Samanabad', 'Gulshan-e-Iqbal', 'Askari 10', 'Cantonment', 'PECHS', 'Gulistan-e-Jauhar', 'Wapda Town', 'Shahdara', 'Raiwind Road', 'MMA Chowk'];
const settings: Record<string, unknown> = {
  'booking.offer_timeout_min': 15, 'booking.free_cancel_hours': 4, 'booking.late_cancel_fee': 50000, 'booking.no_show_grace_min': 30,
  'booking.pending_payment_timeout_min': 15, 'booking.max_offers': 5, 'booking.max_offer_window_min': 60, 'booking.travel_buffer_min': 30,
  'evidence.geofence_radius_m': 200, 'booking.max_free_reschedules': 1, 'verification.sla_min': 30, 'verification.cash_sla_min': 15,
  'verification.calling_hours': { start: '08:00', end: '22:00', timeZone: 'Asia/Karachi' }, 'verification.time_bands': ['08:00-12:00', '12:00-17:00', '17:00-22:00'],
  'verification.max_attempts': 3, 'verification.auto_release_hours': 72, 'verification.post_release_complaint_days': 7,
  'tier.first_jobs': 5, 'tier.value_threshold': 1500000, 'tier.sample_rate': 0.1, 'tier.min_time_ratio': 0.4,
  'verification.b_escalation_hours': 24, 'verification.force_tier_a': true, 'verification.lock_timeout_min': 10,
  'rework.window_hours': 48, 'flags.window_days': 90, 'flags.review_count': 3, 'provider.cancel_review': { count: 3, days: 30 },
  'commission.default_pct': 15, 'emergency.surcharge_pct': 25, 'cash.debt_ceiling': 500000,
  'rating.recent_weight': 2, 'rating.poor_threshold': 3, 'demerit.expiry_days': 180, 'demerit.decay_days': 30,
  'penalty.reply_hours': 48, 'penalty.max_fine': 1000000, 'penalty.no_show_fine': 100000,
  'payout.cycle': { frequency: 'WEEKLY', day: 'MONDAY', time: '10:00' }, 'payout.min_amount': 100000,
  'recording.retention_days': 180, 'complaint.sla_hours': { SAFETY: 1, HIGH: 24, NORMAL: 72 },
  'ranking.weights': { rating: 0.35, distance: 0.25, completion: 0.2, response: 0.1, recency: 0.1 }
};

const seed = async () => {
  await execute("INSERT INTO cities(name, timezone) VALUES ('Lahore', 'Asia/Karachi') ON CONFLICT (name) DO UPDATE SET timezone = EXCLUDED.timezone");
  for (const name of areas) await execute(`INSERT INTO areas(city_id, name) SELECT id, ${quote(name)} FROM cities WHERE name = 'Lahore' AND NOT EXISTS (SELECT 1 FROM areas a WHERE a.city_id = cities.id AND a.name = ${quote(name)})`);
  const categories = [
    ['plumbing', 'Plumbing', 'پلمبنگ', true], ['sanitary-bathroom', 'Sanitary & Bathroom', 'صفائی و باتھ روم', true],
    ['electrical', 'Electrical', 'الیکٹریکل', true], ['appliance-repair', 'Appliance Repair', ' appliances', true],
    ['carpentry-furniture', 'Carpentry & Furniture', 'نجاری و فرنیچر', true], ['paint-masonry-waterproofing', 'Paint, Masonry & Waterproofing', 'رنگ، اینڈ چنگ اور واٹر پروفنگ', true],
    ['cleaning-pest-control', 'Cleaning & Pest Control', 'صفائی اور جرگی کنٹرول', false], ['security-smart-home', 'Security & Smart Home', 'سیکیورٹی اور سمارٹ ہوم', false]
  ] as const;
  for (const [index, item] of categories.entries()) await execute(`INSERT INTO categories(slug, name_en, name_ur, sort_order, is_active) VALUES (${quote(item[0])}, ${quote(item[1])}, ${quote(item[2])}, ${index * 10}, ${item[3]}) ON CONFLICT (slug) DO UPDATE SET name_en = EXCLUDED.name_en, name_ur = EXCLUDED.name_ur, is_active = EXCLUDED.is_active`);
  const services = [
    ['plumbing', 'leak-repair', 'Leak Repair', 'Leak Repair', 'Diagnose and repair leaks.', 'FLAT', 250000, 100000, 500000, 0, 90, false],
    ['sanitary-bathroom', 'blocked-drain', 'Blocked Drain', 'Blocked Drain', 'Clear blocked drains.', 'FLAT', 200000, 100000, 400000, 0, 60, false],
    ['electrical', 'fault-finding', 'Electrical Fault Finding', 'Fault Finding', 'Diagnose electrical faults.', 'HOURLY', 150000, 100000, 300000, 0, 60, true],
    ['appliance-repair', 'washing-machine-repair', 'Washing Machine Repair', 'Washing Machine', 'Repair washing machines.', 'FLAT', 300000, 150000, 600000, 0, 90, false],
    ['carpentry-furniture', 'furniture-repair', 'Furniture Repair', 'Furniture Repair', 'Repair household furniture.', 'FLAT', 200000, 100000, 500000, 0, 90, false],
    ['paint-masonry-waterproofing', 'interior-painting', 'Interior Painting', 'Interior Painting', 'Paint interior rooms.', 'PER_SQFT' as never, 120000, 80000, 250000, 0, 30, true]
  ] as const;
  for (const [index, service] of services.entries()) {
    const pricing = service[5] === 'HOURLY' ? 'TIME_BASED' : 'FLAT';
    const unit = pricing === 'TIME_BASED' ? "'HOUR'" : 'NULL';
    await execute(`INSERT INTO services(category_id, slug, name_en, name_ur, description, pricing_model, time_unit, base_price_paisa, min_price_paisa, max_price_paisa, visit_fee_paisa, expected_duration_min, is_high_risk) SELECT c.id, ${quote(service[1])}, ${quote(service[2])}, ${quote(service[3])}, ${quote(service[4])}, '${pricing}', ${unit}, ${service[6]}, ${service[7]}, ${service[8]}, ${service[9]}, ${60 + index * 15}, ${service[10]} FROM categories c WHERE c.slug = ${quote(service[0])} ON CONFLICT (slug) DO NOTHING`);
    await execute(`INSERT INTO service_checklist_items(service_id, position, label_en, label_ur, requires_photo) SELECT s.id, 1, 'Inspect work area', 'کام کی جگہ کا معائنہ', false FROM services s WHERE s.slug = ${quote(service[1])} AND NOT EXISTS (SELECT 1 FROM service_checklist_items i WHERE i.service_id = s.id)`);
  }
  for (const role of ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN']) await execute(`INSERT INTO roles(code, name) VALUES (${quote(role)}, ${quote(role)}) ON CONFLICT (code) DO NOTHING`);
  await execute("INSERT INTO permissions(code, description) VALUES ('profile.read.own', 'Read own profile'), ('verification.submit', 'Submit verification'), ('ledger.read', 'Read ledger'), ('settings.manage', 'Manage settings') ON CONFLICT (code) DO NOTHING");
  await execute("INSERT INTO role_permissions(role_code, permission_code) VALUES ('AGENT', 'verification.submit'), ('FINANCE', 'ledger.read'), ('ADMIN', 'ledger.read'), ('ADMIN', 'settings.manage') ON CONFLICT DO NOTHING");
  const password = await hash('DevPassword!2026', { type: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const staff = [
    ['00000000-0000-4000-8000-000000000001', 'admin@smart-home.local', 'Ayesha', 'Admin'],
    ['00000000-0000-4000-8000-000000000002', 'finance@smart-home.local', 'Bilal', 'Finance'],
    ['00000000-0000-4000-8000-000000000003', 'agent1@smart-home.local', 'Sana', 'Agent'],
    ['00000000-0000-4000-8000-000000000004', 'agent2@smart-home.local', 'Omar', 'Agent']
  ] as const;
  for (const [id, email, firstName, lastName] of staff) {
    await execute(`INSERT INTO users(id, phone_e164, email, password_hash, first_name, last_name) VALUES ('${id}', '+923000000${id.slice(-1)}0', ${quote(email)}, ${quote(password)}, ${quote(firstName)}, ${quote(lastName)}) ON CONFLICT (id) DO NOTHING`);
    const role = id.endsWith('1') ? 'ADMIN' : id.endsWith('2') ? 'FINANCE' : 'AGENT';
    await execute(`INSERT INTO user_roles(user_id, role_code) VALUES ('${id}', '${role}') ON CONFLICT DO NOTHING`);
  }
  for (const [key, value] of Object.entries(settings)) await execute(`INSERT INTO settings(key, value, description) VALUES (${quote(key)}, ${quote(JSON.stringify(value))}::jsonb, ${quote(key)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description`);
  await execute("INSERT INTO commission_rules(scope, rate_bp) VALUES ('GLOBAL', 1500) ON CONFLICT DO NOTHING");
  const breaches: [string, string, number][] = [['LATE_30', 'RELIABILITY', 1], ['LATE_CANCEL', 'RELIABILITY', 3], ['REWORK_VERIFIED', 'QUALITY', 4], ['POOR_STREAK', 'QUALITY', 5], ['NO_SHOW', 'RELIABILITY', 8], ['REWORK_FAILED_2', 'QUALITY', 8], ['SUBSTITUTE', 'INTEGRITY', 20], ['OFF_PLATFORM', 'INTEGRITY', 20], ['OVERCHARGE', 'INTEGRITY', 25], ['FALSIFIED', 'INTEGRITY', 25], ['UNSAFE', 'SAFETY', 25], ['HARASSMENT', 'CONDUCT', 30], ['FAKE_RATINGS', 'INTEGRITY', 30]];
  for (const [code, category, points] of breaches) await execute(`INSERT INTO breach_types(code, name_en, name_ur, category, points) VALUES (${quote(code)}, ${quote(code)}, ${quote(code)}, '${category}', ${points}) ON CONFLICT (code) DO UPDATE SET category = EXCLUDED.category, points = EXCLUDED.points`);
  console.log('Seeded foundation data. Staff password: DevPassword!2026');
};

const main = async () => {
  try {
    await seed();
  } finally {
    await prisma.$disconnect();
  }
};

void main();
