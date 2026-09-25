## Task 1: Pure booking state machine (`packages/domain`)

**Files:**
- Create: `packages/domain/src/bookingTransitions.ts`
- Create: `packages/domain/test/bookingTransitions.test.ts`
- Modify: `packages/domain/src/index.ts` — add `export * from './bookingTransitions.js';`

**Interfaces:**
- Produces: `BookingActorRole` (`'CUSTOMER' | 'PROVIDER'`), `BookingStatus` (the subset of the DB's `booking_status` enum this plan uses), `BookingEvent`, `BookingTransition = { to: BookingStatus; allowedRoles: readonly BookingActorRole[] }`, `transitionFor(from, event): BookingTransition | undefined` (role-blind lookup), `canTransition(from, event, actorRole): BookingTransition | null` (role-checked, used directly by domain unit tests and indirectly by the service in Task 4).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/domain/test/bookingTransitions.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/domain/`): `npx vitest run test/bookingTransitions.test.ts`
Expected: FAIL — `Cannot find module '../src/bookingTransitions.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/domain/src/bookingTransitions.ts

/**
 * Only a customer or a provider ever fires a booking transition in this
 * codebase's current scope. Staff roles (ADMIN/AGENT/FINANCE) act on
 * bookings through dispute/verification tooling that doesn't exist yet
 * (M7+) — this package stays dependency-free from apps/api's broader
 * ActorRole union on purpose.
 */
export type BookingActorRole = 'CUSTOMER' | 'PROVIDER';

/**
 * The subset of the database's `booking_status` enum this package's
 * transition table covers. `ACCEPTED`, `PENDING_PAYMENT`, `ABANDONED` and
 * everything from `AWAITING_VERIFICATION` onward are real enum values the
 * database defines but this build doesn't drive yet (see the design doc,
 * "Out of scope").
 */
export type BookingStatus =
  | 'REQUESTED'
  | 'SCHEDULED'
  | 'EN_ROUTE'
  | 'IN_PROGRESS'
  | 'QUOTE_REVISION'
  | 'WORK_COMPLETED'
  | 'UNFULFILLED'
  | 'CANCELLED_CUSTOMER'
  | 'CANCELLED_PROVIDER'
  | 'NO_SHOW';

export type BookingEvent =
  | 'accept'
  | 'decline'
  | 'cancel'
  | 'reschedule'
  | 'depart'
  | 'start'
  | 'raiseQuoteRevision'
  | 'approveQuoteRevision'
  | 'rejectQuoteRevision'
  | 'complete'
  | 'noShow';

export type BookingTransition = { to: BookingStatus; allowedRoles: readonly BookingActorRole[] };

/**
 * `cancel`'s `to` here is a placeholder only used to prove the event is
 * legal from SCHEDULED; the caller (BookingStateService) always overrides
 * it with CANCELLED_CUSTOMER or CANCELLED_PROVIDER based on which role
 * actually fired the event, since a single table entry can't encode "the
 * target depends on who calls it."
 */
export const BOOKING_TRANSITIONS: Partial<Record<BookingStatus, Partial<Record<BookingEvent, BookingTransition>>>> = {
  REQUESTED: {
    accept: { to: 'SCHEDULED', allowedRoles: ['PROVIDER'] },
    decline: { to: 'UNFULFILLED', allowedRoles: ['PROVIDER'] }
  },
  SCHEDULED: {
    cancel: { to: 'CANCELLED_CUSTOMER', allowedRoles: ['CUSTOMER', 'PROVIDER'] },
    reschedule: { to: 'SCHEDULED', allowedRoles: ['CUSTOMER'] },
    depart: { to: 'EN_ROUTE', allowedRoles: ['PROVIDER'] }
  },
  EN_ROUTE: {
    start: { to: 'IN_PROGRESS', allowedRoles: ['PROVIDER'] },
    noShow: { to: 'NO_SHOW', allowedRoles: ['CUSTOMER', 'PROVIDER'] }
  },
  IN_PROGRESS: {
    raiseQuoteRevision: { to: 'QUOTE_REVISION', allowedRoles: ['PROVIDER'] },
    complete: { to: 'WORK_COMPLETED', allowedRoles: ['PROVIDER'] }
  },
  QUOTE_REVISION: {
    approveQuoteRevision: { to: 'IN_PROGRESS', allowedRoles: ['CUSTOMER'] },
    rejectQuoteRevision: { to: 'IN_PROGRESS', allowedRoles: ['CUSTOMER'] }
  }
};

/** Role-blind lookup: "does this event exist from this status at all." */
export const transitionFor = (from: BookingStatus, event: BookingEvent): BookingTransition | undefined => BOOKING_TRANSITIONS[from]?.[event];

/** Role-checked lookup: null both when the event doesn't exist from this status, and when this role can't fire it. */
export const canTransition = (from: BookingStatus, event: BookingEvent, actorRole: BookingActorRole): BookingTransition | null => {
  const transition = transitionFor(from, event);
  if (transition === undefined || !transition.allowedRoles.includes(actorRole)) return null;
  return transition;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bookingTransitions.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Export it from the package and verify the whole domain package still builds**

Add to `packages/domain/src/index.ts`:
```typescript
export * from './bookingTransitions.js';
```

Run (from `packages/domain/`): `npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: clean typecheck, all domain tests pass (the pre-existing SlaCalendar/money/clock tests plus the 8 new ones)

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/bookingTransitions.ts packages/domain/test/bookingTransitions.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add the booking state transition table"
```

---

