# Pull each feed's real Chainlink rounds from the last ~36h on mainnet, for replay on the local fork.
import json, subprocess, sys, time
R = "https://rpc.mainnet.chain.robinhood.com"
FEEDS = {"AAPL": "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", "NVDA": "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
         "TSLA": "0x4A1166a659A55625345e9515b32adECea5547C38", "SPY": "0x319724394D3A0e3669269846abE664Cd621f9f6A"}
def call(addr, sig, *args):
    out = subprocess.check_output(["cast", "call", addr, sig, *map(str, args), "--rpc-url", R, "--json"], text=True)
    return json.loads(out)
since = time.time() - 36 * 3600
hist = {}
for sym, feed in FEEDS.items():
    rid, *_ = call(feed, "latestRoundData()(uint80,int256,uint256,uint256,uint80)")
    rid, rows = int(rid), []
    while len(rows) < 40:
        r = call(feed, "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)", rid)
        if int(r[3]) == 0 or int(r[3]) < since: break
        rows.append([int(r[1]), int(r[3])]); rid -= 1
    hist[sym] = rows[::-1]
    print(sym, len(rows), "rounds", rows[0][0] / 1e8 if rows else None, "->", rows[-1][0] / 1e8 if rows else None, file=sys.stderr)
json.dump(hist, open("history.json", "w"))
