import { describe, expect, it } from 'vitest';
import { FakeClock, systemClock } from '../src/clock.js';

describe('Clock', () => {
  it('exposes a system clock that advances with real time', () => {
    const before = systemClock.now().getTime();
    const after = systemClock.now().getTime();
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('advances a fake clock deterministically without touching wall time', () => {
    const clock = new FakeClock('2026-09-25T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-25T00:00:00.000Z');
    clock.advanceMinutes(90);
    expect(clock.now().toISOString()).toBe('2026-09-25T01:30:00.000Z');
    clock.advanceHours(22);
    expect(clock.now().toISOString()).toBe('2026-09-25T23:30:00.000Z');
    clock.advanceDays(1);
    expect(clock.now().toISOString()).toBe('2026-09-26T23:30:00.000Z');
  });

  it('returns a copy so callers cannot mutate the fake clock', () => {
    const clock = new FakeClock('2026-09-25T00:00:00.000Z');
    const first = clock.now();
    first.setUTCFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-09-25T00:00:00.000Z');
  });
});
