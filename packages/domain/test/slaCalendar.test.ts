import { describe, expect, it } from 'vitest';
import { SlaCalendar } from '../src/slaCalendar.js';

const add = (iso: string, minutes: number) => SlaCalendar.addBusinessMinutes(new Date(iso), minutes).toISOString();

describe('SlaCalendar', () => {
  it('FR-VC-14: starts at 08:00 from 07:59', () => {
    expect(add('2026-09-25T02:59:00.000Z', 30)).toBe('2026-09-25T03:30:00.000Z');
  });

  it('FR-VC-14: pauses 21:50 and resumes next morning', () => {
    expect(add('2026-09-25T16:50:00.000Z', 30)).toBe('2026-09-26T03:20:00.000Z');
  });

  it('treats 22:00 as closed', () => {
    expect(add('2026-09-25T17:00:00.000Z', 1)).toBe('2026-09-26T03:01:00.000Z');
  });

  it('handles midnight', () => {
    expect(add('2026-09-25T19:00:00.000Z', 480)).toBe('2026-09-25T17:00:00.000Z');
  });

  it('handles multi-day spans', () => {
    expect(add('2026-09-25T04:00:00.000Z', 2_000)).toBe('2026-09-27T04:20:00.000Z');
  });
});
