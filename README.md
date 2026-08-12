# open-defi-data

A free, daily-updated dataset of DeFi protocol TVL, yield pool APY, and
stablecoin supply — pulled directly from [DefiLlama](https://defillama.com)'s
free, keyless public API and normalized into stable schemas.

Current snapshot: **8,031 protocols**, **15,557 yield pools**, **416
stablecoins**, across **500+ chains** (last full run: see
`data/summary.json` for the live `generatedAt` timestamp and counts — this
number moves daily).

Data lives in [`data/`](data/):

- [`data/protocols.json`](data/protocols.json) / [`.csv`](data/protocols.csv)
  — every DeFi protocol DefiLlama tracks: name, category, chains, TVL, 1d/7d
  change, audits, per-chain TVL breakdown.
- [`data/yields.json`](data/yields.json) / [`.csv`](data/yields.csv) — every
  yield pool: project, chain, symbol, TVL, APY (base + reward), stablecoin
  flag, impermanent-loss risk, exposure type.
- [`data/stablecoins.json`](data/stablecoins.json) — stablecoin circulating
  supply (current, prev-day, prev-week, prev-month) and peg data.
- [`data/by-chain.json`](data/by-chain.json) — protocol TVL and pool counts
  aggregated per chain.
- [`data/top-yields.json`](data/top-yields.json) — highest-APY pools above a
  stated minimum TVL floor (see below — this filters out APY-on-a-shoebox
  noise, it is not a recommendation).
- [`data/summary.json`](data/summary.json) — counts, totals, run stats.
- [`data/README.md`](data/README.md) — full schema doc.

A GitHub Actions workflow (`.github/workflows/update.yml`) re-runs the
fetcher every day and commits whatever changed. No manual updates.

## Why this exists

DefiLlama already runs the hard part — pulling TVL data from hundreds of
on-chain adapters — and publishes the result through a free, unauthenticated
JSON API. This repo just fetches three of those endpoints daily, normalizes
field names and types into one consistent schema, adds a couple of
aggregates people actually ask for (per-chain rollups, a filtered top-yields
list), and commits the result as plain JSON/CSV so you don't need to write
your own DefiLlama client to get a CSV.

## Source and attribution

All data in this repository is sourced from **[DefiLlama](https://defillama.com)**
via its public API:

- `https://api.llama.fi/protocols`
- `https://yields.llama.fi/pools`
- `https://stablecoins.llama.fi/stablecoins`

DefiLlama's API is free and requires no API key. We could not find a
published data license or terms-of-use page as of this writing (their docs
site returns 403 to automated fetches), so this repository credits
DefiLlama explicitly here and in every output file's `summary.json.source`
field, and links back to them. If you build on this data, please credit
DefiLlama as the primary source, not this repo.

The code in this repository (the fetcher script, workflow, and aggregation
logic) is MIT licensed — see [`LICENSE`](LICENSE). The underlying TVL/yield/
stablecoin data belongs to DefiLlama and the protocols it tracks.

## Sample rows (from a live run)

`data/protocols.json`:

```json
{
  "id": "182",
  "name": "Lido",
  "slug": "lido",
  "category": "Liquid Staking",
  "chains": ["Ethereum", "Solana", "Moonbeam", "Moonriver", "Terra"],
  "tvl": 17846888242.72584,
  "change1d": 1.1389653456390931,
  "change7d": -1.0803332053069141,
  "url": "https://lido.fi/",
  "description": "Liquid staking for Ethereum and Polygon. Daily staking rewards, no lock ups.",
  "audits": "2",
  "twitter": "LidoFinance",
  "listedAt": null,
  "chainTvls": { "Ethereum": 17842942737.24442, "Solana": 3916694.309307962 },
  "scrapedAt": "2026-08-12T21:38:18.904Z"
}
```

`data/yields.json`:

```json
{
  "poolId": "747c1d2a-c668-4682-b9f9-296708a3dd90",
  "project": "lido",
  "chain": "Ethereum",
  "symbol": "STETH",
  "tvlUsd": 17835460337,
  "apy": 2.174,
  "apyBase": 2.174,
  "apyReward": null,
  "apyPct1D": -0.009,
  "apyPct7D": -0.027,
  "stablecoin": false,
  "ilRisk": "no",
  "exposure": "single",
  "poolMeta": null,
  "outlier": false,
  "scrapedAt": "2026-08-12T21:38:19.332Z"
}
```

## Using the data

### curl

```bash
curl -s https://raw.githubusercontent.com/ConorsCode/open-defi-data/main/data/yields.json | jq '.[0]'
```

### pandas

```python
import pandas as pd
yields = pd.read_json("https://raw.githubusercontent.com/ConorsCode/open-defi-data/main/data/yields.json")
yields[(yields.chain == "Ethereum") & (yields.tvlUsd > 1_000_000)].sort_values("apy", ascending=False).head(10)
```

### JavaScript

```js
const protocols = await fetch(
  "https://raw.githubusercontent.com/ConorsCode/open-defi-data/main/data/protocols.json"
).then((r) => r.json());

const topByTvl = [...protocols].sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0)).slice(0, 10);
```

## Accuracy and honesty rules (read before using this for anything real)

- **This is not financial advice.** Nothing in this dataset, its README, or
  its aggregates is a recommendation to buy, sell, deposit into, or avoid
  any protocol, pool, or asset. `data/top-yields.json` is a filtered list,
  not a suggestion.
- **APY figures are point-in-time snapshots, not predictions.** DeFi yields
  are frequently driven by temporary incentive emissions, are highly
  volatile, and can and do drop to zero or go negative (via impermanent
  loss) with no warning. A high APY at scrape time says nothing about
  tomorrow's APY.
- **High APY on a small pool is noise, not signal.** `top-yields.json`
  filters to pools with `tvlUsd >= $1,000,000` for exactly this reason —
  below that, a handful of dollars of incentive rewards can produce a
  triple-digit annualized number.
- **`null` means genuinely unknown**, never `0`. If DefiLlama doesn't report
  a field for a given protocol or pool, this dataset reports `null`, not a
  fabricated zero.
- **TVL and APY can be wrong at the source.** DefiLlama aggregates from
  hundreds of protocol-submitted adapters; mispriced tokens, double-counted
  TVL, or an adapter bug on DefiLlama's end will flow straight through to
  this dataset. Cross-check anything you plan to act on.

## Limitations

- **Fixed to what DefiLlama's public API exposes.** No historical time
  series (only the current snapshot per pool/protocol), no on-chain
  verification, no data DefiLlama itself doesn't have.
- **Snapshot timing.** Every row reflects the moment `scrapedAt` records.
  TVL and APY can move significantly within a single day.
- **No governance data in the free dataset.** Snapshot.org DAO governance
  proposals are supported by the paid actor below (per-space, on demand)
  but are not part of this daily snapshot, to keep this repo's scope to
  DefiLlama's three core endpoints.
- **Chain list is large (500+) because DefiLlama tracks long-tail chains.**
  `data/by-chain.json` filters out DefiLlama's internal TVL-breakdown
  pseudo-keys (`-borrowed`, `-staking`, `-vesting`, `-pool2`, `-treasury`)
  so they aren't double-counted or mistaken for real chains — but it does
  not filter chains down to only "major" ones.

## If you need on-demand filtering instead of a daily snapshot

This repo's fetcher pulls the same fixed set of fields for every protocol,
pool, and stablecoin, once a day. If you need to filter on demand — by
chain, category, project, minimum TVL, minimum APY, stablecoin-only, or
pull DAO governance proposals from a specific Snapshot space — that's a
separate, paid tool: the
[DeFi Data Scraper on Apify](https://apify.com/studious_allergy_mig/defi-data-scraper).
It hits the same DefiLlama endpoints plus Snapshot's GraphQL API, applies
your filters server-side, and returns just the rows you asked for.

This repo and that actor share no code — the actor is a TypeScript project
with Apify SDK input validation and a dataset schema; this repo is a few
hundred lines of plain Node meant to be read in one sitting.

## License

MIT — see [`LICENSE`](LICENSE). The code is MIT licensed; the underlying
DeFi data is sourced from DefiLlama and belongs to DefiLlama and the
protocols it tracks.

## Related open datasets

Part of a small set of free, daily-refreshed datasets built the same way:
zero-dependency Node fetcher, GitHub Actions refresh, public endpoints only.

- **[open-jobs-data](https://github.com/ConorsCode/open-jobs-data)** — job postings from ~380 companies across nine ATS platforms.
