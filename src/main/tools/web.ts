import type { ToolDef } from './types'
import { str } from './types'

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const fetchUrl: ToolDef = {
  name: 'fetch_url',
  description: 'Fetch a specific URL and return its readable text content. Use for reading a known page (statute, regulation, article).',
  needsPermission: false,
  inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  async run(args) {
    const url = str(args, 'url')
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'QuantumLawGroup/0.1' } })
      if (!res.ok) return { summary: `HTTP ${res.status} for ${url}`, content: `Request failed: ${res.status} ${res.statusText}`, isError: true }
      const ct = res.headers.get('content-type') || ''
      const body = await res.text()
      const text = ct.includes('html') ? htmlToText(body) : body
      const clipped = text.slice(0, 120_000)
      return { summary: `Fetched ${new URL(url).hostname}`, content: clipped }
    } catch (e) {
      return { summary: 'Fetch failed', content: `Could not fetch URL: ${(e as Error).message}`, isError: true }
    }
  }
}
