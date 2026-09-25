import { execute, literal } from './support.js';

type CategorySeed = { slug: string; nameEn: string; nameUr: string; warrantyDays: number; isActive: boolean };

export const categories: readonly CategorySeed[] = [
  { slug: 'plumbing', nameEn: 'Plumbing', nameUr: 'پلمنگ', warrantyDays: 30, isActive: true },
  { slug: 'electrical', nameEn: 'Electrical', nameUr: 'بجلی', warrantyDays: 30, isActive: true },
  { slug: 'appliance-repair', nameEn: 'Appliance Repair', nameUr: 'اپلائینس مرمت', warrantyDays: 60, isActive: true },
  { slug: 'carpentry', nameEn: 'Carpentry & Furniture', nameUr: 'نجاری و فرنیچر', warrantyDays: 30, isActive: true },
  { slug: 'painting-waterproofing', nameEn: 'Painting & Waterproofing', nameUr: 'پینٹنگ اور واٹر پروف', warrantyDays: 15, isActive: true },
  { slug: 'cleaning-pest', nameEn: 'Cleaning & Pest Control', nameUr: 'صفائی اور کیڑے مار', warrantyDays: 0, isActive: true },
  { slug: 'security-smart-home', nameEn: 'Security & Smart Home', nameUr: 'سیکیورٹی اور اسمارٹ ہوم', warrantyDays: 90, isActive: false },
  { slug: 'carpentry-legacy', nameEn: 'Carpentry (retired)', nameUr: 'نجاری (ریٹائرڈ)', warrantyDays: 0, isActive: false }
];

type ServiceSeed = {
  category: string;
  slug: string;
  nameEn: string;
  nameUr: string;
  description: string;
  pricingModel: 'FLAT' | 'TIME_BASED' | 'INSPECTION_FIRST';
  timeUnit: 'HOUR' | 'DAY' | null;
  basePrice: bigint;
  minPrice: bigint;
  maxPrice: bigint;
  visitFee: bigint;
  durationMin: number;
  emergencyEligible: boolean;
  planEligible: boolean;
  warrantyDays: number;
  highRisk: boolean;
  checklist: readonly { labelEn: string; labelUr: string; requiresPhoto: boolean }[];
};

const service = (seed: ServiceSeed): ServiceSeed => seed;

export const services: readonly ServiceSeed[] = [
  service({
    category: 'plumbing',
    slug: 'leak-repair',
    nameEn: 'Leak Repair',
    nameUr: 'لیک کی مرمت',
    description: 'Diagnose and repair an indoor or outdoor leak.',
    pricingModel: 'FLAT',
    timeUnit: null,
    basePrice: 250_000n,
    minPrice: 100_000n,
    maxPrice: 500_000n,
    visitFee: 0n,
    durationMin: 90,
    emergencyEligible: true,
    planEligible: false,
    warrantyDays: 30,
    highRisk: false,
    checklist: [
      { labelEn: 'Isolate the water supply', labelUr: 'پانی کا رساب بند کریں', requiresPhoto: false },
      { labelEn: 'Photograph the leak before repair', labelUr: 'مرمت سے پہلے لیک کی تصویر', requiresPhoto: true },
      { labelEn: 'Pressure test the repair', labelUr: 'مرمت کا دباؤ آزمائیں', requiresPhoto: false },
      { labelEn: 'Photograph the finished repair', labelUr: 'مکمل مرمت کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'plumbing',
    slug: 'blocked-drain',
    nameEn: 'Blocked Drain',
    nameUr: 'بند نکاس',
    description: 'Clear a blocked drain or sewer line.',
    pricingModel: 'FLAT',
    timeUnit: null,
    basePrice: 200_000n,
    minPrice: 100_000n,
    maxPrice: 400_000n,
    visitFee: 0n,
    durationMin: 60,
    emergencyEligible: true,
    planEligible: false,
    warrantyDays: 30,
    highRisk: false,
    checklist: [
      { labelEn: 'Locate the blockage', labelUr: 'نکاس کی رکاوٹ تلاش کریں', requiresPhoto: false },
      { labelEn: 'Clear the line and run water', labelUr: 'لائن صاف کر کے پانی چلائیں', requiresPhoto: false }
    ]
  }),
  service({
    category: 'plumbing',
    slug: 'new-fixture-install',
    nameEn: 'New Fixture Installation',
    nameUr: 'نیا فکسچر انسٹال',
    description: 'Install a supplied bathroom or kitchen fixture.',
    pricingModel: 'FLAT',
    timeUnit: null,
    basePrice: 350_000n,
    minPrice: 150_000n,
    maxPrice: 700_000n,
    visitFee: 0n,
    durationMin: 120,
    emergencyEligible: false,
    planEligible: false,
    warrantyDays: 60,
    highRisk: false,
    checklist: [
      { labelEn: 'Check the existing pipework', labelUr: 'موجودہ پائپ لائن دیکھیں', requiresPhoto: false },
      { labelEn: 'Photograph the installed fixture', labelUr: 'نصب شدہ فکسچر کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'electrical',
    slug: 'fault-finding',
    nameEn: 'Electrical Fault Finding',
    nameUr: 'بجلی کی خرابی کی تلاش',
    description: 'Trace and rectify a fault in the home circuit.',
    pricingModel: 'TIME_BASED',
    timeUnit: 'HOUR',
    basePrice: 150_000n,
    minPrice: 100_000n,
    maxPrice: 300_000n,
    visitFee: 0n,
    durationMin: 60,
    emergencyEligible: true,
    planEligible: false,
    warrantyDays: 30,
    highRisk: true,
    checklist: [
      { labelEn: 'Isolate the affected circuit', labelUr: 'متاثرہ سرکٹ الگ کریں', requiresPhoto: false },
      { labelEn: 'Photograph the board before and after', labelUr: 'بورد کی پہلے اور بعد کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'electrical',
    slug: 'switch-socket-repair',
    nameEn: 'Switch & Socket Repair',
    nameUr: 'سوئچ اور ساکٹ مرمت',
    description: 'Replace or repair a switch, socket or fitting.',
    pricingModel: 'FLAT',
    timeUnit: null,
    basePrice: 120_000n,
    minPrice: 80_000n,
    maxPrice: 250_000n,
    visitFee: 0n,
    durationMin: 45,
    emergencyEligible: false,
    planEligible: true,
    warrantyDays: 30,
    highRisk: true,
    checklist: [
      { labelEn: 'Turn the circuit off at the board', labelUr: 'سرکٹ بند کریں', requiresPhoto: false },
      { labelEn: 'Photograph the completed fitting', labelUr: 'مکمل فٹنگ کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'appliance-repair',
    slug: 'washing-machine-repair',
    nameEn: 'Washing Machine Repair',
    nameUr: 'واشنگ مشین مرمت',
    description: 'Diagnose and repair a washing machine.',
    pricingModel: 'FLAT',
    timeUnit: null,
    basePrice: 300_000n,
    minPrice: 150_000n,
    maxPrice: 600_000n,
    visitFee: 0n,
    durationMin: 90,
    emergencyEligible: false,
    planEligible: true,
    warrantyDays: 60,
    highRisk: false,
    checklist: [
      { labelEn: 'Record the model and fault code', labelUr: 'ماڈل اور خرابی کوڈ لکھیں', requiresPhoto: false },
      { labelEn: 'Photograph the machine after repair', labelUr: 'مرمت کے بعد مشین کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'appliance-repair',
    slug: 'ac-service',
    nameEn: 'Air Conditioner Service',
    nameUr: 'اے سی سروس',
    description: 'Split AC servicing, gas top-up and installation.',
    pricingModel: 'TIME_BASED',
    timeUnit: 'HOUR',
    basePrice: 250_000n,
    minPrice: 150_000n,
    maxPrice: 500_000n,
    visitFee: 0n,
    durationMin: 90,
    emergencyEligible: false,
    planEligible: true,
    warrantyDays: 30,
    highRisk: false,
    checklist: [
      { labelEn: 'Clean filters and coils', labelUr: 'فلٹر اور کوائل صاف کریں', requiresPhoto: true },
      { labelEn: 'Check cooling performance', labelUr: 'ٹھنڈک کی کارکردگی چیک کریں', requiresPhoto: false }
    ]
  }),
  service({
    category: 'appliance-repair',
    slug: 'refrigerator-repair',
    nameEn: 'Refrigerator Repair',
    nameUr: 'فریج مرمت',
    description: 'Diagnose and repair a refrigerator or freezer.',
    pricingModel: 'FLAT',
    timeUnit: null,
    basePrice: 280_000n,
    minPrice: 150_000n,
    maxPrice: 550_000n,
    visitFee: 0n,
    durationMin: 90,
    emergencyEligible: true,
    planEligible: true,
    warrantyDays: 60,
    highRisk: false,
    checklist: [
      { labelEn: 'Record the temperature on arrival', labelUr: 'آمد پر درجہ حرارت لکھیں', requiresPhoto: false },
      { labelEn: 'Photograph the sealed system work', labelUr: 'سیلڈ سسٹم کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'carpentry',
    slug: 'furniture-repair',
    nameEn: 'Furniture Repair',
    nameUr: 'فرنیچر مرمت',
    description: 'Repair household furniture on site.',
    pricingModel: 'FLAT',
    timeUnit: null,
    basePrice: 200_000n,
    minPrice: 100_000n,
    maxPrice: 500_000n,
    visitFee: 0n,
    durationMin: 90,
    emergencyEligible: false,
    planEligible: true,
    warrantyDays: 30,
    highRisk: false,
    checklist: [
      { labelEn: 'Assess the damage', labelUr: 'نقصان کا جائزہ لیں', requiresPhoto: true },
      { labelEn: 'Photograph the repaired item', labelUr: 'مرمت شدہ چیز کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'carpentry',
    slug: 'door-window-repair',
    nameEn: 'Door & Window Repair',
    nameUr: 'دروازہ اور کھڑکی مرمت',
    description: 'Align, repair or hang doors and windows.',
    pricingModel: 'TIME_BASED',
    timeUnit: 'HOUR',
    basePrice: 180_000n,
    minPrice: 100_000n,
    maxPrice: 350_000n,
    visitFee: 0n,
    durationMin: 60,
    emergencyEligible: true,
    planEligible: true,
    warrantyDays: 30,
    highRisk: false,
    checklist: [
      { labelEn: 'Check frame alignment', labelUr: 'فریم کی ہم آہنگی چیک کریں', requiresPhoto: false },
      { labelEn: 'Photograph the finished fitting', labelUr: 'مکمل فٹنگ کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'painting-waterproofing',
    slug: 'interior-painting',
    nameEn: 'Interior Painting',
    nameUr: 'اندرونی پینٹنگ',
    description: 'Paint interior walls, ceilings and trims.',
    pricingModel: 'TIME_BASED',
    timeUnit: 'DAY',
    basePrice: 1_200_000n,
    minPrice: 500_000n,
    maxPrice: 2_500_000n,
    visitFee: 0n,
    durationMin: 480,
    emergencyEligible: false,
    planEligible: true,
    warrantyDays: 15,
    highRisk: false,
    checklist: [
      { labelEn: 'Photograph surfaces before painting', labelUr: 'پینٹنگ سے پہلے سطحوں کی تصویر', requiresPhoto: true },
      { labelEn: 'Photograph finished rooms', labelUr: 'تکمیل شدہ کمروں کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'painting-waterproofing',
    slug: 'waterproofing-treatment',
    nameEn: 'Waterproofing Treatment',
    nameUr: 'واٹر پروفنگ ٹریٹمنٹ',
    description: 'Inspect and treat roof or wall water ingress.',
    pricingModel: 'INSPECTION_FIRST',
    timeUnit: null,
    basePrice: 900_000n,
    minPrice: 400_000n,
    maxPrice: 2_000_000n,
    visitFee: 50_000n,
    durationMin: 240,
    emergencyEligible: true,
    planEligible: false,
    warrantyDays: 180,
    highRisk: true,
    checklist: [
      { labelEn: 'Inspect and photograph the affected area', labelUr: 'متاثرہ حصے کا معائنہ اور تصویر', requiresPhoto: true },
      { labelEn: 'Photograph the completed treatment', labelUr: 'مکمل ٹریٹمنٹ کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'cleaning-pest',
    slug: 'deep-cleaning',
    nameEn: 'Deep Cleaning',
    nameUr: 'گہری صفائی',
    description: 'Full home deep cleaning by a vetted team.',
    pricingModel: 'TIME_BASED',
    timeUnit: 'DAY',
    basePrice: 1_500_000n,
    minPrice: 800_000n,
    maxPrice: 3_000_000n,
    visitFee: 0n,
    durationMin: 480,
    emergencyEligible: false,
    planEligible: true,
    warrantyDays: 0,
    highRisk: false,
    checklist: [
      { labelEn: 'Photograph each cleaned area', labelUr: 'ہر صاف شدہ حصے کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'cleaning-pest',
    slug: 'pest-control',
    nameEn: 'Pest Control',
    nameUr: 'کیڑے مار',
    description: 'Treatment for cockroach, termite or bed bug infestation.',
    pricingModel: 'FLAT',
    timeUnit: null,
    basePrice: 400_000n,
    minPrice: 200_000n,
    maxPrice: 800_000n,
    visitFee: 0n,
    durationMin: 120,
    emergencyEligible: false,
    planEligible: true,
    warrantyDays: 90,
    highRisk: false,
    checklist: [
      { labelEn: 'Record the affected rooms', labelUr: 'متاثرہ کمروں کی فہرست', requiresPhoto: true },
      { labelEn: 'Photograph the treated area', labelUr: 'ٹریٹ شدہ حصے کی تصویر', requiresPhoto: true }
    ]
  }),
  service({
    category: 'security-smart-home',
    slug: 'cctv-installation',
    nameEn: 'CCTV Installation',
    nameUr: 'سی سی ٹی وی نصب',
    description: 'Install and configure a CCTV camera system.',
    pricingModel: 'FLAT',
    timeUnit: null,
    basePrice: 1_800_000n,
    minPrice: 900_000n,
    maxPrice: 4_000_000n,
    visitFee: 50_000n,
    durationMin: 360,
    emergencyEligible: false,
    planEligible: true,
    warrantyDays: 180,
    highRisk: true,
    checklist: [
      { labelEn: 'Photograph camera placement', labelUr: 'کیمرے کی جگہ کی تصویر', requiresPhoto: true },
      { labelEn: 'Demonstrate remote viewing', labelUr: 'ریموٹ ویوئنگ کا ثبوت دیں', requiresPhoto: false }
    ]
  }),
  service({
    category: 'security-smart-home',
    slug: 'smart-lock-installation',
    nameEn: 'Smart Lock Installation',
    nameUr: 'سمارٹ لاک نصب',
    description: 'Install a smart door lock and pair the app.',
    pricingModel: 'FLAT',
    timeUnit: null,
    basePrice: 700_000n,
    minPrice: 400_000n,
    maxPrice: 1_500_000n,
    visitFee: 0n,
    durationMin: 120,
    emergencyEligible: false,
    planEligible: true,
    warrantyDays: 180,
    highRisk: true,
    checklist: [
      { labelEn: 'Photograph the door before drilling', labelUr: 'سوراخ سے پہلے دروازے کی تصویر', requiresPhoto: true },
      { labelEn: 'Photograph the installed lock', labelUr: 'نصب شدہ لاک کی تصویر', requiresPhoto: true }
    ]
  })
];

export const seedCatalogue = async (): Promise<void> => {
  for (const [index, category] of categories.entries()) {
    await execute(
      `INSERT INTO categories(slug, name_en, name_ur, sort_order, default_warranty_days, is_active)
       VALUES (${literal(category.slug)}, ${literal(category.nameEn)}, ${literal(category.nameUr)}, ${index * 10}, ${category.warrantyDays}, ${category.isActive})
       ON CONFLICT (slug) DO UPDATE SET name_en = EXCLUDED.name_en, name_ur = EXCLUDED.name_ur, sort_order = EXCLUDED.sort_order,
         default_warranty_days = EXCLUDED.default_warranty_days, is_active = EXCLUDED.is_active`
    );
  }
  for (const item of services) {
    const timeUnit = item.timeUnit === null ? 'NULL' : literal(item.timeUnit);
    await execute(
      `INSERT INTO services(category_id, slug, name_en, name_ur, description, pricing_model, time_unit, base_price_paisa,
         min_price_paisa, max_price_paisa, visit_fee_paisa, expected_duration_min, is_emergency_eligible, is_plan_eligible,
         warranty_days, is_high_risk, is_active)
       SELECT c.id, ${literal(item.slug)}, ${literal(item.nameEn)}, ${literal(item.nameUr)}, ${literal(item.description)},
         ${literal(item.pricingModel)}, ${timeUnit}, ${item.basePrice}, ${item.minPrice}, ${item.maxPrice}, ${item.visitFee},
         ${item.durationMin}, ${item.emergencyEligible}, ${item.planEligible}, ${item.warrantyDays}, ${item.highRisk}, true
       FROM categories c WHERE c.slug = ${literal(item.category)}
       ON CONFLICT (slug) DO UPDATE SET name_en = EXCLUDED.name_en, name_ur = EXCLUDED.name_ur, description = EXCLUDED.description,
         pricing_model = EXCLUDED.pricing_model, time_unit = EXCLUDED.time_unit, base_price_paisa = EXCLUDED.base_price_paisa,
         min_price_paisa = EXCLUDED.min_price_paisa, max_price_paisa = EXCLUDED.max_price_paisa, visit_fee_paisa = EXCLUDED.visit_fee_paisa,
         expected_duration_min = EXCLUDED.expected_duration_min, is_emergency_eligible = EXCLUDED.is_emergency_eligible,
         is_plan_eligible = EXCLUDED.is_plan_eligible, warranty_days = EXCLUDED.warranty_days, is_high_risk = EXCLUDED.is_high_risk`
    );
    for (const [position, checklistItem] of item.checklist.entries()) {
      await execute(
        `INSERT INTO service_checklist_items(service_id, position, label_en, label_ur, requires_photo)
         SELECT s.id, ${position + 1}, ${literal(checklistItem.labelEn)}, ${literal(checklistItem.labelUr)}, ${checklistItem.requiresPhoto}
         FROM services s WHERE s.slug = ${literal(item.slug)}
           AND NOT EXISTS (SELECT 1 FROM service_checklist_items c WHERE c.service_id = s.id AND c.position = ${position + 1})`
      );
    }
  }
};
