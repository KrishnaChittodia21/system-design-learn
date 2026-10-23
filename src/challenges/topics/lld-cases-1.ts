import type { ChallengeSet } from '../types';

const set: ChallengeSet = {
  topic: 'lld-cases-1',
  puzzles: [
    {
      mode: 'flow',
      id: 'bookmyshow-hold-classes',
      tab: 'BookMyShow classes',
      title: 'BookMyShow: the classes behind "hold 4 seats"',
      brief:
        'A family holds A5–A8 for 10 minutes, then pays. The design must start in memory, move to many pods without touching the booking service, and never confirm the same seat twice. Fill in the classes.',
      cols: 4.4,
      rows: 3.2,
      nodes: [
        { id: 'ctrl', label: 'POST /holds', sub: '{ seatIds, userId }', kind: 'terminal', col: 0, row: 1.1 },
        { id: 'facade', answer: 'booking', hint: 'One entry point: hold → confirm', col: 1.15, row: 1.1 },
        { id: 'lock', answer: 'lockprov', hint: 'Holds seats; memory now, Redis later', col: 2.3, row: 0 },
        { id: 'redis', label: 'Redis\u00ADSeat\u00ADLock\u00ADProvider', sub: 'TTL key per (show, seat)', col: 3.5, row: 0 },
        { id: 'state', answer: 'lifecycle', hint: 'PENDING → CONFIRMED, never back', col: 2.3, row: 1.1 },
        { id: 'uniq', answer: 'unique', hint: 'Last guard if the hold layer lies', col: 3.5, row: 1.1 },
        { id: 'events', answer: 'observer', hint: 'Tickets and loyalty, off the hot path', col: 2.3, row: 2.2 },
      ],
      edges: [
        ['ctrl', 'facade'],
        ['facade', 'lock', 'hold'],
        ['redis', 'lock', 'impl'],
        ['facade', 'state', 'confirm'],
        ['state', 'uniq', 'INSERT'],
        ['facade', 'events', 'CONFIRMED'],
      ],
      options: [
        {
          id: 'booking',
          label: 'Booking\u00ADService (Facade)',
          sub: 'hold / confirm / cancel',
          is: 'the facade the controller calls; it orchestrates the lock provider, the repository and payments',
        },
        {
          id: 'lockprov',
          label: 'Seat\u00ADLock\u00ADProvider',
          sub: '«interface»',
          is: 'the seam that lets one design scale from 1 to N pods: an in-memory provider for the round and tests, Redis in production',
        },
        {
          id: 'lifecycle',
          label: 'Booking (State)',
          sub: 'guarded transitions',
          is: 'a booking with an explicit lifecycle (PENDING_PAYMENT → CONFIRMED | EXPIRED | CANCELLED) that rejects illegal transitions',
        },
        {
          id: 'unique',
          label: 'booking_\u200Bseat table',
          sub: 'UNIQUE (show, seat)',
          is: 'the durable, authoritative layer: if Redis loses a key, the second confirm fails with a unique violation and that user is refunded',
        },
        {
          id: 'observer',
          label: 'Booking\u200BEvents (Observer)',
          sub: 'email, SMS, loyalty',
          is: 'subscribers to the confirmed event, so notifications never sit inside the booking transaction',
        },
        {
          id: 'isbooked',
          label: 'Seat.isBooked flag',
          sub: 'on the physical seat',
          decoy: true,
          is: 'status on master data: seat A7 exists for every show, so "booked at 6 pm, free at 9 pm?" cannot be answered; status belongs to (show, seat)',
        },
        {
          id: 'cron',
          label: 'Cron job that frees holds',
          sub: 'every minute',
          decoy: true,
          is: 'a correctness dependency on a timer: holds must expire correctly without a cron job, by checking expiresAt lazily on every read',
        },
        {
          id: 'setter',
          label: 'Booking.\u200Bstatus + setter',
          sub: 'plain string field',
          decoy: true,
          is: 'no transition guard: a duplicate payment webhook can move a CONFIRMED booking back to PENDING',
        },
      ],
      why: [
        'SeatLockProvider is the most valued seam: BookingService does not know whether holds live in memory or in Redis.',
        'Holds are all-or-nothing; per-seat locks, if used, are taken in sorted seat-id order so two families cannot deadlock.',
        'UNIQUE(show_id, seat_id) is defence in depth: two people can never both hold a confirmed A7, whatever the hold layer does.',
        'Booking state transitions are explicit, and notifications hang off an Observer, not the critical path.',
      ],
    },
    {
      mode: 'sequence',
      id: 'elevator-look-stops',
      tab: 'Elevator LOOK',
      title: 'Elevator: the stops a LOOK car makes',
      brief:
        'Car 2 idles at floor 3 of a 0–39 tower. Pending: cab 7, hall 5▼, hall 4▲, hall 1▲, hall 9▼. With LOOK and direction-aware stopping, put its stops in order.',
      layout: 'stages',
      steps: [
        {
          id: 's4',
          label: 'Stop at 4 · hall ▲',
          sub: 'first call going up',
          clue: 'Nearest call in its direction',
          is: 'the first UP hall call above floor 3; a car moving up stops for UP hall calls and cab calls ahead of it',
        },
        {
          id: 's7',
          label: 'Stop at 7 · cab call',
          sub: 'passenger inside',
          clue: 'A rider\'s destination',
          is: 'a cab call, which belongs to this car and is served whenever the car passes it in its sweep',
        },
        {
          id: 's9',
          label: 'Stop at 9 · hall ▼',
          sub: 'upward turnaround',
          clue: 'Last request upward: turn here',
          is: 'the highest request, so it is the turnaround: the car serves the DOWN call here instead of travelling on to floor 39',
        },
        {
          id: 's5',
          label: 'Stop at 5 · hall ▼',
          sub: 'served going down',
          clue: 'Skipped on the way up',
          is: 'the DOWN hall call the car passed while going up; it is served now that the car moves in its direction',
        },
        {
          id: 's1',
          label: 'Stop at 1 · hall ▲',
          sub: 'downward turnaround',
          clue: 'Lowest request: turn again',
          is: 'the lowest request, picked up as the downward turnaround even though the caller wants to go up',
        },
      ],
      decoys: [
        {
          id: 'early5',
          label: 'Stop at 5 going up',
          sub: 'serve 5▼ early',
          is: 'a direction-blind stop: a car moving UP passes a DOWN hall call unless that floor is its turnaround',
        },
        {
          id: 'scan',
          label: 'Ride to 39, then reverse',
          sub: 'SCAN',
          is: 'SCAN, which sweeps to the physical end and wastes trips to empty top floors; LOOK turns at the last request',
        },
        {
          id: 'sstf',
          label: 'Always the nearest stop next',
          sub: 'SSTF',
          is: 'shortest-seek-first, which zig-zags between close floors and can starve far ones',
        },
      ],
      why: [
        'LOOK sweeps in one direction until the last request that way, then reverses: bounded waits, no wasted travel.',
        'Direction-aware stopping: going up, the car serves cab calls and UP hall calls and passes DOWN calls, except at its turnaround.',
        'Hall calls (floor, direction) belong to the bank and can be reassigned; cab calls belong to one car.',
        'This exact order (4, 7, 9, 5, 1) is the lesson\'s simulation-verified LOOK output.',
      ],
    },
    {
      mode: 'route',
      id: 'parking-call-routing',
      tab: 'Route the calls',
      title: 'Parking lot: send every call to the class that owns it',
      brief:
        'A Bengaluru mall lot runs on ParkingService, which only orchestrates. Steer each call from the gate kiosks to the one collaborator that owns that job, so a new tariff rule or a new allocation policy never edits the service.',
      cols: 4.6,
      rows: 3.4,
      nodes: [
        { id: 'kiosk', label: 'Gate kiosk', sub: '4 entry + 4 exit gates', kind: 'terminal', col: 0, row: 1.2 },
        { id: 'svc', label: 'Parking­Service', sub: 'orchestrates only', col: 1.25, row: 1.2 },
        { id: 'alloc', label: 'Allocation­Strategy', sub: '«interface»', col: 2.55, row: 0.1 },
        { id: 'repo', label: 'Spot­Repository', sub: '«interface»', col: 2.55, row: 1.2 },
        { id: 'tariff', label: 'Tariff ◇ FeeRule[]', sub: 'slab, cap, lost ticket', col: 2.55, row: 2.3 },
        { id: 'events', label: 'SpotEvents (Observer)', sub: 'boards, analytics', col: 1.25, row: 2.4 },
        { id: 'mem', label: 'InMemory­Spot­Repo', sub: 'one process', col: 3.85, row: 0.65 },
        { id: 'pg', label: 'Postgres spot table', sub: 'conditional UPDATE', col: 3.85, row: 1.8 },
      ],
      edges: [
        ['kiosk', 'svc'],
        ['svc', 'alloc', 'pick'],
        ['svc', 'repo', 'claim'],
        ['svc', 'tariff', 'fee'],
        ['svc', 'events', 'emit'],
        ['repo', 'mem'],
        ['repo', 'pg'],
      ],
      packets: [
        {
          id: 'suv-gate3',
          label: 'SUV at gate 3: which spot?',
          sub: 'smallest fit, nearest to the gate',
          from: 'kiosk',
          paths: [['kiosk', 'svc', 'alloc']],
          wrong: {
            'svc>repo':
              'The repository stores and claims spots; it does not decide which one is best. Put "nearest to gate 3" inside it and "top floor first" during a festival means editing storage code.',
            'svc>tariff': 'The tariff prices a stay at exit time. Nothing is being priced yet: the SUV has not parked.',
            'svc>events':
              'SpotEvents announces what already happened (a spot was taken or freed). It cannot choose a spot, and boards should never sit inside allocation.',
          },
          done: 'Choosing a spot is the first variation point, so it lives behind AllocationStrategy: nearest fit today, top-floor-first or VIP-reserved tomorrow, swapped without touching ParkingService.',
        },
        {
          id: 'exit-fee',
          label: 'Exit after 5 h 10 m: what is owed?',
          sub: 'ticket carries tariffId',
          from: 'kiosk',
          paths: [['kiosk', 'svc', 'tariff']],
          wrong: {
            'svc>alloc': 'Allocation picks spots on entry. Fee rules inside it would mix two unrelated variations in one class.',
            'svc>repo':
              'The repository only knows spots and occupancy. Computing money there buries the slab rules in persistence code.',
            'svc>events':
              'An event can tell analytics that a car left, but nobody listening computes the fee; the kiosk needs the amount and breakdown now.',
          },
          done: 'The fee is a pipeline of composable FeeRules over integer paise, chosen by the tariff version stored on the ticket, so the amount is reproducible after a tariff change and a new rule is a new class.',
        },
        {
          id: 'claim-pods',
          label: 'Claim chosen spot F2-14 in production',
          sub: '4 app pods behind 8 gates',
          from: 'svc',
          paths: [['svc', 'repo', 'pg']],
          wrong: {
            'svc>alloc':
              'The strategy already picked F2-14. Picking is not claiming: two gates can pick the same spot, so the claim must be atomic in storage.',
            'svc>tariff': 'Pricing has nothing to do with taking a spot.',
            'svc>events': 'Emitting SPOT_OCCUPIED before the claim succeeds would tell the boards about a spot another gate may win.',
            'repo>mem':
              'An in-memory map is atomic only inside one process. With 4 pods each has its own copy, so two gates on different pods can both claim F2-14.',
          },
          done: 'Across pods the database is the lock: a conditional UPDATE … WHERE occupied_ticket_id IS NULL (or FOR UPDATE SKIP LOCKED) lets exactly one gate win, in the same transaction as the ticket insert.',
        },
        {
          id: 'board-freed',
          label: 'Car leaves F2-14: floor 2 board shows +1',
          sub: 'boards must not poll the table',
          from: 'svc',
          paths: [['svc', 'events']],
          wrong: {
            'svc>repo':
              'The repository records that F2-14 is free, but it tells nobody. Boards that read it would have to poll the spot table every second.',
            'svc>alloc': 'Allocation chooses spots for arriving cars; it does not drive display boards.',
            'svc>tariff': 'The fee was already computed; boards care about availability, not money.',
          },
          done: 'SPOT_FREED goes to SpotEvents, and the floor boards and analytics subscribe. Allocation code never calls a board, and in production the event leaves through a transactional outbox with the claim.',
        },
      ],
      why: [
        'The HLD names two variation points, choosing a spot and computing a fee, and each becomes a Strategy behind an interface.',
        'ParkingService orchestrates (SRP) and depends on interfaces (DIP), so new rules or policies are new classes (OCP).',
        'Picking a spot is not claiming it: across pods the claim is a conditional UPDATE in Postgres, never an in-memory map.',
        'Boards and analytics hang off an Observer, so nothing on the allocation hot path waits on a display.',
      ],
    },
    {
      mode: 'fault',
      id: 'splitwise-paise-drift',
      tab: 'Splitwise drift',
      title: 'Splitwise: the money does not add up',
      brief:
        '₹1000 split three ways shows ₹999.99 in total, group balances stop summing to zero when two members add expenses at the same moment, and adding SHARES meant editing tested code. Find the three faulty pieces.',
      cols: 4.3,
      rows: 3.2,
      nodes: [
        { id: 'app', label: 'Mobile app', sub: 'POST /expenses', kind: 'terminal', col: 0, row: 1.1 },
        {
          id: 'svc',
          label: 'add\u200BExpense: switch\u200B(type)',
          sub: 'EQUAL / EXACT / PERCENT',
          col: 1.15,
          row: 1.1,
          fault: {
            answer: 'factory',
            clue: 'New split type, zero edits',
            why: 'Every split type adds input and validation branches to one method. Adding SHARES edits tested code: the open/closed violation the interviewer is waiting for.',
          },
        },
        {
          id: 'split',
          label: 'share = total / n',
          sub: 'float rupees',
          col: 2.3,
          row: 0,
          fault: {
            answer: 'paise',
            clue: 'Shares must sum exactly',
            why: '₹1000 / 3 in floating-point rupees rounds each share to 333.33, so the three shares sum to 999.99: money is lost by rounding.',
          },
        },
        {
          id: 'ledger',
          label: 'Expense ledger',
          sub: 'append-only, versioned',
          col: 2.3,
          row: 1.1,
          fine: 'The ledger is the source of truth and is append-only: an edit is a new version, a delete is a reversal. That is exactly right.',
        },
        {
          id: 'bal',
          label: 'Balance: read, add, save',
          sub: 'in app code',
          col: 3.5,
          row: 1.1,
          fault: {
            answer: 'atomic',
            clue: 'No read-modify-write',
            why: 'Two expenses land together: both read the same balance, both add, both save, and one increment is lost. The projection drifts from the ledger and net balances stop summing to zero.',
          },
        },
        {
          id: 'simp',
          label: 'Greedy\u00ADSimplifier',
          sub: '≤ n − 1 transfers',
          col: 3.5,
          row: 2.2,
          fine: 'Greedy is not always optimal, but it is the expected fast default behind a DebtSimplifier strategy. It reads balances; it does not corrupt them.',
        },
        {
          id: 'notify',
          label: 'Notify participants',
          sub: 'Observer, after commit',
          col: 2.3,
          row: 2.2,
          fine: 'Notifications run outside the money transaction, as they should.',
        },
      ],
      edges: [
        ['app', 'svc'],
        ['svc', 'split', 'shares'],
        ['svc', 'ledger'],
        ['ledger', 'bal', 'same txn'],
        ['bal', 'simp'],
        ['svc', 'notify', 'added'],
      ],
      options: [
        {
          id: 'factory',
          label: 'Split\u200BStrategy + SplitFactory',
          sub: 'registry by type',
          is: 'one class per split type, each validating its own input, created from a registry: adding SHARES is one class and one line',
        },
        {
          id: 'paise',
          label: 'Integer paise + remainder',
          sub: '33,334 + 33,333 + 33,333',
          is: 'splitting 100,000 paise with floor division and handing the remainder one paisa at a time, so shares always sum to the total',
        },
        {
          id: 'atomic',
          label: 'UPDATE paise = paise + $1',
          sub: 'same txn as the ledger',
          is: 'an atomic increment in the database inside the ledger transaction, so concurrent expenses never overwrite each other',
        },
        {
          id: 'round2',
          label: 'Round each share to 2 dp',
          sub: 'Math.round(x × 100) / 100',
          decoy: true,
          is: 'still floating-point rupees: 333.33 × 3 = 999.99, so a paisa still vanishes',
        },
        {
          id: 'atomiclong',
          label: 'AtomicLong per user',
          sub: 'in-memory',
          decoy: true,
          is: 'atomic for one number only: not enough when the ledger and the balances must change together',
        },
      ],
      metrics: [
        { label: 'Paise lost per split', bad: 1, good: 0, fixedBy: ['split'] },
        { label: 'Lost balance updates', bad: 23, good: 0, unit: '/day', fixedBy: ['bal'] },
        { label: 'Files edited per split', bad: 3, good: 1, unit: '', fixedBy: ['svc'] },
      ],
      why: [
        'Money is integer paise everywhere, with the remainder distributed so splits always sum to the total.',
        'Net balances per group must sum to zero: that invariant is the best unit test.',
        'Balances are a projection updated atomically in the ledger transaction, never read-modify-write in app code.',
        'Split types are a Strategy created by a Factory registry, so a new type is a new class, not a new branch.',
      ],
    },
    {
      mode: 'match',
      id: 'cases1-race-fixes',
      tab: 'Race fixes',
      title: 'On-call week: patch each race to its fix',
      brief:
        'One week of incidents across the parking lot, the elevator bank and BookMyShow. Each is a concurrency or failure bug the lesson names; connect it to the fix that makes it impossible, not just rarer.',
      leftTitle: 'Incident',
      rightTitle: 'Fix',
      instruction: 'Connect each incident to the fix that prevents it',
      left: [
        {
          id: 'two-pods',
          label: 'Gates on two different pods take the same free spot',
          answer: 'skiplocked',
          because:
            'Across pods the database is the lock: UPDATE … WHERE occupied_ticket_id IS NULL with FOR UPDATE SKIP LOCKED lets one gate win while the other takes the next best spot without waiting.',
        },
        {
          id: 'kiosk-retry',
          label: 'A kiosk times out, retries, and burns a second spot',
          answer: 'kioskid',
          because:
            'The kiosk generates the ticket id and retries with it; INSERT … ON CONFLICT (id) DO NOTHING returns the original assignment, so a timeout never claims twice.',
        },
        {
          id: 'hall-race',
          label: 'Two hall calls both see car 2 idle and both get it',
          answer: 'singlewriter',
          because:
            'Buttons, sensors and the tick only enqueue commands; one loop drains the queue and mutates cars, so no assignment awaits a stale read of car positions.',
        },
        {
          id: 'seat-deadlock',
          label: 'Users grabbing {A5, A6} and {A6, A5} both hang forever',
          answer: 'sorted',
          because:
            'With a lock per seat, both users take locks in the same (sorted seat-id) order, so neither can hold one seat while waiting for the other.',
        },
        {
          id: 'late-pay',
          label: 'The PSP says "paid" at minute 11, after the hold expired',
          answer: 'reacquire',
          because:
            'A late payment is a requirement: try to re-acquire the same seats (often still free) and confirm, otherwise refund automatically. Never overwrite another user’s hold.',
        },
        {
          id: 'stuck-car',
          label: 'Car 4 stops between floors with hall calls assigned',
          answer: 'maint',
          because:
            'Moving detects "floor unchanged for > 3 ticks", switches to Maintenance and returns its hall calls to the dispatcher; cab calls die with the car because the passengers are inside.',
        },
      ],
      right: [
        {
          id: 'skiplocked',
          label: 'Conditional UPDATE … SKIP LOCKED',
          sub: 'claim in Postgres',
          is: 'an atomic claim in the shared database, so two processes can never take the same row',
        },
        {
          id: 'kioskid',
          label: 'Kiosk-made ticket id + ON CONFLICT',
          sub: 'idempotent entry',
          is: 'an idempotency key created at the edge, so a retried request returns the first result',
        },
        {
          id: 'singlewriter',
          label: 'Single-writer command queue',
          sub: 'one loop mutates cars',
          is: 'one writer for all car state, with every other input only enqueuing commands',
        },
        {
          id: 'sorted',
          label: 'Lock seats in sorted id order',
          sub: 'per-seat ReentrantLock',
          is: 'a global lock ordering that removes the circular wait behind a deadlock',
        },
        {
          id: 'reacquire',
          label: 'Re-acquire the seats, else refund',
          sub: 'late-payment path',
          is: 'the confirm path for a payment that arrives after expiry, which never steals a newer hold',
        },
        {
          id: 'maint',
          label: 'Maintenance state hands calls back',
          sub: 'State pattern',
          is: 'a car state that takes the car out of service and gives its reassignable hall calls back to the bank',
        },
        {
          id: 'mutex',
          label: 'Mutex inside the NestJS service',
          sub: 'in-process lock',
          decoy: true,
          is: 'a lock that only exists in one pod, so it does nothing when gates on two pods race; the lesson lists it as a pitfall',
        },
        {
          id: 'synccar',
          label: 'synchronized on each Car',
          sub: 'Java, per-car monitor',
          decoy: true,
          is: 'not enough for dispatch: the dispatcher reads all cars to choose one, so per-car locks still let two calls pick the same car',
        },
        {
          id: 'serial',
          label: 'SERIALIZABLE for every transaction',
          sub: 'strongest isolation',
          decoy: true,
          is: 'correct but blunt: it aborts conflicting transactions and invites retry storms at peak instead of fixing the one contended operation',
        },
      ],
      why: [
        'Name the boundary first: in one Node process synchronous code is atomic; across pods only the database (or another shared store) can arbitrate.',
        'Retries need idempotency keys created at the edge, not deduplication guesses on the server.',
        'Deadlocks need a lock order; stale reads need a single writer.',
        'Failure paths (late payments, stuck cars) are requirements: hand work back or compensate, never silently lose it.',
      ],
    },
  ],
};

export default set;
