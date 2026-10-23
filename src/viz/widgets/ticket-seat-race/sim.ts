// Pure model of seat holds for one show (no React, Node-testable).
//   naive : each client READS the seat map, then WRITES "held"/"booked" with no condition. Two
//           clients that read before either writes both think they won; confirm never checks expiry.
//   atomic: a hold is one Redis Lua script over all requested seats (single-threaded → atomic,
//           all-or-nothing) with PX = TTL. Confirm requires the booking to still be PENDING (hold not
//           expired) and runs UPDATE show_seat SET status='BOOKED' WHERE status='AVAILABLE' for every
//           seat in one transaction (rowCount must equal the seat count) — the DB is the last guard.
// Script: A wants 3–4 and B wants 4–5 at the same instant; C holds 7–8 and pays slowly (the PSP
// callback lands at t = 8); D keeps trying for seat 7.
import type { BaseFrame } from '../../core';

export type Guard = 'naive' | 'atomic';

export interface Params {
  guard: Guard;
  ttl: number;
}

export const DEFAULT_PARAMS: Params = { guard: 'atomic', ttl: 4 };
export const SEATS = 8;
export const HOLD_C_AT = 3;
export const C_PAYS_AT = 8;
export const T_END = 11;

export interface SeatView {
  n: number;
  holdBy: string | null;
  holdExp: number | null;
  /** tickets issued for this seat (more than one = double booking) */
  bookedBy: string[];
}

export type UserState = 'browsing' | 'holding' | 'booked' | 'failed' | 'refunded' | 'waiting' | 'gave up';

export interface UserView {
  id: string;
  want: number[];
  state: UserState;
  note: string;
}

export interface Frame extends BaseFrame {
  t: number;
  seats: SeatView[];
  users: UserView[];
  /** seats touched in this step */
  touched: number[];
  /** the command or SQL run in this step */
  op: string;
  opOk: boolean | null;
}

export function simulate({ guard, ttl }: Params): Frame[] {
  const seats: SeatView[] = Array.from({ length: SEATS }, (_, i) => ({ n: i + 1, holdBy: null, holdExp: null, bookedBy: [] }));
  const users: Record<string, UserView> = {
    A: { id: 'A', want: [3, 4], state: 'browsing', note: 'wants 3–4' },
    B: { id: 'B', want: [4, 5], state: 'browsing', note: 'wants 4–5' },
    C: { id: 'C', want: [7, 8], state: 'browsing', note: 'wants 7–8' },
    D: { id: 'D', want: [7], state: 'browsing', note: 'wants 7' },
  };
  const frames: Frame[] = [];
  const atomic = guard === 'atomic';
  const seat = (n: number) => seats[n - 1];
  /** C's booking row: PENDING until paid or swept */
  let cBooking: 'PENDING' | 'EXPIRED' | 'CONFIRMED' | 'NONE' = 'NONE';

  const snap = (t: number, caption: string, touched: number[], op: string, opOk: boolean | null, predict?: string) =>
    frames.push({
      caption,
      predict,
      t,
      seats: seats.map((s) => ({ ...s, bookedBy: [...s.bookedBy] })),
      users: Object.values(users).map((u) => ({ ...u, want: [...u.want] })),
      touched,
      op,
      opOk,
    });

  const free = (n: number, t: number) => {
    const s = seat(n);
    return s.bookedBy.length === 0 && (s.holdBy === null || (s.holdExp !== null && s.holdExp <= t));
  };
  const hold = (u: string, want: number[], t: number) => {
    for (const n of want) {
      seat(n).holdBy = u;
      seat(n).holdExp = t + ttl;
    }
    users[u].state = 'holding';
    users[u].want = want;
  };
  const release = (u: string) => {
    for (const s of seats)
      if (s.holdBy === u) {
        s.holdBy = null;
        s.holdExp = null;
      }
  };
  const book = (u: string, want: number[]) => {
    for (const n of want) {
      seat(n).bookedBy.push(u);
      if (seat(n).holdBy === u) {
        seat(n).holdBy = null;
        seat(n).holdExp = null;
      }
    }
    users[u].state = 'booked';
    users[u].note = `ticket for ${want.join('–')}`;
  };

  snap(
    0,
    atomic
      ? `Eight seats are AVAILABLE. Holds go through one Redis Lua script per request (all seats or none) with a ${ttl}-tick TTL, and the confirm is a guarded DB transaction.`
      : `Eight seats are AVAILABLE. This naive service reads the seat map, then writes HELD or BOOKED with no condition. The hold TTL is ${ttl} ticks.`,
    [],
    '',
    null,
  );

  // t=1: A and B race
  if (atomic) {
    hold('A', [3, 4], 1);
    users.A.note = 'holding 3–4';
    snap(
      1,
      `A and B press "hold" at the same instant. Redis runs one script at a time: A's script finds 3 and 4 free and sets both keys with PX TTL.`,
      [3, 4],
      'EVAL hold.lua {show9}:3 {show9}:4 holdA → OK',
      true,
      `B's script runs next and asks for seats 4 and 5. What does it do with seat 5?`,
    );
    users.B.state = 'failed';
    users.B.note = 'seat 4 taken';
    snap(1, `B's script sees seat 4 already held and returns failure WITHOUT holding seat 5: all-or-nothing, so nobody is left with half a booking.`, [4, 5], 'EVAL hold.lua {show9}:4 {show9}:5 holdB → 0 (seat 4 held)', false);
    hold('B', [5, 6], 2);
    users.B.note = 'holding 5–6 instead';
    snap(2, `B picks seats 5 and 6 instead; that script succeeds.`, [5, 6], 'EVAL hold.lua {show9}:5 {show9}:6 holdB → OK', true);
  } else {
    users.A.note = 'read: 3–4 free';
    users.B.note = 'read: 4–5 free';
    snap(1, `A and B press "hold" at the same instant. Both READ the seat map first, and both see seat 4 AVAILABLE.`, [3, 4, 5], 'SELECT status FROM show_seat WHERE seat IN (3,4) / (4,5)', null, 'Both now write HELD. Who owns seat 4?');
    hold('A', [3, 4], 1);
    hold('B', [4, 5], 1);
    users.A.note = 'thinks it holds 3–4';
    users.B.note = 'thinks it holds 4–5';
    snap(1, `Both WRITE "held". B's write to seat 4 silently overwrites A's. Both apps show seat 4 as theirs, and nothing has failed yet.`, [3, 4, 5], "UPDATE show_seat SET status='HELD' (no WHERE guard) ×2", null);
  }

  // t=3: C holds 7–8
  hold('C', [7, 8], HOLD_C_AT);
  cBooking = 'PENDING';
  users.C.note = `paying, hold ends t=${HOLD_C_AT + ttl}`;
  snap(
    HOLD_C_AT,
    `C holds seats 7 and 8 and goes to the payment page. A booking row is created as PENDING with hold_expires_at = ${HOLD_C_AT + ttl}. C's bank is slow: the payment callback will arrive at t=${C_PAYS_AT}.`,
    [7, 8],
    atomic ? `EVAL hold.lua {show9}:7 {show9}:8 holdC PX ${ttl} → OK` : "UPDATE show_seat SET status='HELD' WHERE seat IN (7,8)",
    true,
  );

  // t=4: A pays
  book('A', [3, 4]);
  snap(
    4,
    atomic
      ? `A's payment succeeds. One transaction runs UPDATE … SET status='BOOKED' WHERE seat IN (3,4) AND status='AVAILABLE'; 2 rows change, it commits, and A's Redis holds are deleted (compare-and-delete).`
      : `A's payment succeeds and seats 3 and 4 are marked BOOKED for A.`,
    [3, 4],
    atomic ? "UPDATE show_seat SET status='BOOKED' WHERE seat IN (3,4) AND status='AVAILABLE' → 2 rows" : "UPDATE show_seat SET status='BOOKED' WHERE seat IN (3,4)",
    true,
  );

  // t=5: B pays
  if (atomic) {
    book('B', [5, 6]);
    snap(5, `B pays for 5 and 6; the guarded update changes 2 rows and commits.`, [5, 6], "UPDATE … WHERE seat IN (5,6) AND status='AVAILABLE' → 2 rows", true);
  } else {
    book('B', [4, 5]);
    snap(5, `B pays for 4 and 5 and the naive confirm marks them BOOKED for B. Seat 4 now has two tickets, for A and B: double booking. Two fans will turn up for one seat.`, [4, 5], "UPDATE show_seat SET status='BOOKED' WHERE seat IN (4,5)", false);
  }

  // t = 6 .. T_END: C's expiry, C's callback, D's attempts (in that order within a tick)
  let dPayAt: number | null = null;
  const expAt = HOLD_C_AT + ttl;
  for (let t = 6; t <= T_END; t++) {
    const msgs: string[] = [];
    const touched: number[] = [];
    let op = '';
    let opOk: boolean | null = null;
    let predict: string | undefined;

    if (cBooking === 'PENDING' && t >= expAt) {
      release('C');
      cBooking = 'EXPIRED';
      users.C.note = 'hold expired, still paying';
      msgs.push(`C's hold reaches its TTL: the Redis keys expire, seats 7 and 8 become available, and a sweeper marks C's booking EXPIRED.`);
      touched.push(7, 8);
      op = atomic ? 'keys {show9}:7 {show9}:8 expire (PX)' : "UPDATE show_seat SET status='AVAILABLE' WHERE held_until < now()";
    }

    if (t === C_PAYS_AT && users.C.state !== 'booked') {
      touched.push(7, 8);
      if (atomic) {
        if (cBooking === 'EXPIRED') {
          users.C.state = 'refunded';
          users.C.note = 'paid too late, refunded';
          msgs.push(`C's payment callback finally arrives, but the booking is EXPIRED, so the confirm is refused and the charge is refunded. C loses the seats; nobody gets a duplicate ticket.`);
          op = 'confirm(bookingC): status = EXPIRED → refund';
          opOk = false;
        } else {
          cBooking = 'CONFIRMED';
          book('C', [7, 8]);
          msgs.push(`C's payment callback arrives while the hold is still valid. The guarded UPDATE books 7 and 8 (2 rows) and commits.`);
          op = "UPDATE … WHERE seat IN (7,8) AND status='AVAILABLE' → 2 rows";
          opOk = true;
        }
      } else {
        const dbl = seat(7).bookedBy.length > 0;
        book('C', [7, 8]);
        msgs.push(
          dbl
            ? `C's late payment callback arrives and the naive confirm marks 7 and 8 BOOKED without checking anything. Seat 7 was already sold to D: double booking again.`
            : `C's payment callback arrives and the naive confirm marks 7 and 8 BOOKED${cBooking === 'EXPIRED' ? ' even though the hold had expired' : ''}.`,
        );
        op = "UPDATE show_seat SET status='BOOKED' WHERE seat IN (7,8)";
        opOk = !dbl;
      }
    }

    // D wants seat 7
    if (users.D.state === 'holding' && dPayAt === t) {
      touched.push(7);
      if (atomic) {
        if (seat(7).bookedBy.length === 0) {
          book('D', [7]);
          msgs.push(`D pays; the guarded UPDATE changes 1 row and D gets seat 7.`);
          op = "UPDATE … WHERE seat = 7 AND status='AVAILABLE' → 1 row";
          opOk = true;
        } else {
          users.D.state = 'refunded';
          users.D.note = 'seat sold, refunded';
          msgs.push(`D pays, but the guarded UPDATE matches 0 rows because seat 7 is already BOOKED, so the transaction rolls back and D is refunded.`);
          op = "UPDATE … WHERE seat = 7 AND status='AVAILABLE' → 0 rows";
          opOk = false;
        }
      } else {
        const dbl = seat(7).bookedBy.length > 0;
        book('D', [7]);
        msgs.push(dbl ? `D pays and the naive confirm books seat 7 for D as well. Seat 7 now has two tickets.` : `D pays and gets seat 7.`);
        op = "UPDATE show_seat SET status='BOOKED' WHERE seat = 7";
        opOk = !dbl;
      }
    } else if (users.D.state === 'browsing' || users.D.state === 'waiting') {
      touched.push(7);
      if (free(7, t)) {
        hold('D', [7], t);
        dPayAt = t + 1;
        users.D.note = 'holding 7, paying';
        msgs.push(`D, refreshing the seat map, sees seat 7 free and holds it.`);
        op = op || (atomic ? 'EVAL hold.lua {show9}:7 holdD → OK' : "UPDATE show_seat SET status='HELD' WHERE seat = 7");
        if (t < C_PAYS_AT) predict = `C's bank callback is still on its way${atomic ? '' : ' and the naive confirm checks nothing'}. When it lands at t=${C_PAYS_AT}, who keeps seat 7?`;
      } else if (seat(7).bookedBy.length) {
        users.D.state = 'gave up';
        users.D.note = 'seat 7 sold';
        msgs.push(`D sees seat 7 is sold and gives up.`);
      } else {
        users.D.state = 'waiting';
        users.D.note = 'seat 7 grey, retrying';
        msgs.push(`D wants seat 7, but it is held (grey) until t=${seat(7).holdExp}. D keeps refreshing.`);
      }
    }

    if (msgs.length) snap(t, `t=${t}: ${msgs.join(' ')}`, touched, op, opOk, predict);
    const done = (s: UserState) => s === 'booked' || s === 'refunded' || s === 'gave up';
    if (t >= C_PAYS_AT && done(users.C.state) && done(users.D.state)) break;
  }

  const doubles = seats.filter((s) => s.bookedBy.length > 1);
  const tickets = seats.reduce((a, s) => a + s.bookedBy.length, 0);
  snap(
    frames[frames.length - 1].t,
    doubles.length
      ? `Result: ${tickets} tickets for ${tickets - doubles.length} seats. Seat${doubles.length > 1 ? 's' : ''} ${doubles.map((s) => s.n).join(' and ')} ${doubles.length > 1 ? 'were' : 'was'} sold twice. Read-then-write without a guard always has a race window.`
      : `Result: ${tickets} tickets, every seat sold at most once. Atomic multi-seat holds stop the race up front, the TTL frees abandoned seats, and the guarded DB confirm is the last line of defence.`,
    doubles.map((s) => s.n),
    '',
    null,
  );
  return frames;
}
