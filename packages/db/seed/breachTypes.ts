import { execute, json, literal } from './support.js';

type BreachSeed = { code: string; nameEn: string; nameUr: string; category: string; points: number; fineRule: unknown; scheduleConsequence: string | null };

export const breachTypes: readonly BreachSeed[] = [
  { code: 'LATE_15', nameEn: 'Late arrival under 15 minutes', nameUr: '15 منٹ سے کم دیر', category: 'RELIABILITY', points: 1, fineRule: { type: 'none' }, scheduleConsequence: null },
  { code: 'LATE_30', nameEn: 'Late arrival 15 to 30 minutes', nameUr: '15 سے 30 منٹ دیر', category: 'RELIABILITY', points: 2, fineRule: { type: 'none' }, scheduleConsequence: null },
  { code: 'LATE_CANCEL', nameEn: 'Late cancellation by provider', nameUr: 'پروائیڈر کی دیر سے منسوخی', category: 'RELIABILITY', points: 3, fineRule: { type: 'fixed', amountPaisa: 50_000 }, scheduleConsequence: null },
  { code: 'NO_SHOW', nameEn: 'Provider no-show', nameUr: 'پروائیڈر حاضر نہیں', category: 'RELIABILITY', points: 8, fineRule: { type: 'fixed', amountPaisa: 100_000 }, scheduleConsequence: null },
  { code: 'REWORK_VERIFIED', nameEn: 'Rework required after verification', nameUr: 'تصدیق کے بعد دوبارہ کام', category: 'QUALITY', points: 4, fineRule: { type: 'multiple_of_excess', factor: 1 }, scheduleConsequence: null },
  { code: 'POOR_STREAK', nameEn: 'Sustained poor rating', nameUr: 'مسلسل کم درجہ بندی', category: 'QUALITY', points: 5, fineRule: { type: 'none' }, scheduleConsequence: 'REVIEW' },
  { code: 'REWORK_FAILED_2', nameEn: 'Second failed rework', nameUr: 'دوسری بار ناکام دوبارہ کام', category: 'QUALITY', points: 8, fineRule: { type: 'multiple_of_excess', factor: 2 }, scheduleConsequence: 'SUSPENSION_30D' },
  { code: 'UNSAFE_WORK', nameEn: 'Unsafe work practice', nameUr: 'غیر محفوظ کام', category: 'SAFETY', points: 15, fineRule: { type: 'max_fine' }, scheduleConsequence: 'SUSPENSION_14D' },
  { code: 'DAMAGE', nameEn: 'Property damage', nameUr: 'ملکیت کا نقصان', category: 'SAFETY', points: 12, fineRule: { type: 'multiple_of_excess', factor: 2 }, scheduleConsequence: 'REVIEW' },
  { code: 'OVERCHARGE', nameEn: 'Overcharging confirmed by verification', nameUr: 'تصدیق شدہ زیادہ قیمت', category: 'INTEGRITY', points: 10, fineRule: { type: 'multiple_of_excess', factor: 1 }, scheduleConsequence: null },
  { code: 'SUBSTITUTE', nameEn: 'Undisclosed substitute provider', nameUr: 'غیر بتائے گئے متبادل', category: 'INTEGRITY', points: 20, fineRule: { type: 'max_fine' }, scheduleConsequence: 'SUSPENSION_30D' },
  { code: 'OFF_PLATFORM', nameEn: 'Off-platform payment', nameUr: 'پلیٹ فارم سے باہر ادائیگی', category: 'INTEGRITY', points: 20, fineRule: { type: 'max_fine' }, scheduleConsequence: 'SUSPENSION_30D' },
  { code: 'FALSIFIED_EVIDENCE', nameEn: 'Falsified evidence', nameUr: 'جھوٹی ثبوت', category: 'INTEGRITY', points: 25, fineRule: { type: 'max_fine' }, scheduleConsequence: 'PERMANENT_BLOCK' },
  { code: 'ABANDONED_JOB', nameEn: 'Abandoned job after acceptance', nameUr: 'قبول کرنے کے بعد کام چھوڑ دیا', category: 'RELIABILITY', points: 20, fineRule: { type: 'max_fine' }, scheduleConsequence: 'SUSPENSION_30D' },
  { code: 'HARASSMENT', nameEn: 'Harassment or abuse of a customer', nameUr: 'کسٹمر کے ساتھ بدسلوکی', category: 'CONDUCT', points: 30, fineRule: { type: 'max_fine' }, scheduleConsequence: 'PERMANENT_BLOCK' },
  { code: 'FAKE_RATINGS', nameEn: 'Manipulating ratings', nameUr: 'ریٹنگ کی نقل', category: 'INTEGRITY', points: 30, fineRule: { type: 'max_fine' }, scheduleConsequence: 'PERMANENT_BLOCK' }
];

export const seedBreachTypes = async (): Promise<void> => {
  for (const breach of breachTypes) {
    await execute(
      `INSERT INTO breach_types(code, name_en, name_ur, category, points, fine_rule, schedule_consequence)
       VALUES (${literal(breach.code)}, ${literal(breach.nameEn)}, ${literal(breach.nameUr)}, ${literal(breach.category)}::breach_category,
         ${breach.points}, ${json(breach.fineRule)}, ${breach.scheduleConsequence === null ? 'NULL' : literal(breach.scheduleConsequence)})
       ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en, name_ur = EXCLUDED.name_ur, category = EXCLUDED.category,
         points = EXCLUDED.points, fine_rule = EXCLUDED.fine_rule, schedule_consequence = EXCLUDED.schedule_consequence`
    );
  }
};
