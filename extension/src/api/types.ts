export const RISK_CATEGORIES = [
  'financial',
  'subscription',
  'cancellation',
  'refund',
  'privacy',
  'commitment',
] as const

export type RiskCategory = (typeof RISK_CATEGORIES)[number]
export type RiskBand = 'low' | 'moderate' | 'high' | 'very_high'
export type AnalysisStatus = 'complete' | 'partial' | 'insufficient_evidence' | 'failed'
export type CoverageStatus = 'complete' | 'partial' | 'insufficient'

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

export type CategoryScore = {
  category: RiskCategory
  weight: number
  assessed: boolean
  score: number | null
  contribution: number | null
  finding_count: number
  explanation: string
}

export type AnalysisResponse = {
  analysis_id: string | null
  status: AnalysisStatus
  score: number | null
  risk_band: RiskBand | null
  score_version: string | null
  coverage: {
    status: CoverageStatus
    warnings: string[]
  }
  review_flags: Array<{
    code: string
    message: string
    source_section_id: string | null
  }>
  metadata: {
    model_id: string
    prompt_version: string
    extraction_schema_version: string
    provider_attempts: number
    estimated_cost_usd: number
  } | null
  score_coverage: CoverageStatus
  category_scores: CategoryScore[]
  dominant_contributions: string[]
  score_explanation: string | null
  findings: Array<{
    category: RiskCategory
    risk_type: string
    severity: 'low' | 'moderate' | 'high' | 'critical'
    consequence: string
    evidence: {
      section_id: string
      quote: string
      source_url: string
    }
  }>
  timeline: Array<{
    kind: string
    timing: 'absolute' | 'relative' | 'recurring' | 'unresolved'
    status: 'resolved' | 'unresolved'
    relative_to: string | null
    offset_direction: 'before' | 'after' | null
    offset_days: number | null
    amount: string | null
    currency: string | null
    recurrence: string | null
    date: string | null
    timezone: string | null
    source_section_id: string | null
    source_risk_types: string[]
    source_url: string | null
    evidence_quote: string | null
    assumptions: string[]
    unresolved_reason: string | null
  }>
}

export type ApiErrorPayload = {
  error?: {
    code?: string
    message?: string
    request_id?: string
  }
}

type UnknownRecord = Record<string, unknown>

const riskBands = new Set<RiskBand>(['low', 'moderate', 'high', 'very_high'])
const analysisStatuses = new Set<AnalysisStatus>(['complete', 'partial', 'insufficient_evidence', 'failed'])
const coverageStatuses = new Set<CoverageStatus>(['complete', 'partial', 'insufficient'])
const severities = new Set<AnalysisResponse['findings'][number]['severity']>([
  'low',
  'moderate',
  'high',
  'critical',
])

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as UnknownRecord
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`)
  return value
}

function asNullableString(value: unknown, label: string): string | null {
  return value === null ? null : asString(value, label)
}

function asNumber(value: unknown, label: string, minimum?: number, maximum?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  if ((minimum !== undefined && value < minimum) || (maximum !== undefined && value > maximum)) {
    throw new Error(`${label} is outside the allowed range.`)
  }
  return value
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`)
  return value
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array.`)
  }
  return value as string[]
}

function asRiskCategory(value: unknown, label: string): RiskCategory {
  if (typeof value !== 'string' || !RISK_CATEGORIES.includes(value as RiskCategory)) {
    throw new Error(`${label} is not a supported risk category.`)
  }
  return value as RiskCategory
}

function asNullableScore(value: unknown): number | null {
  if (value === null) return null
  const score = asNumber(value, 'score', 0, 100)
  if (!Number.isInteger(score)) throw new Error('score must be an integer.')
  return score
}

function asNullableDate(value: unknown): string | null {
  if (value === null) return null
  const date = asString(value, 'timeline date')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) {
    throw new Error('timeline date is invalid.')
  }
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('timeline date is invalid.')
  }
  return date
}

export function parseAnalysisResponse(payload: unknown): AnalysisResponse {
  const response = asRecord(payload, 'analysis response')
  const status = asString(response.status, 'status') as AnalysisStatus
  if (!analysisStatuses.has(status)) throw new Error('status is invalid.')

  const score = asNullableScore(response.score)
  const riskBand = response.risk_band === null ? null : asString(response.risk_band, 'risk_band') as RiskBand
  if (riskBand !== null && !riskBands.has(riskBand)) throw new Error('risk_band is invalid.')
  if ((score === null) !== (riskBand === null)) {
    throw new Error('score and risk_band must either both be present or both be null.')
  }

  const coverage = asRecord(response.coverage, 'coverage')
  const coverageStatus = asString(coverage.status, 'coverage.status') as CoverageStatus
  if (!coverageStatuses.has(coverageStatus)) throw new Error('coverage.status is invalid.')
  const scoreCoverage = asString(response.score_coverage, 'score_coverage') as CoverageStatus
  if (!coverageStatuses.has(scoreCoverage)) throw new Error('score_coverage is invalid.')

  const findings = (Array.isArray(response.findings) ? response.findings : []).map((item, index) => {
    const finding = asRecord(item, `findings[${index}]`)
    const evidence = asRecord(finding.evidence, `findings[${index}].evidence`)
    const severity = asString(finding.severity, `findings[${index}].severity`)
    if (!severities.has(severity as AnalysisResponse['findings'][number]['severity'])) {
      throw new Error(`findings[${index}].severity is invalid.`)
    }
    return {
      category: asRiskCategory(finding.category, `findings[${index}].category`),
      risk_type: asString(finding.risk_type, `findings[${index}].risk_type`),
      severity: severity as AnalysisResponse['findings'][number]['severity'],
      consequence: asString(finding.consequence, `findings[${index}].consequence`),
      evidence: {
        section_id: asString(evidence.section_id, `findings[${index}].evidence.section_id`),
        quote: asString(evidence.quote, `findings[${index}].evidence.quote`),
        source_url: asString(evidence.source_url, `findings[${index}].evidence.source_url`),
      },
    }
  })

  const categoryScores = (Array.isArray(response.category_scores) ? response.category_scores : []).map((item, index) => {
    const category = asRecord(item, `category_scores[${index}]`)
    return {
      category: asRiskCategory(category.category, `category_scores[${index}].category`),
      weight: asNumber(category.weight, `category_scores[${index}].weight`, 0, 1),
      assessed: asBoolean(category.assessed, `category_scores[${index}].assessed`),
      score: asNullableScore(category.score),
      contribution: category.contribution === null ? null : asNumber(category.contribution, `category_scores[${index}].contribution`, 0, 100),
      finding_count: asNumber(category.finding_count, `category_scores[${index}].finding_count`, 0),
      explanation: asString(category.explanation, `category_scores[${index}].explanation`),
    }
  })

  const timeline = (Array.isArray(response.timeline) ? response.timeline : []).map((item, index) => {
    const event = asRecord(item, `timeline[${index}]`)
    const timing = asString(event.timing, `timeline[${index}].timing`)
    const timelineStatus = asString(event.status, `timeline[${index}].status`)
    if (!['absolute', 'relative', 'recurring', 'unresolved'].includes(timing)) {
      throw new Error(`timeline[${index}].timing is invalid.`)
    }
    if (!['resolved', 'unresolved'].includes(timelineStatus)) {
      throw new Error(`timeline[${index}].status is invalid.`)
    }
    const directionCandidate = event.offset_direction === null
      ? null
      : asString(event.offset_direction, `timeline[${index}].offset_direction`)
    if (directionCandidate !== null && directionCandidate !== 'before' && directionCandidate !== 'after') {
      throw new Error(`timeline[${index}].offset_direction is invalid.`)
    }
    const direction = directionCandidate as 'before' | 'after' | null
    return {
      kind: asString(event.kind, `timeline[${index}].kind`),
      timing: timing as AnalysisResponse['timeline'][number]['timing'],
      status: timelineStatus as AnalysisResponse['timeline'][number]['status'],
      relative_to: asNullableString(event.relative_to, `timeline[${index}].relative_to`),
      offset_direction: direction,
      offset_days: event.offset_days === null
        ? null
        : asNumber(event.offset_days, `timeline[${index}].offset_days`, 0),
      amount: asNullableString(event.amount, `timeline[${index}].amount`),
      currency: asNullableString(event.currency, `timeline[${index}].currency`),
      recurrence: asNullableString(event.recurrence, `timeline[${index}].recurrence`),
      date: asNullableDate(event.date),
      timezone: asNullableString(event.timezone, `timeline[${index}].timezone`),
      source_section_id: asNullableString(event.source_section_id, `timeline[${index}].source_section_id`),
      source_risk_types: asStringArray(event.source_risk_types, `timeline[${index}].source_risk_types`),
      source_url: asNullableString(event.source_url, `timeline[${index}].source_url`),
      evidence_quote: asNullableString(event.evidence_quote, `timeline[${index}].evidence_quote`),
      assumptions: asStringArray(event.assumptions, `timeline[${index}].assumptions`),
      unresolved_reason: asNullableString(event.unresolved_reason, `timeline[${index}].unresolved_reason`),
    }
  })

  const reviewFlags = (Array.isArray(response.review_flags) ? response.review_flags : []).map((item, index) => {
    const flag = asRecord(item, `review_flags[${index}]`)
    return {
      code: asString(flag.code, `review_flags[${index}].code`),
      message: asString(flag.message, `review_flags[${index}].message`),
      source_section_id: asNullableString(flag.source_section_id, `review_flags[${index}].source_section_id`),
    }
  })

  const metadata = response.metadata === null ? null : asRecord(response.metadata, 'metadata')
  return {
    analysis_id: asNullableString(response.analysis_id, 'analysis_id'),
    status,
    score,
    risk_band: riskBand,
    score_version: asNullableString(response.score_version, 'score_version'),
    coverage: { status: coverageStatus, warnings: asStringArray(coverage.warnings, 'coverage.warnings') },
    review_flags: reviewFlags,
    metadata: metadata === null ? null : {
      model_id: asString(metadata.model_id, 'metadata.model_id'),
      prompt_version: asString(metadata.prompt_version, 'metadata.prompt_version'),
      extraction_schema_version: asString(metadata.extraction_schema_version, 'metadata.extraction_schema_version'),
      provider_attempts: asNumber(metadata.provider_attempts, 'metadata.provider_attempts', 1),
      estimated_cost_usd: asNumber(metadata.estimated_cost_usd, 'metadata.estimated_cost_usd', 0),
    },
    score_coverage: scoreCoverage,
    category_scores: categoryScores,
    dominant_contributions: asStringArray(response.dominant_contributions, 'dominant_contributions'),
    score_explanation: asNullableString(response.score_explanation, 'score_explanation'),
    findings,
    timeline,
  }
}
