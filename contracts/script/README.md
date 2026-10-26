# Local replay feeds

`test/mocks/ReplayFeed.sol` is only for an Anvil demo fork. Never deploy it to mainnet: `push(int256 answer,uint256 updatedAt)` is unrestricted and accepts arbitrary historical timestamps. Answers have 8 decimals. Round ids start at `(1 << 64) + 1`; unknown ids return five zeros. There is no constructor-initialized storage.

From `contracts/`, start a fresh local fork in a separate terminal:

```sh
anvil --host 127.0.0.1 --fork-url https://rpc.mainnet.chain.robinhood.com
```

Then replace the four feed proxies' runtime code locally. `anvil_setCode` preserves existing storage, so reset the replay counter in slot 0 at each proxy. Do this once on a fresh demo fork, before pushing rounds:

```sh
forge build
REPLAY_CODE=$(forge inspect test/mocks/ReplayFeed.sol:ReplayFeed deployedBytecode)
for FEED in \
  0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 \
  0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 \
  0x4A1166a659A55625345e9515b32adECea5547C38 \
  0x319724394D3A0e3669269846abE664Cd621f9f6A
do
  cast rpc --rpc-url http://127.0.0.1:8545 anvil_setCode "$FEED" "$REPLAY_CODE"
  cast rpc --rpc-url http://127.0.0.1:8545 anvil_setStorageAt "$FEED" \
    0x0000000000000000000000000000000000000000000000000000000000000000 \
    0x0000000000000000000000000000000000000000000000000000000000000000
done
```

Push a price using an unlocked Anvil account; repeat for each feed and each demo boundary, using your demo's timestamps:

```sh
cast send --rpc-url http://127.0.0.1:8545 --unlocked \
  --from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 \
  'push(int256,uint256)' 10000000000 1792764000
cast call --rpc-url http://127.0.0.1:8545 \
  0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 \
  'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
```

The allowlisted token/feed addresses remain unchanged. This replaces oracle behavior only; set up USDG funding, WIF balances, approvals and the local round separately. Restart Anvil to discard the replay data and restore the upstream proxies.
