import type { AnalysisResponse } from '../../api/types'
import { CategoryBreakdown } from './CategoryBreakdown'
import { CommitmentTimeline } from './CommitmentTimeline'
import type { TimelineEvent } from './timelineText'
import { FindingCard } from './FindingCard'
import { RiskScoreGauge } from './RiskScoreGauge'

type AnalysisReportProps = {
  result: AnalysisResponse
  onSetReminder: (event: TimelineEvent) => void
}

export function AnalysisReport({ result, onSetReminder }: AnalysisReportProps) {
  const warnings = [...result.coverage.warnings, ...result.review_flags.map((flag) => flag.message)]
  const hasFindings = result.findings.length > 0

  return (
    <section className="analysis-report" aria-live="polite" aria-label="Analysis results">
      <RiskScoreGauge score={result.score} riskBand={result.risk_band} coverage={result.score_coverage} />

      {result.score_explanation && <p className="score-explanation">{result.score_explanation}</p>}

      {warnings.length > 0 && (
        <section className="coverage-warning" aria-labelledby="coverage-heading">
          <strong id="coverage-heading">What to review</strong>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </section>
      )}

      <CategoryBreakdown scores={result.category_scores} />

      <section className="result-section" aria-labelledby="finding-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CONSEQUENCES</p>
            <h2 id="finding-heading">What this could mean</h2>
          </div>
        </div>
        {hasFindings ? (
          <div className="finding-list">
            {result.findings.map((finding) => (
              <FindingCard finding={finding} key={`${finding.evidence.section_id}-${finding.risk_type}`} />
            ))}
          </div>
        ) : (
          <p className="empty-state">No supported consequences were found in the submitted text.</p>
        )}
      </section>

      <CommitmentTimeline timeline={result.timeline} onSetReminder={onSetReminder} />

    </section>
  )
}
