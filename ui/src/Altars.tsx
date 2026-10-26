import { ASSETS } from "./chain";
import type { Price } from "./data";
import { Flame } from "./Flame";

type Props = {
  prices: (Price | null)[];
  shares: number[];
  burned: string[];
  returns: (number | null)[];
  winners: boolean[];
  selected: number | null;
  onSelect: (i: number) => void;
  flares: number[];
};

export function Altars({ prices, shares, burned, returns, winners, selected, onSelect, flares }: Props) {
  return (
    <div className="altars" role="radiogroup" aria-label="Pick a stock">
      {ASSETS.map((a, i) => {
        const r = returns[i];
        return (
          <button
            key={a.symbol}
            role="radio"
            aria-checked={selected === i}
            className={`altar${selected === i ? " selected" : ""}${winners[i] ? " winner" : ""}`}
            onClick={() => onSelect(i)}
          >
            <span className="stage">
              <img className="brazier" src="/art/brazier.webp" alt="" draggable={false} />
              <span className="fire">
                <Flame heat={shares[i]} flare={flares[i]} label={`${burned[i]} $WIF burned on ${a.symbol}`} />
              </span>
            </span>
            <span className="symbol">{a.symbol}</span>
            <span className="name">{a.name}</span>
            <span className="price">{prices[i] ? `$${prices[i]!.price.toFixed(2)}` : "—"}</span>
            {r != null && <span className={`move ${r >= 0 ? "up" : "down"}`}>{`${r >= 0 ? "+" : ""}${(r * 100).toFixed(2)}%`}</span>}
            <span className="burned">{burned[i]} $WIF</span>
          </button>
        );
      })}
    </div>
  );
}
