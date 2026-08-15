export interface Racecourse {
  id: string
  name: string
  state: string
  region?: string
}

export interface Race {
  id: string
  external_id?: string
  racecourse_id: string
  race_number: number
  race_name?: string
  distance_m?: number
  track_condition?: string
  weather_condition?: string
  race_class?: string
  prize_money?: number
  race_datetime: string
  status: 'upcoming' | 'live' | 'completed' | 'cancelled'
  racecourses?: Racecourse
}

export interface Horse {
  id: string
  external_id?: string
  name: string
  sex?: string
  age?: number
  sire?: string
  dam?: string
  trainer?: string
  owner?: string
  career_runs?: number
  career_wins?: number
  career_places?: number
  total_prize_money?: number
  best_time_this_distance?: number
  wet_form_rating?: number
  heavy_form_rating?: number
  dry_form_rating?: number
  last_race_date?: string
  last_race_result?: string
}

export interface RaceEntry {
  id: string
  race_id: string
  horse_id: string
  barrier_number?: number
  weight_carried?: number
  jockey?: string
  trainer?: string
  finishing_position?: number
  finishing_time?: number
  sectional_times?: JsonValue
  margin?: number
  status: string
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type RaceEntryWithHorse = RaceEntry & {
  horses: Horse | null
}

export interface PredictedHorse {
  horse_id: string
  horse_name: string
  predicted_position: number
  predicted_time?: number
  confidence: number
}

export interface PredictionPayload {
  podium: PredictedHorse[]
  all_horses: PredictedHorse[]
}

export interface Prediction {
  id: string
  race_id: string
  model_version: string
  predicted_at: string
  predictions: PredictionPayload
  confidence_scores: {
    overall: number
    winner?: number
    podium?: number
  }
  predicted_times: Record<string, number>
  actual_results?: JsonValue
  accuracy_score?: number
}

export interface AccuracyLog {
  id: string
  logged_at: string
  period_start: string
  period_end: string
  total_races: number
  correct_winners: number
  correct_podiums: number
  winner_accuracy: number
  podium_accuracy: number
  avg_confidence?: number
  avg_time_error?: number
  model_version: string
}

export interface DataSource {
  id: string
  name: string
  source_type: 'scrape' | 'api' | 'manual' | 'import'
  url?: string
  last_synced?: string
  sync_frequency?: string
  active: boolean
}

export type RaceWithPrediction = Race & {
  prediction: Prediction | null
}
