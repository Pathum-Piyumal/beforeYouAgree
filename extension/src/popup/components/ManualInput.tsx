import { useState } from 'react'

import type { PageContext } from '../../messaging/protocol'

export function ManualInput({ sourceUrl, onUse }: { sourceUrl: string; onUse: (context: PageContext) => void }) {
  const [url, setUrl] = useState(sourceUrl)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const source = new URL(url)
      if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) throw new Error()
      const normalized = text.replace(/\s+/g, ' ').trim()
      if (normalized.length < 20 || normalized.length > 50_000) throw new Error()
      const sections = []
      for (let offset = 0; offset < normalized.length; offset += 12_000) {
        sections.push({ section_id: `manual-${sections.length + 1}`, heading: 'Manually supplied text',
          text: normalized.slice(offset, offset + 12_000), source_url: source.href })
      }
      onUse({ url: source.href, domain: source.hostname, title: 'Manually supplied agreement',
        textPreview: normalized.slice(0, 500), textLength: normalized.length, sections })
      setError(null)
    } catch { setError('Enter a public HTTP(S) source URL and 20–50,000 characters of agreement text.') }
  }
  return <details className="manual-input"><summary>Paste agreement text instead</summary>
    <form className="account-form" onSubmit={submit}>
      <p>Copy only the agreement clauses you want analyzed. Remove passwords, payment information, and personal account details.</p>
      <label>Agreement source URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} required /></label>
      <label>Agreement text<textarea value={text} onChange={(event) => setText(event.target.value)} minLength={20} maxLength={50_000} required /></label>
      {error && <p className="error-message" role="alert">{error}</p>}
      <button className="secondary-button">Use this text</button>
    </form>
  </details>
}
