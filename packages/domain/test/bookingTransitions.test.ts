import { describe, expect, it } from 'vitest';
import { canTransition, transitionFor } from '../src/bookingTransitions.js';

describe('booking transitions', () => {
  it('lets a provider accept a REQUESTED booking, landing on SCHEDULED', () => {
    const transition = canTransition('REQUESTED', 'accept', 'PROVIDER');
    expect(transition).toEqual({ to: 'SCHEDULED', allowedRoles: ['PROVIDER'] });
  });

  it('refuses a customer accepting their own booking', () => {
    expect(canTransition('REQUESTED', 'accept', 'CUSTOMER')).toBeNull();
  });

  it('refuses accept from a status that has no such transition', () => {
    expect(canTransition('SCHEDULED', 'accept', 'PROVIDER')).toBeNull();
  });

  it('lets either party cancel a SCHEDULED booking', () => {
    expect(canTransition('SCHEDULED', 'cancel', 'CUSTOMER')).not.toBeNull();
    expect(canTransition('SCHEDULED', 'cancel', 'PROVIDER')).not.toBeNull();
  });

  it('transitionFor is role-blind: it returns the transition even for a role that cannot fire it', () => {
    expect(transitionFor('REQUESTED', 'accept')).toEqual({ to: 'SCHEDULED', allowedRoles: ['PROVIDER'] });
  });

  it('walks the full happy path from REQUESTED to WORK_COMPLETED', () => {
    expect(canTransition('REQUESTED', 'accept', 'PROVIDER')?.to).toBe('SCHEDULED');
    expect(canTransition('SCHEDULED', 'depart', 'PROVIDER')?.to).toBe('EN_ROUTE');
    expect(canTransition('EN_ROUTE', 'start', 'PROVIDER')?.to).toBe('IN_PROGRESS');
    expect(canTransition('IN_PROGRESS', 'complete', 'PROVIDER')?.to).toBe('WORK_COMPLETED');
  });

  it('routes a quote revision out of and back into IN_PROGRESS', () => {
    expect(canTransition('IN_PROGRESS', 'raiseQuoteRevision', 'PROVIDER')?.to).toBe('QUOTE_REVISION');
    expect(canTransition('QUOTE_REVISION', 'approveQuoteRevision', 'CUSTOMER')?.to).toBe('IN_PROGRESS');
    expect(canTransition('QUOTE_REVISION', 'rejectQuoteRevision', 'CUSTOMER')?.to).toBe('IN_PROGRESS');
  });

  it('has no outgoing transitions from a terminal status', () => {
    expect(transitionFor('WORK_COMPLETED', 'complete')).toBeUndefined();
    expect(transitionFor('UNFULFILLED', 'accept')).toBeUndefined();
  });
});
