// Online chess: one owner per game, moves carry a ply number, the server keeps the clocks and
// subtracts a capped lag credit, the move is appended to a durable log before it is broadcast,
// reconnects get a snapshot, and the server's own timer flags a player.
import type { FlowEdge, FlowFrame, Tone } from './types';

export type ChessScenario = 'normal' | 'reconnect' | 'flag';

export interface ChessParams {
  rttMs: number;
  scenario: ChessScenario;
}

export const START_MS = 60_000;
export const MAX_CREDIT_MS = 300;

/** Lag credit for one move: estimated from recent pings, capped so lying about lag gains little. */
export function lagCredit(rttMs: number): number {
  return Math.min(rttMs, MAX_CREDIT_MS);
}

/** Time charged for a move: receive − turn start − credit, never negative. */
export function charge(turnStartMs: number, receiveMs: number, creditMs: number): number {
  return Math.max(0, receiveMs - turnStartMs - creditMs);
}

export interface LogRow {
  ply: number;
  side: 'W' | 'B';
  move: string;
  note: string;
  tone: Tone;
}

export interface ChessFrame extends FlowFrame {
  clocks: [number, number];
  toMove: 'W' | 'B';
  nextPly: number;
  log: LogRow[];
  result: string;
}

interface Script {
  side: 'W' | 'B';
  move: string;
  /** thinking time in ms (as experienced by the player) */
  think: number;
}

const SCRIPT: Script[] = [
  { side: 'W', move: 'e2e4', think: 1200 },
  { side: 'B', move: 'e7e5', think: 2000 },
  { side: 'W', move: 'g1f3', think: 900 },
  { side: 'B', move: 'b8c6', think: 1500 },
  { side: 'W', move: 'f1b5', think: 800 },
  { side: 'B', move: 'a7a6', think: 3000 },
];

const s1 = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function simulateChess({ rttMs, scenario }: ChessParams): ChessFrame[] {
  const frames: ChessFrame[] = [];
  const clocks: [number, number] = [START_MS, scenario === 'flag' ? 4_000 : START_MS];
  let toMove: 'W' | 'B' = 'W';
  let nextPly = 1;
  const log: LogRow[] = [];
  let result = '';
  let now = 0; // server time, ms
  let turnStart = 0;
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, clocks: [clocks[0], clocks[1]], toMove, nextPly, log: log.map((l) => ({ ...l })), result });
  const idx = (s: 'W' | 'B') => (s === 'W' ? 0 : 1);
  // White is on a 40 ms link; Black's round trip is the slider
  const rtt = (s: 'W' | 'B') => (s === 'W' ? 40 : rttMs);

  snap(
    {},
    [],
    `Bullet game, 1 minute each${scenario === 'flag' ? ' (Black is down to 4 seconds in a scramble)' : ''}. Both players hold a WebSocket to any gateway; the gateway routes by gameId to the one game server that owns this game. Black's round trip is ${rttMs} ms; White's is 40 ms.`,
  );

  const play = (sc: Script, ply: number) => {
    const credit = lagCredit(rtt(sc.side));
    // the player sees the opponent's move rtt/2 late and their move arrives rtt/2 late
    const receive = turnStart + sc.think + rtt(sc.side);
    const used = charge(turnStart, receive, credit);
    now = receive;
    const i = idx(sc.side);
    if (clocks[i] - used <= 0) return { flagged: true, used, credit, receive };
    clocks[i] -= used;
    log.push({ ply, side: sc.side, move: sc.move, note: `${s1(receive - turnStart)} − credit ${credit}ms = ${s1(used)}`, tone: 'accent' });
    nextPly = ply + 1;
    toMove = sc.side === 'W' ? 'B' : 'W';
    turnStart = now;
    return { flagged: false, used, credit, receive };
  };

  for (let k = 0; k < SCRIPT.length; k++) {
    const sc = SCRIPT[k];
    const ply = k + 1;
    const client = sc.side === 'W' ? 'white' : 'black';

    // an illegal move attempt by White before ply 3
    if (ply === 3) {
      snap(
        { white: 'bad', owner: 'bad' },
        [{ from: 'white', to: 'gw', label: 'ply 3: e4e5', tone: 'bad' }, { from: 'gw', to: 'owner', tone: 'bad' }],
        'White\'s client sends {ply: 3, move: e4e5}. The ply is right, but the rules engine says the e4 pawn is blocked by e5: rejected, nothing appended, the clock keeps running. Clients are never trusted for legality.',
      );
    }

    const before = turnStart;
    const r = play(sc, ply);
    if (r.flagged) {
      const i = idx(sc.side);
      const left = clocks[i];
      clocks[i] = 0;
      result = `${sc.side === 'W' ? 'Black' : 'White'} wins on time`;
      log.push({ ply, side: sc.side, move: '(no move)', note: 'flag at deadline', tone: 'bad' });
      snap(
        { owner: 'bad', [client]: 'bad' },
        [{ from: 'owner', to: 'gw', label: 'game over: flag', tone: 'bad' }],
        `${sc.side === 'W' ? 'White' : 'Black'} had ${s1(left)} left and is still thinking. The server scheduled its own timer for turn start + remaining + max credit (${r.credit} ms); it fires first and the server ends the game: ${result}. A move arriving after the deadline would be rejected, and the opponent's "claim win" button only asks the server.`,
      );
      return frames;
    }
    const elapsed = r.receive - before;
    snap(
      { [client]: 'accent', gw: 'accent', owner: 'good', log: 'good' },
      [{ from: client, to: 'gw', label: `ply ${ply}: ${sc.move}`, tone: 'accent' }, { from: 'gw', to: 'owner', tone: 'accent' }, { from: 'owner', to: 'log', label: 'append', tone: 'good' }],
      `${sc.side === 'W' ? 'White' : 'Black'} plays ${sc.move} (ply ${ply}). The server received it ${s1(elapsed)} after the turn began (thinking + network), subtracts a lag credit of ${r.credit} ms${rtt(sc.side) > MAX_CREDIT_MS ? ` (capped; the real RTT is ${rtt(sc.side)} ms)` : ''} and charges ${s1(r.used)}. It validates, appends to the durable move log and only then broadcasts.`,
      ply === 2 && rttMs > MAX_CREDIT_MS ? `Black's link is ${rttMs} ms but the credit is capped at ${MAX_CREDIT_MS} ms. Why cap it?` : undefined,
    );

    if (scenario === 'reconnect' && ply === 4) {
      snap(
        { black: 'warn', gw: 'warn' },
        [],
        'Black\'s phone switches from Wi-Fi to 4G: the socket drops before the acknowledgement for ply 4 arrived. Black\'s client cannot tell whether b8c6 was accepted. Black\'s clock is not running (it is White\'s turn), and White keeps thinking.',
        'Black reconnects and resends {ply: 4, move: b8c6}. Will the server apply it twice?',
      );
      log.push({ ply: 4, side: 'B', move: 'b8c6 (resent)', note: 'old ply → snapshot', tone: 'warn' });
      snap(
        { black: 'accent', gw: 'accent', owner: 'good' },
        [{ from: 'black', to: 'gw', label: 'resume + ply 4', tone: 'warn' }, { from: 'owner', to: 'gw', label: 'snapshot', tone: 'good' }],
        'Black reconnects (backoff + jitter) with resume {gameId, lastPly: 3} and resends ply 4. The owner expects ply 5, so ply 4 is a duplicate: it is ignored and Black gets a snapshot (FEN, moves, both clocks, pending offers), not a replay of every event.',
      );
      log.push({ ply: 7, side: 'W', move: 'f1b5 (ply 7?)', note: 'future ply → rejected', tone: 'bad' });
      snap(
        { white: 'bad', owner: 'bad' },
        [{ from: 'white', to: 'gw', label: 'ply 7', tone: 'bad' }],
        'A buggy client sends ply 7 while ply 5 is expected. A future ply is impossible, so it is rejected. Ply numbers make retries and stale messages harmless.',
      );
    }
  }
  result = 'game continues';
  snap(
    { owner: 'good' },
    [],
    `Clocks after six plies: White ${s1(clocks[0])}, Black ${s1(clocks[1])}. ${
      rttMs > MAX_CREDIT_MS ? `Black's slow link still costs ${s1((rttMs - MAX_CREDIT_MS) * 3)} over three moves, but the cap keeps a lying client from claiming free time.` : 'Black\'s lag was fully credited, so a slow mobile link is not a handicap.'
    } The move log is the durability point; the full game document is written when it ends.`,
  );
  return frames;
}
