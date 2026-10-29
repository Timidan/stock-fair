#!/usr/bin/env bash
# Keeper smoke test on a fresh local fork: deploy, fund the sponsor, then run the keeper before, during and after a short round.
set -euo pipefail
cd "$(dirname "$0")/.."
L=http://127.0.0.1:8545
K0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # anvil's public test key
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168; USDG_POOL=0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca
T=(0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 0x322F0929c4625eD5bAd873c95208D54E1c003b2d 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C)
F=(0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 0x4A1166a659A55625345e9515b32adECea5547C38 0x319724394D3A0e3669269846abE664Cd621f9f6A)
FAIR=$(cd contracts && forge create src/StockFair.sol:StockFair 2>/dev/null --rpc-url $L --private-key $K0 --broadcast --constructor-args "[(${T[0]},${F[0]}),(${T[1]},${F[1]}),(${T[2]},${F[2]}),(${T[3]},${F[3]})]" | awk '/Deployed to/{print $3}')
cast rpc --rpc-url $L anvil_impersonateAccount $USDG_POOL >/dev/null; cast rpc --rpc-url $L anvil_setBalance $USDG_POOL 0x56BC75E2D63100000 >/dev/null
cast send --rpc-url $L --unlocked --from $USDG_POOL $USDG 'transfer(address,uint256)' $(cast wallet address $K0) 20000000 >/dev/null
NOW=$(cast block latest -f timestamp --rpc-url $L)
hm() { date -u -d @$1 +%H:%M; }
LOCK=$(( (NOW / 60 + 13) * 60 )); END=$(( LOCK + 120 ))   # lock > 10 min out: the keeper opens rounds only until 10 min before lock
export KEEPER_KEY=$K0 STOCK_FAIR=$FAIR RPC=$L POT_USDG=5 LOCK_UTC=$(hm $LOCK) END_UTC=$(hm $END)
echo "fair $FAIR lock $LOCK_UTC end $END_UTC"
node keeper/keeper.mjs; node keeper/keeper.mjs        # opens the round, then a no-op rerun
cast rpc --rpc-url $L evm_increaseTime $(( END - NOW + 30 )) >/dev/null; cast rpc --rpc-url $L evm_mine >/dev/null
node keeper/keeper.mjs                                # settles it (nobody voted: the whole pot rolls over)
echo "carry: $(cast call $FAIR 'carry()(uint256)' --rpc-url $L)"
