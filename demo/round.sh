#!/usr/bin/env bash
# One full Stock Fair round on a local anvil fork of Robinhood Chain mainnet, in real time (~6 min).
# Prices are REAL Chainlink rounds from the last 36h (demo/history.json), replayed through ReplayFeed
# etched over the feed proxies on the fork only. Usage: anvil fork on :8545, then `bash demo/round.sh`;
# run `REUSE=1 bash demo/round.sh` afterwards for another round on the same deployment (shows the rollover).
set -euo pipefail
cd "$(dirname "$0")/.."
L=http://127.0.0.1:8545
# Anvil's public test keys (local fork only).
K0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
K=(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a)
SPONSOR=$(cast wallet address $K0)
WIF=0x5173b8eA6923c2d40267890D45C46a3480954773
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
PM=0x8366a39cc670b4001a1121b8f6a443a643e40951       # holds WIF on mainnet (Uniswap v4)
USDG_POOL=0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca # holds USDG on mainnet (WETH/USDG v3)
SYMS=(AAPL NVDA TSLA SPY)
TOKENS=(0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 0x322F0929c4625eD5bAd873c95208D54E1c003b2d 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C)
FEEDS=(0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 0x4A1166a659A55625345e9515b32adECea5547C38 0x319724394D3A0e3669269846abE664Cd621f9f6A)
say() { echo "[$(date +%H:%M:%S)] $*"; }
send() { cast send --rpc-url $L "$@" >/dev/null; }
hist() { python3 -c "import json,sys;h=json.load(open('demo/history.json'))['$1'];print(h[$2][0] if $2<len(h) else h[-1][0])"; }
nhist() { python3 -c "import json;print(len(json.load(open('demo/history.json'))['$1']))"; }
now() { cast block latest -f timestamp --rpc-url $L; }

if [ -z "${REUSE:-}" ]; then
say "1/7 etch replay feeds over the 4 Chainlink proxies (fork only) and post each stock's opening price"
(cd contracts && forge build >/dev/null 2>&1)
CODE=$(cd contracts && forge inspect ReplayFeed deployedBytecode 2>/dev/null)
T=$(now)
for i in 0 1 2 3; do
  cast rpc --rpc-url $L anvil_setCode ${FEEDS[$i]} $CODE >/dev/null
  cast rpc --rpc-url $L anvil_setStorageAt ${FEEDS[$i]} 0x0 0x0000000000000000000000000000000000000000000000000000000000000000 >/dev/null
  send --private-key $K0 ${FEEDS[$i]} 'push(int256,uint256)' $(hist ${SYMS[$i]} 0) $((T - 60))
done

say "2/7 deploy StockFair with the AAPL, NVDA, TSLA, SPY allowlist"
ALLOW="[(${TOKENS[0]},${FEEDS[0]}),(${TOKENS[1]},${FEEDS[1]}),(${TOKENS[2]},${FEEDS[2]}),(${TOKENS[3]},${FEEDS[3]})]"
FAIR=$(cd contracts && forge create src/StockFair.sol:StockFair 2>/dev/null --rpc-url $L --private-key $K0 --broadcast --constructor-args "$ALLOW" | awk '/Deployed to/{print $3}')
echo "$FAIR" > demo/.address
say "   StockFair at $FAIR"
  say "   watch it: http://localhost:5173/?rpc=$L&fair=$FAIR&poll=3000"

say "3/7 fund the sponsor with USDG and four voters with WIF (impersonating mainnet holders on the fork)"
for H in $PM $USDG_POOL; do cast rpc --rpc-url $L anvil_impersonateAccount $H >/dev/null; cast rpc --rpc-url $L anvil_setBalance $H 0x56BC75E2D63100000 >/dev/null; done
send --unlocked --from $USDG_POOL $USDG 'transfer(address,uint256)' $SPONSOR 100000000
for k in "${K[@]}"; do
  A=$(cast wallet address $k); cast rpc --rpc-url $L anvil_setBalance $A 0x56BC75E2D63100000 >/dev/null
  send --unlocked --from $PM $WIF 'transfer(address,uint256)' $A 5000000000000000000000000
  send --private-key $k $WIF 'approve(address,uint256)' $FAIR $(cast max-uint)
done

else
  FAIR=$(cat demo/.address)
  say "reusing StockFair at $FAIR (carry: $(cast call $FAIR 'carry()(uint256)' --rpc-url $L | cut -d' ' -f1) micro-USDG)"
  send --unlocked --from $USDG_POOL $USDG 'transfer(address,uint256)' $SPONSOR 100000000
fi

say "4/7 sponsor opens a round with 100 USDG (plus any carry), picks close in 150s, settles 300s later"
T=$(now); LOCK=$((T + 150)); END=$((LOCK + 300))
send --private-key $K0 $USDG 'approve(address,uint256)' $FAIR 100000000
ASSETS="[(${TOKENS[0]},${FEEDS[0]}),(${TOKENS[1]},${FEEDS[1]}),(${TOKENS[2]},${FEEDS[2]}),(${TOKENS[3]},${FEEDS[3]})]"
send --private-key $K0 $FAIR 'createRound((address,address)[],uint256,uint256,uint256)' "$ASSETS" $LOCK $END 100000000
ID=$(cast call $FAIR 'roundCount()(uint256)' --rpc-url $L | cut -d' ' -f1)
say "   round $ID is open"

say "5/7 voters burn WIF (watch the fires)"
vote() { send --private-key ${K[$1]} $FAIR 'vote(uint256,uint256,uint256)' $ID $2 ${3}000000000000000000; say "   voter $(( $1 + 1 )) burned ${3} WIF on ${SYMS[$2]}"; sleep 12; }
vote 0 0 600000; vote 1 2 1500000; vote 2 1 400000; vote 3 3 250000; vote 1 2 900000; vote 0 0 300000; vote 2 0 200000
latest_ids() { local out="["; for i in 0 1 2 3; do out+="$(cast call ${FEEDS[$i]} 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url $L | head -1 | cut -d' ' -f1),"; done; echo "${out%,}]"; }
S=$(latest_ids)  # the rounds current at the lock: nothing new is pushed until after it
while [ "$(now)" -lt "$LOCK" ]; do sleep 3; cast rpc --rpc-url $L evm_mine >/dev/null; done

say "6/7 picks locked; replaying the real 36h of Chainlink rounds into the window"
for i in 0 1 2 3; do
  n=$(nhist ${SYMS[$i]}); [ "$n" -gt 1 ] || continue
  for j in $(seq 1 $((n - 1))); do
    send --private-key $K0 ${FEEDS[$i]} 'push(int256,uint256)' $(hist ${SYMS[$i]} $j) $((LOCK + 10 + j * 240 / n))
  done
done
while [ "$(now)" -le "$END" ]; do sleep 3; cast rpc --rpc-url $L evm_mine >/dev/null; done

say "7/7 settle with Chainlink round proofs, then winners claim"
E=$(latest_ids)
send --private-key $K0 $FAIR 'settle(uint256,uint80[],uint80[])' $ID "$S" "$E"
for k in "${K[@]}"; do
  A=$(cast wallet address $k)
  OWED=$(cast call $FAIR 'claimable(uint256,address)(uint256)' $ID $A --rpc-url $L | cut -d' ' -f1)
  [ "$OWED" != "0" ] && send --private-key $k $FAIR 'claim(uint256)' $ID && say "   $A claimed $(python3 -c "print($OWED/1e6)") USDG"
done
say "carry for the next round: $(cast call $FAIR 'carry()(uint256)' --rpc-url $L | cut -d' ' -f1) micro-USDG"
say "done. burned WIF now at 0x...dEaD: $(cast call $WIF 'balanceOf(address)(uint256)' 0x000000000000000000000000000000000000dEaD --rpc-url $L | cut -d' ' -f2)"
