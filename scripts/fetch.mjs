#!/usr/bin/env node
// Standalone, zero-dependency fetcher for the open-defi-data dataset.
//
// Pulls DeFi protocol TVL, yield pool APY, and stablecoin supply data from
// DefiLlama's free, keyless public API, normalizes it into stable schemas,
// and writes JSON + CSV + aggregate files under data/.
//
// This dataset is a point-in-time snapshot, refreshed daily by GitHub
// Actions. It is NOT financial advice, NOT a recommendation, and APY figures
// in particular are volatile and often unsustainable — see README.md.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 700;
const FETCH_TIMEOUT_MS = 45000; // these endpoints return multi-MB payloads
const USER_AGENT = 'open-defi-data/1.0 (+https://github.com/ConorsCode/open-defi-data) polite-bot';

// Minimum TVL (USD) for a pool to be considered for data/top-yields.json.
// Stated plainly because high APY on a tiny pool is noise, not signal.
const TOP_YIELDS_MIN_TVL_USD = 1_000_000;
const TOP_YIELDS_COUNT = 100;

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

// NOTE: the abort timeout must stay armed until the response body has been
// fully read, not just until headers arrive. fetch() resolving only means
// headers are in; the body is read lazily via res.text(), and if we clear the
// timeout as soon as fetch() resolves, that body read has no timeout
// protection at all and can hang forever on a stalled connection. So we read
// the body *inside* the try block, still under the same AbortController, and
// only clear the timeout once that's done (success or failure). Every HTTP
// call in this file goes through this helper — no bare fetch() anywhere.
async function fetchWithRetryText(url, options = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(options.headers || {}) },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) {
        const text = await res.text();
        clearTimeout(timeout);
        return { notFound: true, status: res.status, text };
      }
      const text = await res.text();
      clearTimeout(timeout);
      return { text };
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_BASE_MS * 2 ** attempt + Math.random() * 300;
        await sleep(backoff);
        continue;
      }
    }
  }
  throw lastErr ?? new Error('fetch failed');
}

async function getJson(url) {
  const { text, notFound, status } = await fetchWithRetryText(url);
  if (notFound) return { notFound: true, status };
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { notFound: true, status: 'bad-json' };
  }
}

async function postJson(url, body) {
  const { text, notFound, status } = await fetchWithRetryText(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (notFound) return { notFound: true, status };
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { notFound: true, status: 'bad-json' };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

async function fetchProtocols() {
  const { data, notFound, status } = await getJson('https://api.llama.fi/protocols');
  if (notFound || !Array.isArray(data)) {
    return { rows: [], error: `protocols fetch failed: ${status ?? 'unknown'}` };
  }
  const rows = data.map((p) => ({
    id: str(p.id),
    name: str(p.name),
    slug: str(p.slug),
    category: str(p.category),
    chains: Array.isArray(p.chains) ? p.chains : [],
    tvl: num(p.tvl),
    change1d: num(p.change_1d),
    change7d: num(p.change_7d),
    url: str(p.url),
    description: str(p.description),
    audits: str(p.audits),
    twitter: str(p.twitter),
    listedAt: p.listedAt ? new Date(p.listedAt * 1000).toISOString() : null,
    chainTvls: p.chainTvls && typeof p.chainTvls === 'object'
      ? Object.fromEntries(
          Object.entries(p.chainTvls)
            .filter(([k, v]) => typeof v === 'number' && Number.isFinite(v) && !CHAIN_SUFFIX_RE.test(k))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
        )
      : {},
    scrapedAt: nowIso(),
  }));
  return { rows, error: null };
}

async function fetchYields() {
  const { data, notFound, status } = await getJson('https://yields.llama.fi/pools');
  if (notFound || !data || !Array.isArray(data.data)) {
    return { rows: [], error: `yields fetch failed: ${status ?? 'unknown'}` };
  }
  const rows = data.data.map((p) => ({
    poolId: str(p.pool),
    project: str(p.project),
    chain: str(p.chain),
    symbol: str(p.symbol),
    tvlUsd: num(p.tvlUsd),
    apy: num(p.apy),
    apyBase: num(p.apyBase),
    apyReward: num(p.apyReward),
    apyPct1D: num(p.apyPct1D),
    apyPct7D: num(p.apyPct7D),
    stablecoin: typeof p.stablecoin === 'boolean' ? p.stablecoin : null,
    ilRisk: str(p.ilRisk),
    exposure: str(p.exposure),
    poolMeta: str(p.poolMeta),
    outlier: typeof p.outlier === 'boolean' ? p.outlier : null,
    scrapedAt: nowIso(),
  }));
  return { rows, error: null };
}

async function fetchStablecoins() {
  const { data, notFound, status } = await getJson(
    'https://stablecoins.llama.fi/stablecoins?includePrices=true'
  );
  if (notFound || !data || !Array.isArray(data.peggedAssets)) {
    return { rows: [], error: `stablecoins fetch failed: ${status ?? 'unknown'}` };
  }
  const rows = data.peggedAssets.map((s) => ({
    id: str(s.id),
    name: str(s.name),
    symbol: str(s.symbol),
    pegType: str(s.pegType),
    pegMechanism: str(s.pegMechanism),
    circulatingUsd: num(s.circulating?.peggedUSD),
    circulatingPrevDayUsd: num(s.circulatingPrevDay?.peggedUSD),
    circulatingPrevWeekUsd: num(s.circulatingPrevWeek?.peggedUSD),
    circulatingPrevMonthUsd: num(s.circulatingPrevMonth?.peggedUSD),
    price: num(s.price),
    chains: Array.isArray(s.chains) ? s.chains : [],
    scrapedAt: nowIso(),
  }));
  return { rows, error: null };
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

// DefiLlama's per-protocol chainTvls object mixes real chain names with
// pseudo-breakdown keys like "Ethereum-borrowed", "Arbitrum-staking",
// "Base-vesting", "Solana-pool2" — these are TVL components of a chain, not
// separate chains, and including them would double-count TVL and inflate the
// chain list. Filter to keys with no suffix.
const CHAIN_SUFFIX_RE = /-(borrowed|staking|vesting|pool2|treasury|liquidstaking|forks|offers|dcandsuppliedapy)$/i;

function buildByChain(protocols, yields) {
  const chains = new Map();
  const ensure = (name) => {
    if (!chains.has(name)) {
      chains.set(name, { chain: name, protocolTvlUsd: 0, protocolCount: 0, poolCount: 0, poolTvlUsd: 0 });
    }
    return chains.get(name);
  };
  for (const p of protocols) {
    for (const [chain, tvl] of Object.entries(p.chainTvls || {})) {
      if (CHAIN_SUFFIX_RE.test(chain)) continue;
      const entry = ensure(chain);
      entry.protocolTvlUsd += tvl;
      entry.protocolCount += 1;
    }
  }
  for (const y of yields) {
    if (!y.chain) continue;
    const entry = ensure(y.chain);
    entry.poolCount += 1;
    if (y.tvlUsd) entry.poolTvlUsd += y.tvlUsd;
  }
  return Array.from(chains.values()).sort((a, b) => b.protocolTvlUsd - a.protocolTvlUsd);
}

function buildTopYields(yields) {
  return yields
    .filter((y) => y.tvlUsd != null && y.tvlUsd >= TOP_YIELDS_MIN_TVL_USD && y.apy != null && !y.outlier)
    .sort((a, b) => b.apy - a.apy)
    .slice(0, TOP_YIELDS_COUNT);
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function toCsv(rows, headers, arrayFields = []) {
  const escape = (v, key) => {
    if (v === null || v === undefined) return '';
    if (arrayFields.includes(key)) {
      if (Array.isArray(v)) v = v.join('; ');
      else if (typeof v === 'object') v = JSON.stringify(v);
    } else if (typeof v === 'object') {
      v = JSON.stringify(v);
    }
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h], h)).join(','));
  }
  return lines.join('\n') + '\n';
}

async function writeJson(file, data) {
  await writeFile(path.join(ROOT, 'data', file), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(path.join(ROOT, 'data'), { recursive: true });

  const startedAt = Date.now();
  const errors = [];

  console.log('Fetching DefiLlama protocols, yields, and stablecoins...');

  const [protocolsResult, yieldsResult, stablecoinsResult] = await Promise.all([
    fetchProtocols().catch((err) => ({ rows: [], error: `protocols exception: ${err.message}` })),
    fetchYields().catch((err) => ({ rows: [], error: `yields exception: ${err.message}` })),
    fetchStablecoins().catch((err) => ({ rows: [], error: `stablecoins exception: ${err.message}` })),
  ]);

  for (const r of [protocolsResult, yieldsResult, stablecoinsResult]) {
    if (r.error) errors.push(r.error);
  }

  const protocols = protocolsResult.rows;
  const yields = yieldsResult.rows;
  const stablecoins = stablecoinsResult.rows;

  await writeJson('protocols.json', protocols);
  await writeFile(
    path.join(ROOT, 'data', 'protocols.csv'),
    toCsv(
      protocols,
      ['id', 'name', 'slug', 'category', 'chains', 'tvl', 'change1d', 'change7d', 'url', 'description', 'audits', 'twitter', 'listedAt', 'scrapedAt'],
      ['chains']
    ),
    'utf8'
  );

  await writeJson('yields.json', yields);
  await writeFile(
    path.join(ROOT, 'data', 'yields.csv'),
    toCsv(
      yields,
      ['poolId', 'project', 'chain', 'symbol', 'tvlUsd', 'apy', 'apyBase', 'apyReward', 'apyPct1D', 'apyPct7D', 'stablecoin', 'ilRisk', 'exposure', 'poolMeta', 'outlier', 'scrapedAt'],
      []
    ),
    'utf8'
  );

  await writeJson('stablecoins.json', stablecoins);

  const byChain = buildByChain(protocols, yields);
  await writeJson('by-chain.json', byChain);

  const topYields = buildTopYields(yields);
  await writeJson('top-yields.json', {
    minTvlUsd: TOP_YIELDS_MIN_TVL_USD,
    note: 'Highest-APY pools with tvlUsd >= minTvlUsd and outlier=false. This is a point-in-time snapshot, not a recommendation or investment advice — high APY frequently reflects high risk, incentive emissions that will taper, or unsustainable tokenomics. Always verify independently before acting on any figure here.',
    generatedAt: nowIso(),
    pools: topYields,
  });

  const elapsedMs = Date.now() - startedAt;

  const totalProtocolTvl = protocols.reduce((sum, p) => sum + (p.tvl || 0), 0);
  const totalStablecoinSupply = stablecoins.reduce((sum, s) => sum + (s.circulatingUsd || 0), 0);

  await writeJson('summary.json', {
    generatedAt: nowIso(),
    elapsedMs,
    source: 'DefiLlama (https://defillama.com) — api.llama.fi, yields.llama.fi, stablecoins.llama.fi',
    counts: {
      protocols: protocols.length,
      yieldPools: yields.length,
      stablecoins: stablecoins.length,
      chains: byChain.length,
    },
    totals: {
      protocolTvlUsd: totalProtocolTvl,
      stablecoinSupplyUsd: totalStablecoinSupply,
    },
    errors,
  });

  console.log(
    `Done in ${elapsedMs}ms — ${protocols.length} protocols, ${yields.length} yield pools, ${stablecoins.length} stablecoins.`
  );
  if (errors.length > 0) {
    console.error('Errors during this run:', errors);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
