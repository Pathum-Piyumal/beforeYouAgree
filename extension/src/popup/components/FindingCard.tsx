import type { AnalysisResponse } from '../../api/types'

type Finding = AnalysisResponse['findings'][number]

type FindingCardProps = {
  finding: Finding
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ')
}

export function FindingCard({ finding }: FindingCardProps) {
  return (
    <article className="finding-card">
      <div className="finding-meta">
        <span className={`severity-chip severity-${finding.severity}`}>{finding.severity}</span>
        <span>{humanize(finding.category)}</span>
      </div>
      <h3>{humanize(finding.risk_type)}</h3>
      <p>{finding.consequence}</p>
      <details className="evidence-disclosure">
        <summary>Why this matters</summary>
        <blockquote>{finding.evidence.quote}</blockquote>
        <a href={finding.evidence.source_url} target="_blank" rel="noreferrer">
          View source section
        </a>
      </details>
    </article>
  )
}
