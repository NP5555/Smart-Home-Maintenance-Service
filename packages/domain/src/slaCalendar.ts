const zone = 'Asia/Karachi';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

type WallTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const wallTime = (date: Date): WallTime => {
  const values = Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return { year: values.year ?? 0, month: values.month ?? 0, day: values.day ?? 0, hour: values.hour ?? 0, minute: values.minute ?? 0, second: values.second ?? 0 };
};

const fromWallTime = (value: WallTime): Date => {
  const guess = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  const first = new Date(guess);
  const firstWall = wallTime(first);
  const asUtc = Date.UTC(firstWall.year, firstWall.month - 1, firstWall.day, firstWall.hour, firstWall.minute, firstWall.second);
  return new Date(guess + (guess - asUtc));
};

const addCalendarDays = (value: WallTime, days: number): WallTime => {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 8, minute: 0, second: 0 };
};

export const SlaCalendar = {
  addBusinessMinutes(start: Date, minutes: number): Date {
    if (!Number.isInteger(minutes) || minutes < 0) throw new RangeError('Business minutes must be a non-negative integer');
    if (minutes === 0) return new Date(start);
    let current = wallTime(start);
    if (current.hour < 8) current = { ...current, hour: 8, minute: 0, second: 0 };
    if (current.hour >= 22) current = addCalendarDays(current, 1);
    let remaining = minutes;
    while (remaining > 0) {
      const available = (22 * 60) - (current.hour * 60 + current.minute);
      if (remaining <= available) {
        current = { ...current, minute: current.minute + remaining, second: 0 };
        remaining = 0;
      } else {
        remaining -= available;
        current = addCalendarDays(current, 1);
      }
    }
    return fromWallTime(current);
  }
};
