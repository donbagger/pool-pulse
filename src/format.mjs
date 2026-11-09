// Terminal output. Token symbols come from on-chain metadata that anyone can set, so every
// string from the API is stripped of control characters before it reaches a terminal.

// C0 controls, DEL, C1 controls (which include the 8-bit escape introducer) and bidi overrides.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g

export const clean = (s) => String(s ?? '').replace(UNSAFE, '')

export function usd(v) {
  if (v === null || v === undefined) return '-'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(2)}`
}

export function pct(v) {
  if (v === null || v === undefined) return '-'
  const r = Number(v.toFixed(2))
  if (r === 0) return '0.00%' // no "-0.00%" for a pool that barely moved
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}%`
}

export function table(pools, network) {
  if (pools.length === 0) return `No pools on ${clean(network)} matched. Try a lower --min-liquidity.`
  const rows = [
    ['#', 'Pair', 'DEX', 'Volume 24h', 'Liquidity', 'Change 24h', 'Txns 24h'],
    ...pools.map((p) => [
      String(p.rank),
      truncate(clean(p.pair), 24),
      truncate(clean(p.dex), 18),
      usd(p.volume_usd_24h),
      usd(p.liquidity_usd),
      pct(p.price_change_24h_pct),
      p.transactions_24h === null ? '-' : p.transactions_24h.toLocaleString('en-US'),
    ]),
  ]
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)))
  const right = new Set([0, 3, 4, 5, 6])
  const line = (r) => r.map((cell, c) => (right.has(c) ? cell.padStart(widths[c]) : cell.padEnd(widths[c]))).join('  ').trimEnd()
  return [line(rows[0]), ...rows.slice(1).map(line)].join('\n')
}

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}~` : s)
