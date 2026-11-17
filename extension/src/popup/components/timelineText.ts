import type { AnalysisResponse } from '../../api/types'

export type TimelineEvent = AnalysisResponse['timeline'][number]

function humanize(value: string): string {
  return value.replaceAll('_', ' ')
}

export function describeTimelineEvent(event: TimelineEvent): string {
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

export function humanizeTimelineValue(value: string): string {
  return humanize(value)
}
