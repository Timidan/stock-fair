import { ASSETS } from "./chain";
import type { Market, Price } from "./data";
import { Flame } from "./Flame";

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

type Props = {
  prices: (Price | null)[];
  markets: (Market | null)[];
  shares: number[];
  burned: string[];
  returns: (number | null)[];
  winners: boolean[];
  selected: number | null;
  onSelect: (i: number) => void;
  flares: number[];
  pickable: boolean;
};

export function Altars({ prices, markets, shares, burned, returns, winners, selected, onSelect, flares, pickable }: Props) {
  return (
    <div className={`altars${pickable ? " pickable" : ""}`} role={pickable ? "radiogroup" : undefined} aria-label={pickable ? "Pick a stock" : undefined}>
      {ASSETS.map((a, i) => {
        const r = returns[i], m = markets[i];
        return (
          <button
            key={a.symbol}
            role={pickable ? "radio" : undefined}
            aria-checked={pickable ? selected === i : undefined}
            disabled={!pickable}
            className={`altar${selected === i ? " selected" : ""}${winners[i] ? " winner" : ""}`}
            onClick={() => onSelect(i)}
          >
            <span className="stage">
              <img className="brazier" src="/art/brazier.webp" alt="" draggable={false} />
              <span className="fire">
                <Flame heat={Math.min(1, shares[i] + (selected === i ? 0.12 : 0))} flare={flares[i]} label={`${burned[i]} $WIF burned on ${a.symbol}`} />
              </span>
            </span>
            <span className="symbol">{a.symbol}</span>
            <span className="name">{a.name}</span>
            <span className="price">{prices[i] ? `$${prices[i]!.price.toFixed(2)}` : "—"}</span>
            {r != null && <span className={`move ${r >= 0 ? "up" : "down"}`}>{pct(r * 100)}</span>}
            <span className="burned">{burned[i]} $WIF</span>
            {m && (
              <span className="stats">
                {m.change24h != null && <span>24h change<b className={m.change24h >= 0 ? "up" : "down"}>{pct(m.change24h)}</b></span>}
                <span>24h volume<b>{usd.format(m.volume24h)}</b></span>
                <span>Liquidity<b>{usd.format(m.liquidity)}</b></span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
