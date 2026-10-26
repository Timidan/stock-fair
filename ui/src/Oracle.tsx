import { ASSETS } from "./chain";

export type Reading = { roundId: bigint; start: number[]; end: number[]; winnerMask: number; tx: string };

// The settlement record, carved on the stele: the product's real output is the centrepiece.
export function Oracle({ reading, txUrl }: { reading: Reading | null; txUrl: (h: string) => string }) {
  return (
    <section className="oracle" aria-labelledby="oracle-title">
      <div className="stele">
        <h2 id="oracle-title">{reading ? `Round ${reading.roundId} · the reading` : "The oracle's reading"}</h2>
        {reading ? (
          <table>
            <thead>
              <tr><th scope="col">Stock</th><th scope="col">Open</th><th scope="col">Close</th><th scope="col">Move</th></tr>
            </thead>
            <tbody>
              {ASSETS.map((a, i) => {
                const move = reading.end[i] / reading.start[i] - 1;
                const won = ((reading.winnerMask >> i) & 1) === 1;
                return (
                  <tr key={a.symbol} className={won ? "won" : ""}>
                    <th scope="row">{a.symbol}{won && " ✦"}</th>
                    <td>${reading.start[i].toFixed(2)}</td>
                    <td>${reading.end[i].toFixed(2)}</td>
                    <td>{move >= 0 ? "+" : ""}{(move * 100).toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p>When a round closes, Chainlink's last price before the bell is read for each stock and carved here. The biggest move wins.</p>
        )}
        {reading?.tx && <a href={txUrl(reading.tx)} target="_blank" rel="noreferrer">Settlement transaction</a>}
      </div>
      <ol className="steps">
        <li><span><b>Pick</b> a stock before the round locks.</span></li>
        <li><span><b>Burn</b> $WIF on it. Every $WIF is one vote, sent to the dead address.</span></li>
        <li><span><b>Split</b> the USDG pot with everyone who burned on the top stock, in proportion to their burn.</span></li>
      </ol>
    </section>
  );
}
