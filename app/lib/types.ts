export interface PredictionRow {
  id: number
  predicted_at: string
  target_hour: string
  predicted_price: number | null
  spike_probability: number | null
  actual_price: number | null
  predicted_price_1h: number | null
  spike_prob_1h: number | null
  q10: number | null
  q25: number | null
  q50: number | null
  q75: number | null
  q90: number | null
  q99: number | null
  spread: number | null
}
