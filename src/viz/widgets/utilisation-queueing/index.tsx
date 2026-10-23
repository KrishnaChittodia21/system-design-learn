import { useState } from "react";
import { Choice, Slider, VizFrame, useFrames, useSimulation } from "../../core";
import { meta } from "./meta";
import {
  DEFAULT_PARAMS,
  LEVELS,
  WINDOW_S,
  simulate,
  theoryW,
  type Params,
} from "./sim";
import "./utilisation-queueing.css";

// chart geometry (left) and pool panel (right)
const CX0 = 52;
const CX1 = 318;
const CY0 = 34;
const CY1 = 250;
const PX = 346;

function niceCeil(v: number) {
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}
const fmt = (x: number) =>
  x >= 100
    ? Math.round(x).toLocaleString("en-US")
    : x.toFixed(1).replace(/\.0$/, "");

export default function UtilisationQueueingViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const S = params.serviceMs;
  const c = params.servers;
  const all = f.stats;
  const s = all[f.level];
  const yMax = niceCeil(Math.max(...all.map((x) => x.p99Ms)));
  const xOf = (rho: number) => CX0 + rho * (CX1 - CX0);
  const yOf = (ms: number) => CY1 - (Math.min(ms, yMax) / yMax) * (CY1 - CY0);
  const curve: string[] = [];
  for (let rho = 0; rho <= 0.985; rho += 0.005) {
    const w = theoryW(c, rho) * S;
    curve.push(
      `${curve.length ? "L" : "M"}${xOf(rho).toFixed(1)},${yOf(w).toFixed(1)}`,
    );
    if (w > yMax) break;
  }
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * yMax);
  const seen = f.summary ? all : all.slice(0, f.level + 1);

  // pool panel
  const cols = Math.min(c, 4);
  const box = c > 4 ? 28 : 36;
  const queued = Math.round(s.Lq);
  const maxN = Math.max(
    ...all.map((x) => Math.max(...x.trace.map((p) => p.n))),
    c + 1,
  );
  const SPX0 = PX + 6;
  const SPX1 = 592;
  const SPY0 = 140;
  const SPY1 = 204;
  const spark = s.trace
    .map(
      (p, k) =>
        `${k ? "L" : "M"}${(SPX0 + (p.t / WINDOW_S) * (SPX1 - SPX0)).toFixed(1)},${(SPY1 - (p.n / maxN) * (SPY1 - SPY0)).toFixed(1)}`,
    )
    .join(" ");
  const capY = SPY1 - (c / maxN) * (SPY1 - SPY0);

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice
            label="Servers sharing one queue"
            value={String(c) as "1" | "2" | "4" | "8"}
            options={[1, 2, 4, 8].map((n) => ({
              value: String(n) as "1" | "2" | "4" | "8",
              label: String(n),
            }))}
            onChange={(v) => setParams((p) => ({ ...p, servers: Number(v) }))}
          />
          <Slider
            label="Service time S"
            value={S}
            min={5}
            max={100}
            step={5}
            onChange={(v) => setParams((p) => ({ ...p, serviceMs: v }))}
            format={(v) => `${v} ms`}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: "var(--accent)" }} />{" "}
          theory: mean W = S·(1 + C/(c(1−ρ)))
          <span
            className="viz-key"
            style={{ background: "var(--good)" }}
          />{" "}
          measured mean
          <span className="viz-key" style={{ background: "var(--bad)" }} />{" "}
          measured p99
          <span>
            {(40_000).toLocaleString("en-US")} simulated requests per level ·
            Poisson arrivals
          </span>
        </>
      }
    >
      <div className="uq-split">
        <svg
          viewBox="0 0 334 300"
          className="viz-svg uq-chart"
          role="img"
          aria-label={`Utilisation ${Math.round(s.rho * 100)}% with ${c} server${c > 1 ? "s" : ""}: ${fmt(s.lambda)} requests per second, mean latency ${fmt(s.meanMs)} ms, p99 ${fmt(s.p99Ms)} ms, ${fmt(s.L)} requests in the system on average.`}
        >
          {/* ---- latency vs utilisation chart ---- */}
          <text x={CX0} y={18} className="viz-node-label">
            Latency vs utilisation ρ
          </text>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={CX0}
                x2={CX1}
                y1={yOf(t)}
                y2={yOf(t)}
                stroke="var(--border)"
                strokeDasharray={t ? "2 4" : undefined}
              />
              <text
                x={CX0 - 6}
                y={yOf(t) + 4}
                textAnchor="end"
                className="viz-label"
                style={{ fontSize: 10.5 }}
              >
                {fmt(t)}
              </text>
            </g>
          ))}
          <text
            x={10}
            y={CY0 - 8}
            className="viz-label"
            style={{ fontSize: 10.5 }}
          >
            ms
          </text>
          {[0, 0.25, 0.5, 0.75, 1].map((r) => (
            <text
              key={r}
              x={xOf(r)}
              y={CY1 + 16}
              textAnchor="middle"
              className="viz-label"
              style={{ fontSize: 10.5 }}
            >
              {r * 100}%
            </text>
          ))}
          {/* recommended planning band */}
          <rect
            x={xOf(0.6)}
            y={CY0}
            width={xOf(0.7) - xOf(0.6)}
            height={CY1 - CY0}
            fill="var(--good-soft)"
          />
          <text
            x={(xOf(0.6) + xOf(0.7)) / 2}
            y={CY0 + 12}
            textAnchor="middle"
            className="viz-label"
            style={{ fontSize: 9.5 }}
          >
            plan here
          </text>
          <line
            x1={CX0}
            x2={CX1}
            y1={yOf(S)}
            y2={yOf(S)}
            stroke="var(--ink-4)"
            strokeDasharray="5 3"
          />
          <text
            x={CX0 + 4}
            y={yOf(S) - 4}
            className="viz-label"
            style={{ fontSize: 9.5 }}
          >
            S = {S} ms
          </text>
          <path
            d={curve.join(" ")}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2.2}
          />
          <line
            x1={xOf(s.rho)}
            x2={xOf(s.rho)}
            y1={CY0}
            y2={CY1}
            stroke="var(--text)"
            strokeWidth={1.2}
            strokeDasharray="3 3"
          />
          {seen.map((x) => (
            <g key={x.rho} opacity={x === s ? 1 : 0.65}>
              <circle
                cx={xOf(x.rho)}
                cy={yOf(x.meanMs)}
                r={x === s ? 5 : 3.5}
                fill="var(--good)"
                stroke="var(--surface)"
                strokeWidth={1.5}
              />
              <circle
                cx={xOf(x.rho)}
                cy={yOf(x.p99Ms)}
                r={x === s ? 5 : 3.5}
                fill="var(--bad)"
                stroke="var(--surface)"
                strokeWidth={1.5}
              />
            </g>
          ))}
          <text
            x={Math.min(xOf(s.rho) + 8, CX1 - 4)}
            y={Math.max(yOf(s.p99Ms) - 8, CY0 + 26)}
            textAnchor={xOf(s.rho) > CX1 - 60 ? "end" : "start"}
            style={{
              fontSize: 11,
              fontWeight: 700,
              fill: "var(--bad)",
              paintOrder: "stroke",
              stroke: "var(--surface-2)",
              strokeWidth: 3,
            }}
          >
            p99 {fmt(s.p99Ms)} ms
          </text>
          <text
            x={(CX0 + CX1) / 2}
            y={CY1 + 34}
            textAnchor="middle"
            className="viz-label"
            style={{ fontSize: 10.5 }}
          >
            levels: {LEVELS.map((l) => `${l * 100}%`).join(" · ")}
          </text>
        </svg>
        <svg viewBox="340 0 260 300" className="viz-svg uq-pool" aria-hidden>
          {/* ---- the pool ---- */}
          <text x={PX} y={18} className="viz-node-label">
            The pool at ρ = {Math.round(s.rho * 100)}%
          </text>
          <text x={PX} y={36} className="viz-label" style={{ fontSize: 10.5 }}>
            average: {(s.rho * c).toFixed(c === 1 ? 2 : 1)} busy · {fmt(s.Lq)} waiting
          </text>
          {Array.from({ length: c }, (_, k) => {
            const x = PX + (k % cols) * (box + 6);
            const y = 46 + Math.floor(k / cols) * (box + 6);
            return (
              <g key={k}>
                <rect
                  x={x}
                  y={y}
                  width={box}
                  height={box}
                  rx={6}
                  fill="var(--surface)"
                  stroke="var(--line-2)"
                />
                <rect
                  x={x + 1}
                  y={y + 1 + (box - 2) * (1 - s.rho)}
                  width={box - 2}
                  height={(box - 2) * s.rho}
                  rx={5}
                  fill="var(--accent)"
                  opacity={0.75}
                  style={{ transition: "y 0.35s ease, height 0.35s ease" }}
                />
              </g>
            );
          })}
          {/* queue dots */}
          {(() => {
            const qx = PX + cols * (box + 6) + 8;
            const rowsUsed = Math.ceil(c / cols);
            const qy = 46 + (rowsUsed * (box + 6) - 6) / 2;
            const shown = Math.min(queued, 12);
            return (
              <g>
                <text
                  x={qx}
                  y={qy - 12}
                  className="viz-label"
                  style={{ fontSize: 10 }}
                >
                  queue
                </text>
                <line x1={qx} x2={592} y1={qy} y2={qy} stroke="var(--border)" />
                {Array.from({ length: shown }, (_, k) => (
                  <circle
                    key={k}
                    cx={qx + 8 + k * 11}
                    cy={qy + 10}
                    r={4.2}
                    fill="var(--warn)"
                  />
                ))}
                <text
                  x={qx + 8 + shown * 11 + (shown ? 4 : 0)}
                  y={qy + 14}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    fill: queued ? "var(--warn)" : "var(--ink-3)",
                  }}
                >
                  {queued > 12
                    ? `+${queued - 12}`
                    : queued === 0
                      ? "empty"
                      : ""}
                </text>
              </g>
            );
          })()}
          {/* sparkline of number in system */}
          <text
            x={PX}
            y={SPY0 - 10}
            className="viz-label"
            style={{ fontSize: 10.5 }}
          >
            requests in system over {WINDOW_S}×S (peak{" "}
            {Math.max(...s.trace.map((p) => p.n))})
          </text>
          <rect
            x={SPX0}
            y={SPY0}
            width={SPX1 - SPX0}
            height={SPY1 - SPY0}
            fill="var(--surface)"
            stroke="var(--border)"
            rx={4}
          />
          <line
            x1={SPX0}
            x2={SPX1}
            y1={capY}
            y2={capY}
            stroke="var(--ink-4)"
            strokeDasharray="3 3"
          />
          <text
            x={SPX1 - 3}
            y={capY - 3}
            textAnchor="end"
            className="viz-label"
            style={{ fontSize: 9 }}
          >
            {c} = all servers busy
          </text>
          <path d={spark} fill="none" stroke="var(--warn)" strokeWidth={1.4} />
          {/* stats */}
          {[
            ["arrivals λ", `${fmt(s.lambda)}/s`],
            ["throughput", `${fmt(s.throughput)}/s`],
            [
              "L = λ×W",
              `${fmt((s.lambda * s.meanMs) / 1000)} (seen ${fmt(s.L)})`,
            ],
          ].map(([k, v], i) => (
            <g key={k}>
              <text
                x={PX}
                y={SPY1 + 20 + i * 16}
                className="viz-label"
                style={{ fontSize: 11 }}
              >
                {k}
              </text>
              <text
                x={592}
                y={SPY1 + 20 + i * 16}
                textAnchor="end"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "var(--f-mono)",
                }}
              >
                {v}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </VizFrame>
  );
}
