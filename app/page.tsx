import { createSupabaseClient } from '@/app/lib/supabase'
import { PredictionRow } from '@/app/lib/types'

export const dynamic = 'force-dynamic'

const MPT = 'America/Edmonton'

// ── Date helpers ──────────────────────────────────────────────────────────────

function mptDayBounds(): { start: string; end: string } {
  const now = new Date()
  const todayMPT = new Intl.DateTimeFormat('en-CA', {
    timeZone: MPT, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  // Verify offset: try MDT (UTC-6), fall back to MST (UTC-7)
  const midnightMDT = new Date(`${todayMPT}T00:00:00-06:00`)
  const checkMDT = new Intl.DateTimeFormat('en-CA', { timeZone: MPT }).format(midnightMDT)
  const start = checkMDT === todayMPT ? midnightMDT : new Date(`${todayMPT}T00:00:00-07:00`)
  const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtHourMPT(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

function fmtDateHourMPT(iso: string): string {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, month: 'short', day: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return `${date} ${time}`
}

function fmtTargetFull(iso: string): string {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, weekday: 'short', month: 'short', day: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return `${date} ${time} MPT`
}

function fmtUpdated(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso)) + ' MPT'
}

// ── Data fetches ──────────────────────────────────────────────────────────────

async function get1hAlert(): Promise<PredictionRow | null> {
  const { data, error } = await createSupabaseClient()
    .from('prediction_log')
    .select('id, predicted_at, target_hour, predicted_price_1h, spike_prob_1h')
    .eq('forecast_type', '1h')
    .order('predicted_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as PredictionRow[])[0] ?? null
}

async function get24hForecast(): Promise<PredictionRow[]> {
  const { start, end } = mptDayBounds()
  const { data, error } = await createSupabaseClient()
    .from('prediction_log')
    .select('id, target_hour, predicted_price, spike_probability')
    .eq('forecast_type', '24h')
    .gte('target_hour', start)
    .lt('target_hour', end)
    .order('target_hour', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as PredictionRow[]
}

async function getRecentAccuracy(): Promise<PredictionRow[]> {
  const { data, error } = await createSupabaseClient()
    .from('prediction_log')
    .select('id, target_hour, predicted_price, spike_probability, actual_price')
    .eq('forecast_type', '24h')
    .not('actual_price', 'is', null)
    .order('target_hour', { ascending: false })
    .limit(48)
  if (error) throw new Error(error.message)
  // Deduplicate: keep most recent prediction for each target_hour
  const all = (data ?? []) as unknown as PredictionRow[]
  const seen = new Set<string>()
  const out: PredictionRow[] = []
  for (const row of all) {
    if (!seen.has(row.target_hour)) {
      seen.add(row.target_hour)
      out.push(row)
    }
  }
  return out
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function alertBand(prob: number | null): {
  bg: string; border: string; label: string; labelColor: string; icon: string
} {
  if (prob === null)   return { bg: 'bg-zinc-900',   border: 'border-zinc-700', label: 'STANDBY',        labelColor: 'text-zinc-400', icon: '◌' }
  if (prob > 0.60)    return { bg: 'bg-red-950',     border: 'border-red-700',  label: 'SPIKE ALERT',    labelColor: 'text-red-400',  icon: '⚡' }
  if (prob > 0.30)    return { bg: 'bg-yellow-950',  border: 'border-yellow-700', label: 'ELEVATED RISK', labelColor: 'text-yellow-400', icon: '⚠' }
  return               { bg: 'bg-green-950',    border: 'border-green-800', label: 'MARKET NORMAL',  labelColor: 'text-green-400', icon: '✓' }
}

function riskLabel(prob: number): { text: string; cls: string } {
  if (prob > 0.60) return { text: 'Alert', cls: 'text-red-400 font-semibold' }
  if (prob > 0.15) return { text: 'Watch', cls: 'text-yellow-400' }
  return               { text: '',      cls: '' }
}

function accuracyResult(absError: number): { symbol: string; cls: string } {
  if (absError < 30) return { symbol: '✓', cls: 'text-green-400' }
  if (absError < 60) return { symbol: '~', cls: 'text-yellow-400' }
  return                { symbol: '✗', cls: 'text-red-400' }
}

function missingHours(rows: PredictionRow[]): number {
  return Math.max(0, 24 - rows.length)
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function Home() {
  const [alert1h, forecast24h, recentRows] = await Promise.all([
    get1hAlert(),
    get24hForecast(),
    getRecentAccuracy(),
  ])

  const hiddenCount = missingHours(forecast24h)

  const prob1h  = alert1h?.spike_prob_1h  ?? null
  const price1h = alert1h?.predicted_price_1h ?? null
  const band    = alertBand(price1h !== null ? prob1h : null)

  const mae = recentRows.length > 0
    ? recentRows.reduce((sum, r) => sum + Math.abs((r.predicted_price ?? 0) - (r.actual_price ?? 0)), 0) / recentRows.length
    : null

  const lastUpdated = alert1h?.predicted_at ?? forecast24h[0]?.predicted_at ?? null

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-200 font-mono">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

        {/* ── Header ── */}
        <div className="border-b border-zinc-800 pb-5">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Alberta Grid Intelligence
          </h1>
          <p className="text-zinc-500 text-xs mt-1">
            AESO pool price forecast &mdash; LightGBM regime model
          </p>
        </div>

        {/* ── SECTION 1: 1H ALERT ── */}
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs text-zinc-500 uppercase tracking-widest">1H Alert</p>
            <p className="text-xs text-zinc-600">Live signal &mdash; updates hourly</p>
          </div>

          <div className={`${band.bg} border ${band.border} p-5 rounded-sm`}>
            {price1h !== null ? (
              <div className="space-y-3">
                <div className={`text-lg font-bold ${band.labelColor} tracking-wide`}>
                  {band.icon} {band.label}
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <span className="text-4xl font-bold text-white">${price1h.toFixed(2)}</span>
                    <span className="text-zinc-500 text-sm ml-1">/MWh</span>
                  </div>
                  {prob1h !== null && (
                    <div className={`text-sm ${band.labelColor}`}>
                      Spike prob: {(prob1h * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
                {alert1h?.target_hour && (
                  <div className="text-xs text-zinc-500">
                    Target: {fmtTargetFull(alert1h.target_hour)}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-sm text-zinc-400">◌ Standby</div>
                <div className="text-xs text-zinc-500">
                  Awaiting gas headroom data &mdash; publishes ~2h after settlement
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── SECTION 2: TODAY'S FORECAST ── */}
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs text-zinc-500 uppercase tracking-widest">
              Today&apos;s Forecast
            </p>
            <p className="text-xs text-zinc-600">Made at 1:00 AM MST &mdash; full day forecast</p>
          </div>

          {forecast24h.length === 0 ? (
            <div className="border border-zinc-800 p-4 text-zinc-600 text-sm">
              No forecast for today. Run the pipeline to generate predictions.
            </div>
          ) : (
            <>
              {hiddenCount > 0 && (
                <p className="text-zinc-700 text-xs mb-2">
                  {hiddenCount} hour{hiddenCount !== 1 ? 's' : ''} missing (data not yet published)
                </p>
              )}
              <div className="border border-zinc-800 overflow-x-auto rounded-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#111] border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                      <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Hour (MPT)</th>
                      <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Predicted Price</th>
                      <th className="text-center px-4 py-2.5 font-medium whitespace-nowrap">Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast24h.map((row, i) => {
                      const price = row.predicted_price ?? 0
                      const prob  = row.spike_probability ?? 0
                      const risk  = riskLabel(prob)
                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-zinc-900 ${i % 2 === 0 ? 'bg-[#0a0a0a]' : 'bg-[#0f0f0f]'}`}
                        >
                          <td className="px-4 py-2.5 text-zinc-300 whitespace-nowrap">
                            {fmtHourMPT(row.target_hour)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-white font-semibold whitespace-nowrap">
                            ${price.toFixed(2)}
                          </td>
                          <td className={`px-4 py-2.5 text-center whitespace-nowrap text-xs ${risk.cls}`}>
                            {risk.text || <span className="text-zinc-800">&mdash;</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* ── SECTION 3: RECENT ACCURACY ── */}
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs text-zinc-500 uppercase tracking-widest">Recent Accuracy</p>
            {mae !== null && (
              <p className="text-xs text-zinc-500">
                MAE: <span className="text-white">${mae.toFixed(2)}</span>
                <span className="text-zinc-600"> / MWh ({recentRows.length} hrs)</span>
              </p>
            )}
          </div>

          {recentRows.length === 0 ? (
            <div className="border border-zinc-800 p-4 text-zinc-600 text-sm">
              No settled actuals yet.
            </div>
          ) : (
            <div className="border border-zinc-800 overflow-x-auto rounded-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#111] border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Date / Hour</th>
                    <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Predicted</th>
                    <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Actual</th>
                    <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Error</th>
                    <th className="text-center px-4 py-2.5 font-medium whitespace-nowrap">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRows.map((row, i) => {
                    const pred  = row.predicted_price ?? 0
                    const actual = row.actual_price ?? 0
                    const err   = pred - actual
                    const abs   = Math.abs(err)
                    const res   = accuracyResult(abs)
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-zinc-900 ${i % 2 === 0 ? 'bg-[#0a0a0a]' : 'bg-[#0f0f0f]'}`}
                      >
                        <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap text-xs">
                          {fmtDateHourMPT(row.target_hour)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-zinc-300 whitespace-nowrap">
                          ${pred.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-white whitespace-nowrap">
                          ${actual.toFixed(2)}
                        </td>
                        <td className={`px-4 py-2.5 text-right whitespace-nowrap ${err > 0 ? 'text-red-400' : err < 0 ? 'text-green-400' : 'text-zinc-400'}`}>
                          {err >= 0 ? '+' : ''}{err.toFixed(2)}
                        </td>
                        <td className={`px-4 py-2.5 text-center font-semibold ${res.cls}`}>
                          {res.symbol}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── SECTION 4: SYSTEM STATUS ── */}
        <section className="border-t border-zinc-800 pt-5 space-y-1">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-3">System Status</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="bg-[#111] border border-zinc-800 rounded-sm p-3">
              <div className="text-zinc-600 mb-1">Last updated</div>
              <div className="text-zinc-300">
                {lastUpdated ? fmtUpdated(lastUpdated) : '—'}
              </div>
            </div>
            <div className="bg-[#111] border border-zinc-800 rounded-sm p-3">
              <div className="text-zinc-600 mb-1">Next update</div>
              <div className="text-zinc-300">Daily 1:00 AM MST</div>
            </div>
            <div className="bg-[#111] border border-zinc-800 rounded-sm p-3">
              <div className="text-zinc-600 mb-1">Data source</div>
              <div className="text-zinc-300">AESO public API</div>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
