export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date()
};

export class FakeClock implements Clock {
  private current: Date;

  constructor(value: Date | string | number) {
    this.current = new Date(value);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(value: Date | string | number): void {
    this.current = new Date(value);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }

  advanceDays(days: number): void {
    this.advanceHours(days * 24);
  }
}
