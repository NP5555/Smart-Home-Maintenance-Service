export const BUSINESS_TIME_ZONE = 'Asia/Karachi';
export const BUSINESS_DAY_START_HOUR = 8;
export const BUSINESS_DAY_END_HOUR = 22;
export const BUSINESS_MINUTES_PER_DAY = (BUSINESS_DAY_END_HOUR - BUSINESS_DAY_START_HOUR) * 60;

type WallTime = { year: number; month: number; day: number; hour: number; minute: number };

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

export const wallTimeIn = (instant: Date): WallTime => {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number.parseInt(part.value, 10);
  }
  return { year: parts.year ?? 0, month: parts.month ?? 1, day: parts.day ?? 1, hour: parts.hour ?? 0, minute: parts.minute ?? 0 };
};

const offsetOf = (wall: WallTime): number => {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return asUtc - wallTimeIn(new Date(asUtc)).let((observed) => Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute));
};

export const instantFromWallTime = (wall: WallTime): Date => new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - offsetOf(wall));

const wallTimeFromDay = (wall: WallTime, dayOffset: number): WallTime => {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + dayOffset, wall.hour, wall.minute));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: wall.hour, minute: wall.minute };
};

const openAt = (wall: WallTime): WallTime => ({ ...wall, hour: BUSINESS_DAY_START_HOUR, minute: 0 });

const closeAt = (wall: WallTime): WallTime => ({ ...wall, hour: BUSINESS_DAY_END_HOUR, minute: 0 });

const minutesOf = (wall: WallTime): number => wall.hour * 60 + wall.minute;

export const isWithinBusinessHours = (instant: Date): boolean => {
  const wall = wallTimeIn(instant);
  const minutes = minutesOf(wall);
  return minutes >= BUSINESS_DAY_START_HOUR * 60 && minutes < BUSINESS_DAY_END_HOUR * 60;
};

export const nextBusinessInstant = (instant: Date): Date => {
  const wall = wallTimeIn(instant);
  if (isWithinBusinessHours(instant)) return new Date(instant);
  if (minutesOf(wall) < BUSINESS_DAY_START_HOUR * 60) return instantFromWallTime(openAt(wall));
  return instantFromWallTime(openAt(wallTimeFromDay(wall, 1)));
};

export const previousBusinessInstant = (instant: Date): Date => {
  const wall = wallTimeIn(instant);
  if (isWithinBusinessHours(instant)) return new Date(instant);
  if (minutesOf(wall) >= BUSINESS_DAY_END_HOUR * 60) return instantFromWallTime(closeAt(wall));
  return instantFromWallTime(closeAt(wallTimeFromDay(wall, -1)));
};

export const addBusinessMinutes = (start: Date, minutes: number): Date => {
  if (!Number.isInteger(minutes) || minutes < 0) throw new RangeError('Business minutes must be a non-negative integer');
  if (minutes === 0) return new Date(start);
  let cursor = nextBusinessInstant(start);
  let remaining = minutes;
  while (remaining > 0) {
    const wall = wallTimeIn(cursor);
    const available = BUSINESS_DAY_END_HOUR * 60 - minutesOf(wall);
    if (remaining <= available) {
      const target = new Date(cursor.getTime() + remaining * 60_000);
      return remaining === available ? instantFromWallTime(closeAt(wall)) : target;
    }
    remaining -= available;
    cursor = instantFromWallTime(openAt(wallTimeFromDay(wall, 1)));
  }
  return cursor;
};

export const businessMinutesBetween = (from: Date, to: Date): number => {
  if (to.getTime() <= from.getTime()) return 0;
  let total = 0;
  let cursor = nextBusinessInstant(from);
  while (cursor.getTime() < to.getTime()) {
    const wall = wallTimeIn(cursor);
    const available = Math.min(BUSINESS_DAY_END_HOUR * 60 - minutesOf(wall), Math.ceil((to.getTime() - cursor.getTime()) / 60_000));
    total += available;
    cursor = instantFromWallTime(openAt(wallTimeFromDay(wall, 1)));
  }
  return total;
};

export const SlaCalendar = {
  addBusinessMinutes,
  businessMinutesBetween,
  isWithinBusinessHours,
  nextBusinessInstant,
  previousBusinessInstant,
  timeZone: BUSINESS_TIME_ZONE,
  openHour: BUSINESS_DAY_START_HOUR,
  closeHour: BUSINESS_DAY_END_HOUR,
  minutesPerDay: BUSINESS_MINUTES_PER_DAY
} as const;
