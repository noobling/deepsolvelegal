import type { ToolDef } from './types'
import { str } from './types'

/**
 * Insert a tracked-change redline into the existing document in place, rather
 * than having the model regenerate the whole document. The model supplies the
 * exact existing text and its replacement; we wrap the change as
 * <del>old</del><ins>new</ins> so the full document stays intact with the edit
 * marked.
 */
export const applyRedlineTool: ToolDef = {
  name: 'apply_redline',
  description:
    'Edit the current document in place by replacing an exact span of existing text with new text, marked as a ' +
    'tracked change (<del>old</del><ins>new</ins>). Use this to revise a clause instead of rewriting the whole ' +
    'document. "find" must be copied verbatim from the document, including punctuation.',
  needsPermission: false,
  inputSchema: {
    type: 'object',
    properties: {
      find: { type: 'string', description: 'The exact existing text to replace (verbatim from the document).' },
      replacement: { type: 'string', description: 'The new text that should take its place.' }
    },
    required: ['find', 'replacement']
  },
  async run(args, ctx) {
    const find = str(args, 'find')
    const replacement = str(args, 'replacement')
    const doc = ctx.getDocument()
    if (!doc) {
      return { summary: 'No document to edit', content: 'There is no document yet to redline.', isError: true }
    }
    if (!find.trim()) {
      return { summary: 'Empty find', content: 'Provide the exact existing text to replace in "find".', isError: true }
    }
    const idx = doc.indexOf(find)
    if (idx === -1) {
      return {
        summary: 'Text not found',
        content:
          'That exact text was not found in the document. Copy the existing wording verbatim (including punctuation) into "find" and try again.',
        isError: true
      }
    }
    const edited = doc.slice(0, idx) + `<del>${find}</del><ins>${replacement}</ins>` + doc.slice(idx + find.length)
    await ctx.setDocument(edited)
    return { summary: 'Applied redline to the document', content: 'The document was updated with your tracked change.' }
  }
}
