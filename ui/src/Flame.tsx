import { useEffect, useRef } from "react";

// A Doom-style fire automaton drawn as halftone dots (dot size = heat), to match the engravings.
// `heat` (0..1) is the column's share of $WIF burned; `flare` bumps briefly when someone burns.
const W = 30, H = 60, MAX = 36, CELL = 8;
const LIME = "#d4fc50", WHITE = "#f7f5f1";

export function Flame({ heat, flare, label }: { heat: number; flare: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const target = useRef(heat);
  const boost = useRef(0);
  target.current = heat;

  useEffect(() => {
    boost.current = 1;
  }, [flare]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const fire = new Uint8Array(W * H);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let level = target.current, raf = 0;

    const step = () => {
      level += (target.current - level) * 0.04;
      boost.current *= 0.97;
      // Even an empty altar keeps an ember; the sqrt keeps small shares visible.
      const strength = Math.min(1, 0.3 + 0.7 * Math.sqrt(level) + boost.current * 0.5);
      const decay = 1.5 - 0.3 * strength; // height comes mostly from strength: empty ≈ quarter, full ≈ top
      for (let x = 0; x < W; x++) {
        const edge = 1 - Math.abs(x - (W - 1) / 2) / (W / 2);
        fire[(H - 1) * W + x] = Math.random() < 0.8 ? Math.round(MAX * strength * Math.min(1, edge * 1.8)) : 0;
      }
      for (let y = 0; y < H - 1; y++)
        for (let x = 0; x < W; x++) {
          const r = Math.random();
          const nx = Math.min(W - 1, Math.max(0, x + Math.round(r * 2 - 1)));
          fire[y * W + nx] = Math.max(0, fire[(y + 1) * W + x] - Math.floor(r * decay + 0.4));
        }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const [color, lo, hi] of [[LIME, 0.06, 0.7], [WHITE, 0.7, 1.01]] as const) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const v = fire[y * W + x] / MAX;
            if (v < lo || v >= hi) continue;
            const cx = x * CELL + CELL / 2 + (y % 2) * (CELL / 2), cy = y * CELL + CELL / 2;
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, (CELL / 2) * Math.min(1, v * 1.25), 0, Math.PI * 2);
          }
        ctx.fill();
      }
    };

    if (still) {
      for (let i = 0; i < 120; i++) step();
      return;
    }
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 1000 / 30) { step(); last = t; } // 30 fps reads as fire and halves the cost
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} width={W * CELL + CELL / 2} height={H * CELL} className="flame" role="img" aria-label={label} />;
}
