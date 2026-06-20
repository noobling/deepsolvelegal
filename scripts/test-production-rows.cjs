/*
 * Regression test for the pure production column builders
 * (src/main/export/productionRows.ts). No Electron, no test framework: esbuild
 * strips the types (the module's only imports are `import type`), then we assert
 * the column order, family ranges, and render scope. Run with `npm test`.
 */
const fs = require('fs')
const path = require('path')
const Module = require('module')
const esbuild = require('esbuild')

const SRC = path.join(__dirname, '..', 'src', 'main', 'export', 'productionRows.ts')
const { code } = esbuild.transformSync(fs.readFileSync(SRC, 'utf8'), { loader: 'ts', format: 'cjs' })
const mod = new Module('productionRows')
mod._compile(code, SRC)
const m = mod.exports

let ok = true
const check = (name, cond) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name)
  if (!cond) ok = false
}

const recs = [
  { begBates: 'DOC-000001', endBates: 'DOC-000004', pages: 4, date: '2026-03-02', from: 'a@x.com', to: 'b@y.com', cc: 'c@z.com', subject: 'Hello, "world"', docType: 'Email', kind: 'email', fileRel: 'Cat 1/a/a.pdf', attCount: 2, attNames: 'x.pdf; y.png' },
  { begBates: 'DOC-000005', endBates: 'DOC-000005', pages: 1, date: '', from: '', to: '', cc: '', subject: 'Contract', docType: 'NDA', kind: 'doc', fileRel: 'contract.pdf', attCount: 0, attNames: '' }
]

console.log('productionTargets (render scope):')
const docs = [{ kind: 'email' }, { kind: 'doc' }, { kind: 'email' }]
check('email→PDF only renders just emails', m.productionTargets(docs, { emailToPdf: true, reviewIndex: false, loadFile: false }).length === 2)
check('review index renders the whole set', m.productionTargets(docs, { emailToPdf: false, reviewIndex: true, loadFile: false }).length === 3)
check('production (load file) renders the whole set', m.productionTargets(docs, { emailToPdf: false, reviewIndex: false, loadFile: true }).length === 3)
check('nothing selected renders nothing', m.productionTargets(docs, { emailToPdf: false, reviewIndex: false, loadFile: false }).length === 0)

console.log('review index:')
const ir = m.reviewIndexRows(recs)
check('header has 10 cols', m.REVIEW_HEADER.length === 10)
check('header uses "Beginning/Ending Bates"', m.REVIEW_HEADER[0] === 'Beginning Bates' && m.REVIEW_HEADER[1] === 'Ending Bates')
check('row width matches header', ir[0].length === 10)
check('Bates begin/end in cols 0,1', ir[0][0] === 'DOC-000001' && ir[0][1] === 'DOC-000004')
check('pages blank when 0', m.reviewIndexRows([{ ...recs[1], pages: 0 }])[0][2] === '')
check('attachment count blank when 0', ir[1][9] === '')
check('attachment count shown when >0', ir[0][9] === '2')

console.log('external load file:')
const lr = m.loadFileRows(recs)
check('header has 14 cols', m.LOADFILE_HEADER.length === 14)
check('row width matches header', lr[0].length === 14)
check('BEGATTACH == BEGBATES (col 2)', lr[0][2] === 'DOC-000001')
check('ENDATTACH == ENDBATES (col 3)', lr[0][3] === 'DOC-000004')
check('CUSTODIAN blank (col 4)', lr[0][4] === '')
check('FILE NAME = relative path (col 11)', lr[0][11] === 'Cat 1/a/a.pdf')
check('PAGE COUNT (col 12)', lr[0][12] === '4')
check('headers BEGATTACH/ENDATTACH labelled', m.LOADFILE_HEADER[2] === 'BEGATTACH' && m.LOADFILE_HEADER[3] === 'ENDATTACH')

console.log('highlights:')
const hdocs = [
  { name: 'a.docx', highlights: [{ text: 'indemnify', color: 'yellow', page: 3, context: 'the clause' }, { text: 'liability', color: '#00ff00', page: null, context: '' }] },
  { name: 'b.pdf', highlights: [] },
  { name: 'c.pdf' }
]
const hr = m.highlightRows(hdocs)
check('flattens to 2 rows', hr.length === 2)
check('header has 5 cols', m.HIGHLIGHT_HEADER.length === 5)
check('page rendered', hr[0][1] === '3')
check('null page → blank', hr[1][1] === '')
check('colour passthrough', hr[1][2] === '#00ff00')

console.log('\n' + (ok ? 'ALL PASS ✓' : 'FAILURES ✗'))
process.exit(ok ? 0 : 1)
