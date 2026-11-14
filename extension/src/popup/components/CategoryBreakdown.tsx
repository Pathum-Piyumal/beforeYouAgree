import { RISK_CATEGORIES, type CategoryScore, type RiskCategory } from '../../api/types'

type CategoryBreakdownProps = {
  scores: CategoryScore[]
}

const labels: Record<RiskCategory, string> = {
  financial: 'Financial',
  subscription: 'Subscription',
  cancellation: 'Cancellation',
  refund: 'Refund',
  privacy: 'Privacy',
  commitment: 'Commitment',
}

function categoryState(score: CategoryScore | undefined): string {
  if (!score || !score.assessed) return 'Not evaluated'
  if (score.finding_count === 0 || score.score === null) return 'No finding detected'
  return `${score.score}/100`
}

export function CategoryBreakdown({ scores }: CategoryBreakdownProps) {
  const scoresByCategory = new Map(scores.map((score) => [score.category, score]))

  return (
    <section className="result-section" aria-labelledby="category-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">BREAKDOWN</p>
          <h2 id="category-heading">Risk categories</h2>
        </div>
        <span className="section-hint">Six categories</span>
      </div>
      <ul className="category-list">
        {RISK_CATEGORIES.map((category) => {
          const score = scoresByCategory.get(category)
          return (
            <li className="category-item" key={category}>
              <div>
                <strong>{labels[category]}</strong>
                <p>{score?.explanation ?? 'Not evaluated for this analysis.'}</p>
              </div>
              <span className={score?.assessed ? 'category-state category-state--assessed' : 'category-state'}>
                {categoryState(score)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
