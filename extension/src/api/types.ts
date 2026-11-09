export type AnalysisRequest = {
  source_url: string
  save_to_history: boolean
  sections: Array<{
    section_id: string
    heading: string
    text: string
    source_url: string
  }>
}

export type AnalysisResponse = {
  analysis_id: string | null
  status: 'complete' | 'partial' | 'insufficient_evidence' | 'failed'
  score: number | null
  risk_band: 'low' | 'moderate' | 'high' | 'very_high' | null
  score_version: string | null
  coverage: {
    status: 'complete' | 'partial' | 'insufficient'
    warnings: string[]
  }
  findings: Array<{
    category: string
    risk_type: string
    severity: string
    consequence: string
    evidence: {
      section_id: string
      quote: string
      source_url: string
    }
  }>
  timeline: Array<{
    kind: string
    relative_to: string | null
    offset_days: number | null
    amount: string | null
    currency: string | null
    recurrence: string | null
    date: string | null
  }>
}

export type ApiErrorPayload = {
  error?: {
    code?: string
    message?: string
    request_id?: string
  }
}
