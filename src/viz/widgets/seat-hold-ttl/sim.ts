// Pure simulation of BookMyShow-style seat holds: the topic's InMemorySeatLockProvider
// (all-or-nothing, owner-checked, lazily expiring leases) next to a naive seat-by-seat variant,
// plus the confirm path whose real guarantee is UNIQUE(show_id, seat_id) in the database.
// The clock is injected, so TTL behaviour is deterministic. No React here.
import type { BaseFrame } from '../../core';

export type Mode = 'atomic' | 'naive';
export type Scenario = 'late-pay' | 'failover';

export interface Params {
  mode: Mode;
  scenario: Scenario;
}

export const SEATS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];
export const TTL = 10; // minutes
export type User = 'U1' | 'U2' | 'U3';

export interface Lease {
  holdId: User;
  expiresAt: number;
}

export interface Event {
  t: number;
  who: User | 'clock' | 'redis';
  text: string;
  ok: boolean | null;
}

export interface Frame extends BaseFrame {
  now: number;
  /** what is physically stored in the lease map (including stale, not-yet-swept leases) */
  leases: Record<string, Lease | undefined>;
  /** confirmed rows in booking_seat (seat -> user) */
  booked: Record<string, User>;
  log: Event[];
  /** seats touched by the current step */
  focus: string[];
  /** refunds issued so far */
  refunds: User[];
}

/** The lock provider from the topic, with an optional naive acquire for comparison. */
export class SeatLocks {
  leases = new Map<string, Lease>();
  clock: { now: number };
  constructor(clock: { now: number }) {
    this.clock = clock;
  }

  live(seat: string): Lease | undefined {
    const l = this.leases.get(seat);
    if (l && l.expiresAt <= this.clock.now) {
      this.leases.delete(seat); // lazy expiry
      return undefined;
    }
    return l;
  }

  /** all-or-nothing: check every seat, then take every seat */
  acquire(seats: string[], holdId: User, ttl: number): { ok: boolean; blockedBy?: string } {
    const keys = [...new Set(seats)].sort();
    for (const k of keys) {
      const l = this.live(k);
      if (l && l.holdId !== holdId) return { ok: false, blockedBy: k };
    }
    for (const k of keys) this.leases.set(k, { holdId, expiresAt: this.clock.now + ttl });
    return { ok: true };
  }

  /** naive: take seats one by one and stop at the first conflict (without rolling back) */
  acquireNaive(seats: string[], holdId: User, ttl: number): { ok: boolean; blockedBy?: string; taken: string[] } {
    const taken: string[] = [];
    for (const k of [...seats].sort().reverse()) {
      const l = this.live(k);
      if (l && l.holdId !== holdId) return { ok: false, blockedBy: k, taken };
      this.leases.set(k, { holdId, expiresAt: this.clock.now + ttl });
      taken.push(k);
    }
    return { ok: true, taken };
  }

  validate(seats: string[], holdId: User): boolean {
    return seats.every((s) => this.live(s)?.holdId === holdId);
  }

  release(seats: string[], holdId: User) {
    for (const s of seats) if (this.live(s)?.holdId === holdId) this.leases.delete(s);
  }
}

/** booking_seat with UNIQUE(show_id, seat_id): inserts are all-or-nothing per transaction */
export class BookingTable {
  rows = new Map<string, User>();
  insertAll(seats: string[], who: User): { ok: boolean; conflict?: string } {
    const clash = seats.find((s) => this.rows.has(s));
    if (clash) return { ok: false, conflict: clash }; // 23505 → ROLLBACK
    for (const s of seats) this.rows.set(s, who);
    return { ok: true };
  }
}

export function simulate(p: Params): Frame[] {
  const clock = { now: 0 };
  const locks = new SeatLocks(clock);
  const db = new BookingTable();
  const log: Event[] = [];
  const refunds: User[] = [];
  const frames: Frame[] = [];

  const snap = (caption: string, focus: string[] = [], predict?: string) =>
    frames.push({
      now: clock.now,
      leases: Object.fromEntries(SEATS.map((s) => [s, locks.leases.get(s) ? { ...locks.leases.get(s)! } : undefined])),
      booked: Object.fromEntries(db.rows),
      log: log.map((e) => ({ ...e })),
      focus,
      refunds: [...refunds],
      caption,
      predict,
    });
  const ev = (who: Event['who'], text: string, ok: boolean | null) => log.push({ t: clock.now, who, text, ok });

  const hold = (who: User, seats: string[]) => {
    if (p.mode === 'atomic') {
      const r = locks.acquire(seats, who, TTL);
      ev(who, `hold ${seats.join('+')}${r.ok ? ` → held until ${clock.now + TTL}′` : ` → rejected (${r.blockedBy} taken)`}`, r.ok);
      return { ...r, taken: r.ok ? seats : [] };
    }
    const r = locks.acquireNaive(seats, who, TTL);
    ev(
      who,
      `hold ${seats.join('+')}${r.ok ? ` → held until ${clock.now + TTL}′` : ` → rejected at ${r.blockedBy}${r.taken.length ? `, but ${r.taken.join('+')} stays held` : ''}`}`,
      r.ok,
    );
    return r;
  };

  /** the topic's confirm path: validate → re-acquire if lapsed → DB insert under UNIQUE → release */
  const confirm = (who: User, seats: string[]) => {
    let note = '';
    if (!locks.validate(seats, who)) {
      const re = p.mode === 'atomic' ? locks.acquire(seats, who, 1) : locks.acquireNaive(seats, who, 1);
      if (!re.ok) {
        refunds.push(who);
        locks.release(seats, who);
        ev(who, `pays → hold no longer valid, re-take failed (${re.blockedBy} is someone else's) → refund`, false);
        return { ok: false, why: 'expired' as const };
      }
      note = ' (hold had lapsed; seats were still free, so re-taken)';
    }
    const ins = db.insertAll(seats, who);
    if (!ins.ok) {
      refunds.push(who);
      ev(who, `pays → INSERT ${ins.conflict} hits UNIQUE(show, seat) → rollback + refund`, false);
      return { ok: false, why: 'unique' as const };
    }
    locks.release(seats, who);
    ev(who, `pays → booking_seat rows inserted → CONFIRMED${note}`, true);
    return { ok: true, why: null };
  };

  snap(
    `Show S1, row A. Holds live in a lease map (TTL ${TTL} min); confirmed seats live in booking_seat with UNIQUE(show_id, seat_id). Mode: ${
      p.mode === 'atomic' ? 'all-or-nothing acquire' : 'naive seat-by-seat acquire'
    }.`,
  );

  if (p.scenario === 'late-pay') {
    hold('U1', ['A5', 'A6']);
    snap('t=0: U1 holds A5+A6. Both leases expire at minute 10.', ['A5', 'A6']);

    clock.now = 1;
    const r2 = hold('U2', ['A6', 'A7']);
    snap(
      p.mode === 'atomic'
        ? 't=1: U2 asks for A6+A7. Phase 1 checks every seat first, finds A6 owned by U1, and returns false before writing anything: A7 stays free.'
        : `t=1: U2 asks for A6+A7. The naive loop takes A7 first, then hits A6 and gives up without rolling back. A7 is now stranded under U2's name until minute ${clock.now + TTL}, and nobody can buy it.`,
      ['A6', 'A7'],
      r2.ok ? undefined : 'U1 walks away to find a card. What happens to A5+A6 at minute 10 if no sweeper job runs?',
    );

    clock.now = 11;
    ev('clock', 'minute 11: no sweeper ran; stale leases still sit in the map', null);
    snap('t=11: the clock passes minute 10. No timer fired, so U1’s leases are still physically in the map, but they are dead: expiresAt ≤ now.', ['A5', 'A6']);

    const r3 = hold('U2', ['A6', 'A7']);
    snap(
      r3.ok
        ? 't=11: U2 retries A6+A7. live(A6) sees the stale lease, deletes it on read (lazy expiry) and the hold succeeds. Correct TTL with no background job.'
        : 't=11: U2 retries A6+A7 and fails.',
      ['A6', 'A7'],
      'U1’s payment gateway now says “paid”. Should the confirm overwrite U2’s hold?',
    );

    clock.now = 12;
    const c1 = confirm('U1', ['A5', 'A6']);
    snap(
      c1.ok
        ? 't=12: U1 confirms.'
        : 't=12: U1’s late payment arrives. validate() fails (hold gone); the service tries to re-take A5+A6, but A6 is U2’s now, so it refunds U1. It never overwrites another user’s hold.',
      ['A5', 'A6'],
    );

    clock.now = 13;
    const c2 = confirm('U2', ['A6', 'A7']);
    snap(
      c2.ok ? 't=13: U2 pays inside the TTL; booking_seat gets A6 and A7, and the holds are released (owner-checked).' : 't=13: U2 confirm failed.',
      ['A6', 'A7'],
    );
  } else {
    hold('U1', ['A5', 'A6']);
    snap('t=0: U1 holds A5+A6 until minute 10.', ['A5', 'A6']);

    clock.now = 3;
    locks.leases.delete('A6');
    ev('redis', 'failover: replica promoted without the A6 key', null);
    snap(
      't=3: Redis fails over and the new primary never received U1’s A6 key. The hold layer now lies: it says A6 is free.',
      ['A6'],
      'U3 asks for A6+A7 at minute 4. Will the lock layer stop them?',
    );

    clock.now = 4;
    hold('U3', ['A6', 'A7']);
    snap('t=4: U3 holds A6+A7, so two users now believe they hold A6. Holds are only the fast, probabilistic layer.', ['A6', 'A7']);

    clock.now = 5;
    confirm('U1', ['A5', 'A6']);
    snap(
      't=5: U1 pays. validate() fails for A6 (U3 has it), so this confirm is refused and refunded too. Owner checks keep one wrong lease from becoming two bookings.',
      ['A5', 'A6'],
    );

    clock.now = 6;
    confirm('U3', ['A6', 'A7']);
    snap('t=6: U3 pays; the insert succeeds, since no confirmed row exists for A6 yet.', ['A6', 'A7']);

    // the truly dangerous race: a confirm that skips/bypasses validation (e.g. a retried webhook from U1 after a lock bug)
    clock.now = 7;
    const ins = db.insertAll(['A5', 'A6'], 'U1');
    if (!ins.ok) {
      refunds.push('U1');
      ev('U1', `retried webhook skips the lock check → INSERT A6 hits UNIQUE → rollback + refund`, false);
    }
    snap(
      't=7: worst case: a buggy retry path skips the lock check and inserts U1’s seats anyway. UNIQUE(show_id, seat_id) rejects A6, the transaction rolls back and U1 is refunded. The database constraint, not the cache, is the guarantee.',
      ['A5', 'A6'],
    );
  }

  const bookedSeats = Object.keys(frames[frames.length - 1].booked);
  const stranded = SEATS.filter((s) => {
    const l = locks.leases.get(s);
    return l && l.expiresAt > clock.now && !bookedSeats.includes(s);
  });
  snap(
    `Result: booked ${bookedSeats.join(', ') || 'nothing'}; refunds to ${[...new Set(refunds)].join(', ') || 'nobody'}${
      stranded.length ? `; still locked with no booking: ${stranded.join(', ')}` : ''
    }. ${
      p.scenario === 'late-pay'
        ? p.mode === 'atomic'
          ? 'All-or-nothing acquire never strands a seat, lazy expiry needs no sweeper, and a late payment is refunded rather than overwriting.'
          : 'The naive loop stranded A7 for ten minutes of lost sales. Check every seat before taking any.'
        : 'Two holders of A6 still produced exactly one booking: the UNIQUE constraint is the cross-pod guarantee; Redis is an optimisation.'
    }`,
  );
  return frames;
}
