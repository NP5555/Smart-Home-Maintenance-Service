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
