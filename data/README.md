# data/

This directory holds the current snapshot of the dataset, regenerated daily
by `.github/workflows/update.yml` running `scripts/fetch.mjs`. All data
originates from [DefiLlama](https://defillama.com)'s free public API — see
the root [`README.md`](../README.md#source-and-attribution) for attribution
details and accuracy rules.

## Files

- `protocols.json` / `protocols.csv` — every DeFi protocol.
- `yields.json` / `yields.csv` — every yield pool.
- `stablecoins.json` — stablecoin supply and peg data.
- `by-chain.json` — protocol TVL and pool counts aggregated per chain.
- `top-yields.json` — highest-APY pools with `tvlUsd >= minTvlUsd` (stated in
  the file itself) and `outlier: false`. Read the `note` field in that file
  before using it for anything — it is not a recommendation.
- `summary.json` — counts, totals, run duration, and any per-source errors
  from the last run.

## Schemas

### `protocols.json`

| Field | Type | Notes |
|---|---|---|
| `id` | string | DefiLlama's internal protocol ID |
| `name` | string | Display name |
| `slug` | string | DefiLlama URL slug |
| `category` | string \| null | e.g. "Liquid Staking", "Dexes", "CEX" |
| `chains` | array of strings | All chains the protocol is deployed on |
| `tvl` | number \| null | Total value locked, USD |
| `change1d` | number \| null | % change in TVL over 1 day |
| `change7d` | number \| null | % change in TVL over 7 days |
| `url` | string \| null | Protocol's own website |
| `description` | string \| null | |
| `audits` | string \| null | Number of audits DefiLlama has on record, as a string (DefiLlama's own type) |
| `twitter` | string \| null | Handle, no `@` |
| `listedAt` | string \| null | ISO timestamp DefiLlama first listed the protocol, when known |
| `chainTvls` | object | Top 20 chains by TVL for this protocol, `{chain: tvlUsd}`. Excludes DefiLlama's internal breakdown keys (`-borrowed`, `-staking`, `-vesting`, `-pool2`, `-treasury`) |
| `scrapedAt` | string | ISO timestamp of this fetch |

### `yields.json`

| Field | Type | Notes |
|---|---|---|
| `poolId` | string | DefiLlama pool UUID |
| `project` | string \| null | Protocol slug the pool belongs to |
| `chain` | string \| null | |
| `symbol` | string \| null | Pool's token symbol(s) |
| `tvlUsd` | number \| null | |
| `apy` | number \| null | Total APY (base + reward) |
| `apyBase` | number \| null | Base APY only |
| `apyReward` | number \| null | Reward/incentive APY only |
| `apyPct1D` | number \| null | Change in APY over 1 day, percentage points |
| `apyPct7D` | number \| null | Change in APY over 7 days, percentage points |
| `stablecoin` | boolean \| null | Whether the pool's underlying is a stablecoin per DefiLlama |
| `ilRisk` | string \| null | `"yes"` / `"no"`, impermanent-loss risk |
| `exposure` | string \| null | `"single"` or `"multi"` asset exposure |
| `poolMeta` | string \| null | Extra pool detail (e.g. fee tier) |
| `outlier` | boolean \| null | DefiLlama's own flag for statistically anomalous APY |
| `scrapedAt` | string | ISO timestamp of this fetch |

### `stablecoins.json`

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `symbol` | string | |
| `pegType` | string \| null | e.g. `"peggedUSD"` |
| `pegMechanism` | string \| null | e.g. `"fiat-backed"`, `"crypto-backed"`, `"algorithmic"` |
| `circulatingUsd` | number \| null | Current circulating supply, USD |
| `circulatingPrevDayUsd` | number \| null | |
| `circulatingPrevWeekUsd` | number \| null | |
| `circulatingPrevMonthUsd` | number \| null | |
| `price` | number \| null | Current market price, should be ~1.0 for a healthy USD peg |
| `chains` | array of strings | Chains this stablecoin is issued on |
| `scrapedAt` | string | ISO timestamp of this fetch |

### `by-chain.json`

| Field | Type | Notes |
|---|---|---|
| `chain` | string | |
| `protocolTvlUsd` | number | Sum of protocol TVL attributed to this chain |
| `protocolCount` | number | Number of protocols with any TVL on this chain |
| `poolCount` | number | Number of yield pools on this chain |
| `poolTvlUsd` | number | Sum of yield-pool TVL on this chain (a subset of, not additional to, protocol TVL — pools are typically inside a protocol already counted in `protocolTvlUsd`) |

### `top-yields.json`

Object with `minTvlUsd` (the floor applied), `note` (read this), `generatedAt`,
and `pools` (array, same row shape as `yields.json`, sorted by `apy` descending).

## Errors and partial runs

If one of the three source endpoints fails, `scripts/fetch.mjs` still writes
output for the sources that succeeded — one endpoint being down does not
block the other two. Check `summary.json.errors` for anything that failed on
the last run; a non-empty array there means that source's file was written
as an empty array/object as **a fetch failure**, not as "there is genuinely
no data."
