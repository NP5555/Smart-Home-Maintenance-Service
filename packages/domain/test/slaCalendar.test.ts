import { describe, expect, it } from 'vitest';
import { SlaCalendar, addBusinessMinutes, businessMinutesBetween, isWithinBusinessHours, nextBusinessInstant, wallTimeIn } from '../src/slaCalendar.js';

const iso = (value: string) => new Date(value);
const pkt = (value: string) => wallTimeIn(iso(value));

describe('SlaCalendar calling hours 08:00-22:00 Asia/Karachi', () => {
  it('FR-VC-14: is closed at midnight and reopens at 08:00 the same morning', () => {
    expect(pkt('2026-09-25T19:00:00.000Z')).toEqual({ year: 2026, month: 9, day: 26, hour: 0, minute: 0 });
    expect(isWithinBusinessHours(iso('2026-09-25T19:00:00.000Z'))).toBe(false);
    expect(nextBusinessInstant(iso('2026-09-25T19:00:00.000Z')).toISOString()).toBe('2026-09-26T03:00:00.000Z');
  });

  it('FR-VC-14: rolls a midnight request into the 08:00 window', () => {
    expect(addBusinessMinutes(iso('2026-09-25T19:00:00.000Z'), 60).toISOString()).toBe('2026-09-26T04:00:00.000Z');
    expect(addBusinessMinutes(iso('2026-09-25T19:00:00.000Z'), 840).toISOString()).toBe('2026-09-26T17:00:00.000Z');
  });

  it('FR-VC-14: from 07:59 the clock starts counting only at 08:00', () => {
    expect(pkt('2026-09-25T02:59:00.000Z')).toEqual({ year: 2026, month: 9, day: 25, hour: 7, minute: 59 });
    expect(nextBusinessInstant(iso('2026-09-25T02:59:00.000Z')).toISOString()).toBe('2026-09-25T03:00:00.000Z');
    expect(addBusinessMinutes(iso('2026-09-25T02:59:00.000Z'), 1).toISOString()).toBe('2026-09-25T03:01:00.000Z');
    expect(addBusinessMinutes(iso('2026-09-25T02:59:00.000Z'), 60).toISOString()).toBe('2026-09-25T04:00:00.000Z');
  });

  it('FR-VC-14: from 21:50 only ten minutes remain before close', () => {
    expect(pkt('2026-09-25T16:50:00.000Z')).toEqual({ year: 2026, month: 9, day: 25, hour: 21, minute: 50 });
    expect(addBusinessMinutes(iso('2026-09-25T16:50:00.000Z'), 10).toISOString()).toBe('2026-09-25T17:00:00.000Z');
    expect(addBusinessMinutes(iso('2026-09-25T16:50:00.000Z'), 30).toISOString()).toBe('2026-09-26T03:20:00.000Z');
  });

  it('FR-VC-14: treats 22:00 as closed and defers to the next morning', () => {
    expect(isWithinBusinessHours(iso('2026-09-25T17:00:00.000Z'))).toBe(false);
    expect(nextBusinessInstant(iso('2026-09-25T17:00:00.000Z')).toISOString()).toBe('2026-09-26T03:00:00.000Z');
    expect(addBusinessMinutes(iso('2026-09-25T17:00:00.000Z'), 1).toISOString()).toBe('2026-09-26T03:01:00.000Z');
    expect(addBusinessMinutes(iso('2026-09-25T17:00:00.000Z'), 60).toISOString()).toBe('2026-09-26T04:00:00.000Z');
  });

  it('FR-VC-14: spans multiple days, pausing every night', () => {
    expect(addBusinessMinutes(iso('2026-09-25T09:00:00.000Z'), SlaCalendar.minutesPerDay).toISOString()).toBe('2026-09-25T17:00:00.000Z');
    expect(addBusinessMinutes(iso('2026-09-25T04:00:00.000Z'), 2_000).toISOString()).toBe('2026-09-27T04:20:00.000Z');
    expect(addBusinessMinutes(iso('2026-09-25T04:00:00.000Z'), SlaCalendar.minutesPerDay * 5).toISOString()).toBe('2026-10-01T17:00:00.000Z');
  });

  it('FR-VC-14: never lands on a minute outside the calling window', () => {
    let cursor = iso('2026-09-25T00:00:00.000Z');
    for (let step = 0; step < 2_000; step += 1) {
      cursor = addBusinessMinutes(cursor, 37);
      expect(isWithinBusinessHours(cursor)).toBe(true);
    }
  });

  it('is idempotent for a zero-minute SLA and rejects invalid inputs', () => {
    expect(addBusinessMinutes(iso('2026-09-25T19:00:00.000Z'), 0).toISOString()).toBe('2026-09-25T19:00:00.000Z');
    expect(() => addBusinessMinutes(iso('2026-09-25T04:00:00.000Z'), -1)).toThrow(RangeError);
    expect(() => addBusinessMinutes(iso('2026-09-25T04:00:00.000Z'), 1.5)).toThrow(RangeError);
  });

  it('measures elapsed business minutes symmetrically', () => {
    expect(businessMinutesBetween(iso('2026-09-25T04:00:00.000Z'), iso('2026-09-25T17:00:00.000Z'))).toBe(SlaCalendar.minutesPerDay);
    expect(businessMinutesBetween(iso('2026-09-25T04:00:00.000Z'), addBusinessMinutes(iso('2026-09-25T04:00:00.000Z'), 1_000))).toBe(1_000);
    expect(businessMinutesBetween(iso('2026-09-25T17:00:00.000Z'), iso('2026-09-25T04:00:00.000Z'))).toBe(0);
  });
});
