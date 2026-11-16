import type { CoverageStatus, RiskBand } from '../../api/types'

type RiskScoreGaugeProps = {
  score: number | null
  riskBand: RiskBand | null
  coverage: CoverageStatus
}

const bandLabels: Record<RiskBand, string> = {
  low: 'Low risk',
  moderate: 'Moderate risk',
  high: 'High risk',
  very_high: 'Very high risk',
}

export function RiskScoreGauge({ score, riskBand, coverage }: RiskScoreGaugeProps) {
  if (score === null || riskBand === null) {
    return (
      <section className="score-gauge score-gauge--unavailable" aria-labelledby="score-heading">
        <p className="eyebrow">RISK SCORE</p>
        <h2 id="score-heading">Score unavailable</h2>
        <p>There is not enough supported evidence to calculate a reliable score.</p>
      </section>
    )
  }

  return (
    <section className={`score-gauge risk-${riskBand}`} aria-labelledby="score-heading">
      <div>
        <p className="eyebrow">RISK SCORE</p>
        <h2 id="score-heading">{score}<span>/100</span></h2>
      </div>
      <div className="score-details">
        <strong>{bandLabels[riskBand]}</strong>
        <span>{coverage === 'complete' ? 'All categories assessed' : 'Partial category coverage'}</span>
      </div>
      <progress value={score} max="100" aria-label={`Risk score: ${score} out of 100`} />
    </section>
  )
}
