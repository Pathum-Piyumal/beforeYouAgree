import type { PageContext, PageSection } from '../messaging/protocol'
import {
  BLOCK_SELECTOR,
  BOILERPLATE_MARKER,
  EXCLUDED_SELECTOR,
  MAX_SECTIONS,
  MAX_SECTION_LENGTH,
  MAX_TOTAL_LENGTH,
} from './selectors'

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname || 'Unknown page'
  } catch {
    return 'Unknown page'
  }
}

function isVisible(element: HTMLElement): boolean {
  const styles = window.getComputedStyle(element)
  return styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0'
}

function isBoilerplate(element: HTMLElement): boolean {
  if (element.closest(EXCLUDED_SELECTOR)) return true
  return BOILERPLATE_MARKER.test(`${element.id} ${element.className}`)
}

function createSection(sectionId: number, heading: string | null, blocks: string[], sourceUrl: string): PageSection {
  return {
    section_id: `section-${sectionId}`,
    heading,
    text: normalizeWhitespace(blocks.join(' ')).slice(0, MAX_SECTION_LENGTH),
    source_url: sourceUrl,
  }
}

export function extractSections(document: Document): PageSection[] {
  const sourceUrl = window.location.href
  const blocks = Array.from(document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
  const sections: PageSection[] = []
  const seenText = new Set<string>()
  let currentHeading: string | null = null
  let currentBlocks: string[] = []

  const flush = () => {
    const text = normalizeWhitespace(currentBlocks.join(' '))
    if (text.length >= 20) {
      sections.push(createSection(sections.length + 1, currentHeading, currentBlocks, sourceUrl))
    }
    currentBlocks = []
  }

  for (const element of blocks) {
    if (!isVisible(element) || isBoilerplate(element)) continue

    const text = normalizeWhitespace(element.innerText || element.textContent || '')
    if (!text || seenText.has(text)) continue
    seenText.add(text)

    if (/^H[1-4]$/.test(element.tagName)) {
      flush()
      currentHeading = text.slice(0, 200)
    } else {
      currentBlocks.push(text)
    }

    if (sections.length >= MAX_SECTIONS) break
  }
  flush()

  if (sections.length > 0) return limitSections(sections)

  const fallback = normalizeWhitespace(document.body?.innerText || '')
  if (!fallback) return []
  return limitSections([createSection(1, document.title.trim() || null, [fallback], sourceUrl)])
}

function limitSections(sections: PageSection[]): PageSection[] {
  let remaining = MAX_TOTAL_LENGTH
  return sections.flatMap((section) => {
    if (remaining <= 0) return []
    const text = section.text.slice(0, Math.min(MAX_SECTION_LENGTH, remaining))
    remaining -= text.length
    return text.length >= 20 ? [{ ...section, text }] : []
  })
}

export function extractPageContext(document: Document): PageContext {
  const sections = extractSections(document)
  const textPreview = sections.map((section) => section.text).join(' ').slice(0, 500)
  const textLength = sections.reduce((total, section) => total + section.text.length, 0)

  return {
    url: window.location.href,
    domain: getDomain(window.location.href),
    title: document.title.trim() || 'Untitled page',
    textPreview,
    textLength,
    sections,
  }
}
