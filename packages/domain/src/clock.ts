export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  private current: Date;

  constructor(value: Date | string) {
    this.current = new Date(value);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(value: Date | string): void {
    this.current = new Date(value);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}
