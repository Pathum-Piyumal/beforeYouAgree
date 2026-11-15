import type { AnalysisResponse } from '../../api/types'

type TimelineEvent = AnalysisResponse['timeline'][number]

function humanize(value: string): string {
  return value.replaceAll('_', ' ')
}

function describeEvent(event: TimelineEvent): string {
  if (event.timing === 'unresolved') {
    return event.unresolved_reason ?? 'The date needs review before it can be added to a timeline.'
  }
  if (event.timing === 'absolute' && event.date) {
    return `${event.date}${event.timezone ? ` (${event.timezone})` : ''}`
  }
  if (event.timing === 'relative' && event.offset_days !== null && event.relative_to) {
    const direction = event.offset_direction ?? 'after'
    return `${event.offset_days} days ${direction} ${humanize(event.relative_to)}`
  }
  if (event.timing === 'recurring') {
    const charge = event.amount && event.currency ? `${event.amount} ${event.currency}` : 'Recurring event'
    return `${charge}${event.recurrence ? `, ${event.recurrence}` : ''}`
  }
  return 'Timing is not available.'
}

export function CommitmentTimeline({ timeline }: { timeline: TimelineEvent[] }) {
  if (timeline.length === 0) {
    return (
      <section className="result-section" aria-labelledby="timeline-heading">
        <p className="eyebrow">TIMELINE</p>
        <h2 id="timeline-heading">No supported events found</h2>
        <p className="muted-copy">Dates and recurring commitments appear here when the agreement supports them.</p>
      </section>
    )
  }

  return (
    <section className="result-section" aria-labelledby="timeline-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TIMELINE</p>
          <h2 id="timeline-heading">Upcoming commitments</h2>
        </div>
      </div>
      <ol className="timeline-list">
        {timeline.map((event, index) => (
          <li className={event.status === 'unresolved' ? 'timeline-item timeline-item--unresolved' : 'timeline-item'} key={`${event.kind}-${event.source_section_id ?? index}-${index}`}>
            <div className="timeline-marker" aria-hidden="true" />
            <div>
              <h3>{humanize(event.kind)}</h3>
              <p>{describeEvent(event)}</p>
              {event.assumptions.map((assumption) => <p className="timeline-assumption" key={assumption}>Assumption: {assumption}</p>)}
              {event.evidence_quote && <blockquote>{event.evidence_quote}</blockquote>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
