import { useEffect, useState, type CSSProperties } from "react";
import { ASSETS } from "./chain";
import type { Market, Price } from "./data";
import { Flame } from "./Flame";

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

type Props = {
  prices: (Price | null)[];
  markets: (Market | null)[];
  shares: number[];
  burned: number[];
  returns: (number | null)[];
  winners: boolean[];
  selected: number | null;
  onSelect: (i: number) => void;
  onTap: () => void;
  flares: number[];
  pickable: boolean;
  ready: boolean;
};

export function Altars({ prices, markets, shares, burned, returns, winners, selected, onSelect, onTap, flares, pickable, ready }: Props) {
  const [peek, setPeek] = useState<number | null>(null);

  // Touch has no hover: a tap opens a stock's details, and a tap anywhere else closes them.
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!(e.target as Element).closest(".altar")) setPeek(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  return (
    <div className={`altars${pickable ? " pickable" : ""}`} role={pickable ? "radiogroup" : undefined} aria-label={pickable ? "Pick a stock" : undefined}>
      {ASSETS.map((a, i) => {
        const r = returns[i], m = markets[i], full = burned[i].toLocaleString("en-US", { maximumFractionDigits: 0 });
        return (
          <button
            key={a.symbol}
            role={pickable ? "radio" : undefined}
            aria-checked={pickable ? selected === i : undefined}
            aria-expanded={pickable ? undefined : peek === i}
            className={`altar${selected === i ? " selected" : ""}${winners[i] ? " winner" : ""}${peek === i ? " peek" : ""}`}
            onClick={() => {
              setPeek(peek === i ? null : i);
              if (pickable) onSelect(i);
              onTap();
            }}
            style={{ "--flame": a.color, "--logo": `url(/brand/stocks/${a.symbol.toLowerCase()}.svg)` } as CSSProperties}
          >
            <span className="stage">
              <span className="fire">
                <Flame heat={Math.min(1, shares[i] + (selected === i ? 0.12 : 0))} flare={flares[i]} color={a.color} ready={ready} delay={i * 220} total={compact.format(burned[i])} label={`${full} $WIF burned on ${a.symbol}`} />
              </span>
            </span>
            <span className="symbol"><i />{a.symbol}</span>
            <span className="price">{prices[i] ? `$${prices[i]!.price.toFixed(2)}` : "—"}</span>
            {r != null && <span className={`move ${r >= 0 ? "up" : "down"}`}>{pct(r * 100)}</span>}
            <span className="stats">
              <span className="name">{a.name}</span>
              <span>$WIF burned<b>{full}</b></span>
              {m?.change24h != null && <span>24h change<b className={m.change24h >= 0 ? "up" : "down"}>{pct(m.change24h)}</b></span>}
              {m && <span>24h volume<b>{usd.format(m.volume24h)}</b></span>}
              {m && <span>Liquidity<b>{usd.format(m.liquidity)}</b></span>}
              {m?.marketCap != null && <span>Market cap<b>{usd.format(m.marketCap)}</b></span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
