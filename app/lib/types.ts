export interface PredictionRow {
  id: number
  predicted_at: string
  target_hour: string
  predicted_price: number
  spike_probability: number
  actual_price: number | null
  predicted_price_1h: number | null
  spike_prob_1h: number | null
}
