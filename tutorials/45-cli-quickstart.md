# Tutorial 45: The `pump` CLI in ten minutes

> Go from `npm install` to reading live mainnet state, quoting a trade, launching a token with a vanity mint, and wiring the whole thing into a shell script. No wallet needed for the first half.

**Prerequisites:** Node.js 18+. Nothing else.
**You will build:** a working command-line workflow for inspecting, trading, and launching Pump tokens, plus a price-alert script.
**Related:** [CLI reference](../docs/cli.md), [Getting started with the SDK](../docs/getting-started.md)

---

## 1. Install

```bash
npm install -g @nirholas/pump-sdk
pump --version
```

Prefer not to install globally? Every command below works with `npx -p @nirholas/pump-sdk pump ...`.

Run `pump` with no arguments and it teaches instead of dumping flags:

```
pump the Pump protocol from your terminal
────────────────────────

  Inspect a token (no wallet needed)
    pump curve <mint>              price, market cap, graduation progress
    pump quote buy <mint> --sol 1  what 1 SOL buys, fees and impact included
    pump watch <mint>              live dashboard, refreshes every 5s
  ...
```

## 2. Check your setup

```bash
pump doctor
```

```
  ✔ RPC reachable (246 ms)
      https://api.mainnet-beta.solana.com at slot 437,077,436

  ✔ Pump protocol readable
      global 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf decoded, authority FFWtr...

  ✖ Wallet loaded
      No keypair found at /home/you/.config/solana/id.json
      Read commands work without a wallet. To trade, run `solana-keygen new` ...
```

A missing wallet is expected at this point. Reads do not need one.

## 3. Read a token

Pick any Pump mint (they conventionally end in `pump`) and look at it:

```bash
export MINT=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump
pump curve $MINT
```

Three numbers matter most:

- **Market cap** drives the fee tier. Pump fees step down as a token grows, so the same trade costs a different percentage at different sizes.
- **Graduation** is the share of the 793.1M curve tokens that have been sold. At 100% the token migrates to a PumpAMM pool.
- **SOL to graduate** is what it would cost, right now, to buy every remaining token and trigger that migration.

If the token has already graduated, the command notices, reads the AMM pool, and prices it from real pool liquidity instead of reporting the zeroed-out curve.

## 4. Quote before you trade

Never trade on the spot price. Quote the actual order:

```bash
pump quote buy $MINT --sol 1
```

```
  You spend        1 SOL
  You receive      33.81M tokens
  Effective price  0.000000029 SOL per token
  Fees             0.012346 SOL included in the spend
  Price impact     6.69%
  Price before     0.000000028282 SOL per token
  Price after      0.000000030176 SOL per token

  ! This trade moves the price by 6.69%. Split it into smaller buys to pay less.
```

**Effective price** is what you actually pay per token once impact and fees are applied. It is always worse than the spot price, and on a thin curve it is dramatically worse. That gap is the entire reason to quote first.

Compare sizes to find where impact starts to hurt:

```bash
for sol in 0.1 0.5 1 5; do
  printf "%-5s " "$sol"
  pump quote buy $MINT --sol $sol --json | jq -r '"\(.tokensOutUi | floor) tokens, \(.priceImpactBps/100)% impact"'
done
```

## 5. Set up a wallet

```bash
solana-keygen new --outfile ~/.pump/trading.json
pump config set keypair ~/.pump/trading.json
pump config set rpcUrl https://your-dedicated-endpoint.example.com
pump config list
pump doctor
```

Fund the wallet, then confirm `pump doctor` shows all four checks green. A dedicated RPC is worth setting up now: the public endpoint is shared and throttled, and `doctor` warns when latency crosses two seconds.

## 6. Your first trade

```bash
pump buy $MINT --sol 0.05
```

Nothing is sent yet. The CLI checks your balance, builds the instructions, simulates the transaction, and shows you the terms:

```
Buy on bonding curve simulated OK
──────────────────────────────────

  Token          <mint>
  Spending       0.05 SOL
  Expected       1.7M tokens
  Price impact   0.35%
  Slippage       1%
  Payer          <your wallet>
  Compute units  61432 used of 300000 requested

Send this transaction? [y/N]
```

Answer `n` the first time and confirm nothing happened. Then run it for real.

Want the simulation without the prompt? `--simulate` stops right there and sends nothing:

```bash
pump buy $MINT --sol 0.05 --simulate
```

Exiting a position:

```bash
pump sell $MINT --percent 50    # take half off
pump sell $MINT --all           # sell out and reclaim the token account rent
```

`--all` is not just `--percent 100`: it also closes the associated token account, returning the ~0.002 SOL of rent that would otherwise sit there forever.

## 7. Launch a token

First, grind a mint address ending in `pump`:

```bash
pump vanity --suffix pump
```

```
  Prefix    any
  Suffix    pump
  Case      sensitive
  Expected  11,316,496 attempts on average

✔ Found 8ySri4NPaCHFHn4JfDzLjiBemn9ktk6FEZamMDkupump

  Attempts  9,204,113
  Duration  62.4s
  Rate      147,502/s
  Saved to  /home/you/.pump/mints/8ySri...pump.json mode 0600
```

Then upload your metadata JSON somewhere (IPFS, Arweave, any host). It looks like this, and the **image URL lives inside it**:

```json
{
  "name": "My Token",
  "symbol": "MTK",
  "description": "What this token is.",
  "image": "https://your-host.example.com/image.png"
}
```

Launch, taking the first buy atomically in the same transaction so nobody can front-run you into your own launch:

```bash
pump create \
  --name "My Token" \
  --symbol MTK \
  --uri https://your-host.example.com/metadata.json \
  --mint-keypair ~/.pump/mints/8ySri...pump.json \
  --buy 0.5
```

Passing an image URL to `--uri` instead of the metadata JSON is the most common launch mistake there is, and it is unfixable afterwards because the mint is permanent. The CLI checks the URL shape, but it cannot check what is behind it: open the URL and confirm you see JSON before you launch.

## 8. Collect what you are owed

Creator fees accrue every time anyone trades a token you launched, across both the bonding curve program and PumpAMM:

```bash
pump fees
pump fees claim
```

Volume incentives accrue from your own trading and settle a day in arrears:

```bash
pump incentives
pump incentives claim
```

## 9. Script it

Every command takes `--json`, and in that mode stdout carries only the object, so pipes are always safe.

A graduation alert:

```bash
#!/usr/bin/env bash
# alert.sh <mint> — notify once the token is 90% of the way to graduating.
set -euo pipefail
MINT="$1"

while true; do
  snapshot=$(pump curve "$MINT" --json)
  bps=$(jq -r '.graduation.progressBps' <<< "$snapshot")
  cap=$(jq -r '.marketCapSol' <<< "$snapshot")

  printf '%s  %s%%  %s SOL\n' "$(date -u +%H:%M:%S)" "$((bps / 100))" "$cap"

  if [ "$bps" -ge 9000 ]; then
    echo "ALERT: $MINT is $((bps / 100))% to graduation"
    break
  fi
  sleep 30
done
```

A trade log from a transaction:

```bash
pump events "$SIGNATURE" --json \
  | jq -r '.events[] | select(.type=="trade")
           | "\(if .data.isBuy then "BUY " else "SELL" end) \(.data.solAmount) lamports  \(.data.user)"'
```

A live price feed, one JSON object per poll:

```bash
pump watch "$MINT" --json --interval 10 | jq -r --unbuffered '"\(.at)  \(.marketCapSol) SOL"'
```

Note that amounts come through twice: `marketCapLamports` as an exact integer string in the chain's own units, and `marketCapSol` as a float for convenience. Use the string wherever precision matters, since large `BN` values do not survive JSON's number type.

## 10. Where the CLI ends and the SDK begins

The CLI is a thin shell over the SDK's builders. The moment you want to do something it does not do (batch across many mints, run a strategy, sit inside a server), drop into TypeScript with the same primitives:

```typescript
import { Connection } from "@solana/web3.js";
import { OnlinePumpSdk } from "@nirholas/pump-sdk";

const sdk = new OnlinePumpSdk(new Connection(process.env.PUMP_RPC_URL!));
const summary = await sdk.fetchBondingCurveSummary(process.env.MINT!);

console.log(summary.progressBps / 100, "% to graduation");
```

That is the same call `pump curve` makes. Continue with [Getting started with the SDK](../docs/getting-started.md) and [tutorial 11, building a trading bot](./11-trading-bot.md).

---

## What you learned

- Reading live curve, price, and pool state with no wallet and no configuration
- Why the effective price from a quote is the number that matters, not the spot price
- The simulate-then-confirm path every trade goes through, and how to dry-run it
- Grinding a vanity mint and launching with it atomically alongside the first buy
- Claiming creator fees and volume incentives across both programs
- Driving the whole thing from shell scripts through `--json`

## Next steps

- [CLI reference](../docs/cli.md) for every flag and command
- [Tutorial 05: bonding curve math](./05-bonding-curve-math.md) for what the quote numbers mean
- [Tutorial 11: building a trading bot](./11-trading-bot.md) to go from shell to service
- [Tutorial 13: vanity addresses](./13-vanity-addresses.md) for the faster multi-threaded grinders
