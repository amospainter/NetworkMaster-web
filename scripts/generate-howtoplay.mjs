import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourcePath = resolve(root, 'HOWTOPLAY.md')
const outputPath = resolve(root, 'public/howtoplay.html')

const escapeHtml = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const inline = (value) =>
  escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '<a href="$2">$1</a>')

function markdownToHtml(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const html = []
  let paragraph = []
  let list = null

  const closeParagraph = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const closeList = () => {
    if (list) html.push(`</${list}>`)
    list = null
  }
  const closeBlocks = () => {
    closeParagraph()
    closeList()
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.trim()) {
      closeBlocks()
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      closeBlocks()
      const level = heading[1].length
      const id = heading[2]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
      html.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`)
      continue
    }
    const trimmedLine = line.trim()
    const trimmedNextLine = (lines[index + 1] ?? '').trim()
    if (/^\|.+\|$/.test(trimmedLine) && /^\|[\s:|-]+\|$/.test(trimmedNextLine)) {
      closeBlocks()
      const rows = [trimmedLine]
      let rowIndex = index + 2
      while (rowIndex < lines.length && /^\|.+\|$/.test(lines[rowIndex].trim())) {
        rows.push(lines[rowIndex].trim())
        rowIndex++
      }
      // Continue after this table's contiguous rows only. A later table must
      // be parsed independently rather than being folded into this one.
      index = rowIndex - 1
      const cells = (row) =>
        row
          .slice(1, -1)
          .split('|')
          .map((cell) => cell.trim())
      html.push('<div class="table-wrap"><table><thead><tr>')
      html.push(...cells(rows[0]).map((cell) => `<th>${inline(cell)}</th>`))
      html.push('</tr></thead><tbody>')
      for (const row of rows.slice(1)) {
        html.push('<tr>', ...cells(row).map((cell) => `<td>${inline(cell)}</td>`), '</tr>')
      }
      html.push('</tbody></table></div>')
      continue
    }
    const unordered = line.match(/^\s*-\s+(.+)$/)
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/)
    if (unordered || ordered) {
      closeParagraph()
      const nextList = unordered ? 'ul' : 'ol'
      if (list !== nextList) {
        closeList()
        list = nextList
        html.push(`<${list}>`)
      }
      html.push(`<li>${inline((unordered ?? ordered)[1])}</li>`)
      continue
    }
    paragraph.push(line.trim())
  }
  closeBlocks()
  return html.join('\n')
}

const markdown = await readFile(sourcePath, 'utf8')
const article = markdownToHtml(markdown)
const generated = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Complete NetworkMaster gameplay guide" />
    <title>How to Play NetworkMaster</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #10151c; color: #e7edf5; }
      body { margin: 0; }
      main { width: min(920px, calc(100% - 36px)); margin: 0 auto; padding: 44px 0 80px; line-height: 1.65; }
      h1, h2, h3 { line-height: 1.18; color: #f7fbff; scroll-margin-top: 20px; }
      h1 { font-size: clamp(2rem, 7vw, 3.5rem); margin: 0 0 24px; color: #d9ff68; }
      h2 { margin-top: 48px; padding-bottom: 8px; border-bottom: 1px solid #344150; }
      h3 { margin-top: 30px; }
      p, li { color: #c7d1dd; }
      li + li { margin-top: 8px; }
      a { color: #72dfff; }
      code { padding: 2px 5px; border-radius: 4px; background: #202a35; color: #f1ffbd; }
      .table-wrap { overflow-x: auto; margin: 20px 0; border: 1px solid #344150; border-radius: 8px; }
      table { width: 100%; border-collapse: collapse; min-width: 600px; }
      th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #293441; }
      th { background: #202a35; color: #d9ff68; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
      tr:last-child td { border-bottom: 0; }
      .back { display: inline-block; margin-bottom: 28px; font-weight: 700; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <a class="back" href="/">← Back to NetworkMaster</a>
      ${article}
    </main>
  </body>
</html>
`

await writeFile(outputPath, generated)
