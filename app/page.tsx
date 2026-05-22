import { createSupabaseClient } from '@/app/lib/supabase'
import { PredictionRow } from '@/app/lib/types'

export const dynamic = 'force-dynamic'

const MPT         = 'America/Edmonton'
const SPIKE_ALERT = 0.60
const SPIKE_WATCH = 0.20
const SPIKE_PRICE = 100
const PROVISIONAL = 5

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtHour12(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso))
}

function fmtCardHour(iso: string): string {
  const d = new Date(iso)
  d.setMinutes(0, 0, 0)
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, month: 'long', day: 'numeric', year: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return `${date} — ${time} MPT`
}

function fmtTableHour(iso: string): string {
  const d = new Date(iso)
  d.setMinutes(0, 0, 0)
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, month: 'short', day: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return `${date} ${time} MPT`
}

function fmtUpdated(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MPT, month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d) + ' MPT'
}

// ── Spike helpers ─────────────────────────────────────────────────────────────

function spikeCellClass(prob: number): string {
  if (prob >= SPIKE_ALERT) return 'bg-red-900/30 text-red-400'
  if (prob >= SPIKE_WATCH) return 'bg-yellow-900/30 text-yellow-300'
  return 'bg-green-900/20 text-green-400'
}

function spikeCardColor(prob: number): string {
  if (prob >= SPIKE_ALERT) return 'text-red-400'
  if (prob >= SPIKE_WATCH) return 'text-yellow-400'
  return 'text-green-400'
}

function spikeFlag(prob: number, actual: number | null): { symbol: string; color: string } {
  if (actual === null)      return { symbol: '—', color: 'text-zinc-600' }
  if (actual < PROVISIONAL) return { symbol: '?',  color: 'text-zinc-500' }
  const correct = (prob > SPIKE_ALERT) === (actual > SPIKE_PRICE)
  return correct
    ? { symbol: '✓', color: 'text-green-400' }
    : { symbol: '✗', color: 'text-red-400' }
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
  const { data, error } = await createSupabaseClient()
    .from('prediction_log')
    .select('id, target_hour, predicted_price, spike_probability')
    .eq('forecast_type', '24h')
    .gte('target_hour', new Date().toISOString())
    .order('target_hour', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as PredictionRow[]
}

async function getTrackRecord(): Promise<PredictionRow[]> {
  const { data, error } = await createSupabaseClient()
    .from('prediction_log')
    .select('id, predicted_at, target_hour, predicted_price, spike_probability, actual_price')
    .eq('forecast_type', '24h')
    .lt('target_hour', new Date().toISOString())
    .order('target_hour', { ascending: false })
    .order('predicted_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  const all = (data ?? []) as unknown as PredictionRow[]
  const seen = new Set<string>()
  const out: PredictionRow[] = []
  for (const row of all) {
    if (!seen.has(row.target_hour)) {
      seen.add(row.target_hour)
      out.push(row)
    }
    if (out.length === 7) break
  }
  return out
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function Home() {
  const [alert1h, forecast24h, trackRecord] = await Promise.all([
    get1hAlert(),
    get24hForecast(),
    getTrackRecord(),
  ])

  const peakPrice = forecast24h.length > 0
    ? Math.max(...forecast24h.map(r => r.predicted_price ?? 0))
    : null

  const lastUpdated = alert1h?.predicted_at ?? forecast24h[0]?.predicted_at ?? null

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Alberta Grid Intelligence
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Real-time price forecast &mdash; AESO pool price
          </p>
          {lastUpdated && (
            <p className="text-zinc-600 text-xs mt-2 font-mono">
              Last updated: {fmtUpdated(lastUpdated)}
            </p>
          )}
        </div>

        {/* 1H Alert card */}
        <div>
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
            1H Alert
          </p>
          {alert1h?.predicted_price_1h != null ? (
            <div className="bg-[#111111] border border-zinc-800 p-6">
              <div className="text-zinc-400 text-sm mb-4 font-mono">
                {fmtCardHour(alert1h.target_hour)}
              </div>
              <div className="font-mono font-bold text-white mb-4 leading-none">
                <span className="text-5xl">${alert1h.predicted_price_1h.toFixed(2)}</span>
                <span className="text-lg text-zinc-500 ml-2">/MWh</span>
              </div>
              <div className={`text-sm font-mono font-semibold ${spikeCardColor(alert1h.spike_prob_1h ?? 0)}`}>
                Spike prob: {((alert1h.spike_prob_1h ?? 0) * 100).toFixed(1)}%
                {(alert1h.spike_prob_1h ?? 0) >= SPIKE_ALERT && (
                  <span className="ml-2">&#9889; SPIKE ALERT</span>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-[#111111] border border-zinc-800 p-6 text-zinc-600 font-mono text-sm">
              No 1h prediction available
            </div>
          )}
        </div>

        {/* 24H Forecast table */}
        <div>
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
            24H Forecast &mdash; Tomorrow (MPT)
          </p>
          {forecast24h.length === 0 ? (
            <p className="text-zinc-600 font-mono text-sm">
              No upcoming 24h predictions found. Run the pipeline to generate tomorrow&apos;s forecast.
            </p>
          ) : (
            <div className="border border-zinc-800 overflow-x-auto">
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="bg-[#0f0f0f] border-b border-zinc-800">
                    <th className="text-left text-zinc-500 px-4 py-3 text-xs uppercase tracking-wider font-medium whitespace-nowrap">
                      Hour (MPT)
                    </th>
                    <th className="text-right text-zinc-500 px-4 py-3 text-xs uppercase tracking-wider font-medium whitespace-nowrap">
                      Predicted Price
                    </th>
                    <th className="text-center text-zinc-500 px-4 py-3 text-xs uppercase tracking-wider font-medium whitespace-nowrap">
                      Spike Probability
                    </th>
                    <th className="text-center text-zinc-500 px-4 py-3 text-xs uppercase tracking-wider font-medium whitespace-nowrap">
                      Alert
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {forecast24h.map((row, i) => {
                    const price  = row.predicted_price ?? 0
                    const spike  = row.spike_probability ?? 0
                    const isPeak = price === peakPrice
                    const rowBg  = isPeak
                      ? 'border-l-2 border-yellow-600/50 bg-yellow-950/20'
                      : i % 2 === 0 ? 'bg-[#0a0a0a]' : 'bg-[#111111]'

                    return (
                      <tr key={row.id} className={rowBg}>
                        <td className="px-4 py-2.5 text-zinc-300 whitespace-nowrap">
                          {fmtHour12(row.target_hour)}
                        </td>
                        <td className={`px-4 py-2.5 text-right whitespace-nowrap font-semibold ${isPeak ? 'text-yellow-300' : 'text-white'}`}>
                          ${price.toFixed(2)}
                        </td>
                        <td className="px-3 py-1.5 text-center whitespace-nowrap">
                          <span className={`inline-block px-2.5 py-0.5 text-xs font-semibold rounded-sm ${spikeCellClass(spike)}`}>
                            {(spike * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap text-xs">
                          {spike >= SPIKE_ALERT ? (
                            <span className="text-red-400 font-semibold">&#9889; SPIKE</span>
                          ) : spike >= SPIKE_WATCH ? (
                            <span className="text-yellow-500">watch</span>
                          ) : (
                            <span className="text-zinc-700">&mdash;</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Track Record */}
        <div>
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
            Recent Track Record
          </p>
          {trackRecord.length === 0 ? (
            <p className="text-zinc-600 font-mono text-sm">No past predictions available yet.</p>
          ) : (
            <>
              <div className="border border-zinc-800 overflow-x-auto">
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="bg-[#0f0f0f] border-b border-zinc-800">
                      <th className="text-left text-zinc-500 px-4 py-3 text-xs uppercase tracking-wider font-medium whitespace-nowrap">Target Hour</th>
                      <th className="text-right text-zinc-500 px-4 py-3 text-xs uppercase tracking-wider font-medium whitespace-nowrap">Predicted</th>
                      <th className="text-right text-zinc-500 px-4 py-3 text-xs uppercase tracking-wider font-medium whitespace-nowrap">Actual</th>
                      <th className="text-right text-zinc-500 px-4 py-3 text-xs uppercase tracking-wider font-medium whitespace-nowrap">Error</th>
                      <th className="text-center text-zinc-500 px-4 py-3 text-xs uppercase tracking-wider font-medium whitespace-nowrap">Spike Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trackRecord.map((row, i) => {
                      const flag  = spikeFlag(row.spike_probability ?? 0, row.actual_price ?? null)
                      const error = row.actual_price !== null && row.actual_price !== undefined
                        ? (row.predicted_price ?? 0) - row.actual_price
                        : null
                      return (
                        <tr key={row.id} className={i % 2 === 0 ? 'bg-[#0a0a0a]' : 'bg-[#111111]'}>
                          <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">{fmtTableHour(row.target_hour)}</td>
                          <td className="px-4 py-3 text-right text-white whitespace-nowrap">${(row.predicted_price ?? 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {row.actual_price != null
                              ? <span className={row.actual_price < PROVISIONAL ? 'text-zinc-500' : 'text-zinc-300'}>${row.actual_price.toFixed(2)}</span>
                              : <span className="text-zinc-600">Pending</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {error !== null
                              ? <span className={error > 0 ? 'text-red-400' : error < 0 ? 'text-green-400' : 'text-zinc-400'}>
                                  {error >= 0 ? '+' : ''}{error.toFixed(2)}
                                </span>
                              : <span className="text-zinc-600">&mdash;</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={flag.color}>{flag.symbol}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-zinc-700 text-xs font-mono mt-2">
                * Actual prices below ${PROVISIONAL} may be provisional AESO values
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 pt-4">
          <p className="text-zinc-600 text-xs font-mono">
            Data source: AESO public API | Model: LightGBM | Updated daily
          </p>
        </div>

      </div>
    </div>
  )
}
