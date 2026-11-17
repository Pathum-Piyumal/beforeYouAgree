import {
  describeTimelineEvent as describeEvent,
  humanizeTimelineValue as humanize,
  type TimelineEvent,
} from './timelineText'

type CommitmentTimelineProps = {
  timeline: TimelineEvent[]
  onSetReminder: (event: TimelineEvent) => void
}

export function CommitmentTimeline({ timeline, onSetReminder }: CommitmentTimelineProps) {
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
              {event.status === 'resolved' && (
                <button className="text-button" type="button" onClick={() => onSetReminder(event)}>
                  Set reminder
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
