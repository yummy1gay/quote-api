const { createCanvas } = require('canvas')

let Prism = null
let loadLanguages = null
let languageComponents = null
try {
  Prism = require('prismjs')
  loadLanguages = require('prismjs/components/')
  languageComponents = require('prismjs/components.json')
} catch (_) {
  // The plain-text renderer remains usable while dependencies are installing.
}

const LIGHT_COLORS = [
  '#58a8ed', // statisticsChartLineLightblue
  '#e05356', // statisticsChartLineRed
  '#e05356',
  '#f28c39', // statisticsChartLineOrange
  '#e05356',
  '#327fe5', // statisticsChartLineBlue
  '#9f79e8', // statisticsChartLinePurple
  '#61c752' // statisticsChartLineGreen
]

// The embedded night themes inherit these chart colors unchanged.
const DARK_COLORS = LIGHT_COLORS

const LANGUAGE_ALIASES = {
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  html: 'markup',
  js: 'javascript',
  jsx: 'jsx',
  kt: 'kotlin',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'markup',
  yml: 'yaml'
}

function normalizeLanguage (language) {
  const value = String(language || '').trim().toLowerCase().replace(/^language-/, '')
  return LANGUAGE_ALIASES[value] || value
}

function grammarFor (language) {
  if (!Prism || !language) return null
  const name = normalizeLanguage(language)
  if (!Prism.languages[name] && loadLanguages) {
    try {
      const known = languageComponents && languageComponents.languages
      if (!known || known[name]) loadLanguages([name])
    } catch (_) { /* unsupported language: render as plain monospace */ }
  }
  return Prism.languages[name] || null
}

function tokenColorIndex (types) {
  const names = new Set(types.flatMap(type => String(type || '').split(/\s+/)))
  if ([...names].some(name => ['comment', 'prolog', 'doctype', 'cdata'].includes(name))) return 0
  if ([...names].some(name => ['deleted', 'tag', 'attr-name', 'namespace'].includes(name))) return 1
  if ([...names].some(name => ['operator', 'entity', 'url'].includes(name))) return 2
  if ([...names].some(name => ['boolean', 'number'].includes(name))) return 3
  if ([...names].some(name => ['keyword', 'builtin', 'important', 'atrule', 'selector'].includes(name))) return 4
  if ([...names].some(name => ['property', 'constant', 'symbol', 'class-name'].includes(name))) return 5
  if ([...names].some(name => ['function', 'function-name'].includes(name))) return 6
  if ([...names].some(name => ['string', 'char', 'attr-value', 'regex', 'variable', 'inserted'].includes(name))) return 7
  return null
}

function flattenTokens (tokens, inherited = [], result = []) {
  for (const token of Array.isArray(tokens) ? tokens : [tokens]) {
    if (typeof token === 'string') {
      result.push({ text: token, types: inherited })
      continue
    }
    if (!token) continue
    const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : []
    flattenTokens(token.content, inherited.concat(token.type || [], aliases), result)
  }
  return result
}

function highlightedRuns (code, language) {
  const grammar = grammarFor(language)
  if (!grammar || !Prism) return [{ text: code, types: [] }]
  try {
    return flattenTokens(Prism.tokenize(code, grammar))
  } catch (_) {
    return [{ text: code, types: [] }]
  }
}

function splitRunsIntoLines (runs) {
  const lines = [[]]
  for (const run of runs) {
    const pieces = String(run.text).replace(/\r\n?/g, '\n').split('\n')
    for (let index = 0; index < pieces.length; index++) {
      if (pieces[index]) lines[lines.length - 1].push({ ...run, text: pieces[index] })
      if (index < pieces.length - 1) lines.push([])
    }
  }
  return lines
}

function roundedRect (ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function paintCopyIcon (ctx, x, y, size, color) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, size * 0.1)
  ctx.lineJoin = 'round'
  ctx.strokeRect(x, y + size * 0.24, size * 0.7, size * 0.7)
  ctx.strokeRect(x + size * 0.24, y, size * 0.7, size * 0.7)
  ctx.restore()
}

function renderCodeBlock (options) {
  const code = String(options.text || '').replace(/\r\n?/g, '\n')
  const language = String(options.language || '').trim()
  const scale = options.scale || 1
  const width = Math.max(1, Math.ceil(options.width || 1))
  const fontSize = options.fontSize || 16 * scale
  const lineHeight = Math.ceil(fontSize * 1.36)
  const headerHeight = 20 * scale
  const padLeft = 10 * scale
  const padRight = 4 * scale
  const padTop = 2 * scale
  const padBottom = 4 * scale
  const lines = splitRunsIntoLines(highlightedRuns(code, language))
  const height = Math.max(1, Math.ceil(padTop + headerHeight + lines.length * lineHeight + padBottom))
  const out = createCanvas(width, height)
  const ctx = out.getContext('2d')
  const baseColor = options.color || (options.dark ? '#fff' : '#000')
  const muted = options.muted || (options.dark ? '#aeb7c4' : '#66717f')
  const colors = options.dark ? DARK_COLORS : LIGHT_COLORS

  ctx.fillStyle = options.dark ? 'rgba(255,255,255,0.075)' : 'rgba(0,0,0,0.065)'
  ctx.beginPath()
  roundedRect(ctx, 0, 0, out.width, out.height, 5 * scale)
  ctx.fill()
  ctx.fillStyle = options.dark ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  roundedRect(ctx, 0, 0, 3 * scale, out.height, 1.5 * scale)
  ctx.fill()

  ctx.font = `${Math.max(1, 12 * scale)}px NotoSansMono, monospace`
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = muted
  const header = language || 'Copy'
  const iconSize = 12 * scale
  const iconX = out.width - iconSize - 4 * scale
  const headerMax = Math.max(1, iconX - padLeft - 4 * scale)
  let headerText = header
  while (headerText && ctx.measureText(headerText).width > headerMax) headerText = headerText.slice(0, -1)
  if (headerText !== header) headerText = headerText.slice(0, -1) + '…'
  ctx.fillText(headerText, padLeft, padTop + 13 * scale)
  paintCopyIcon(ctx, iconX, padTop + 2 * scale, iconSize, muted)

  ctx.save()
  ctx.beginPath()
  ctx.rect(padLeft, padTop + headerHeight, Math.max(1, out.width - padLeft - padRight), lines.length * lineHeight)
  ctx.clip()
  ctx.font = `${fontSize}px NotoSansMono, monospace`
  ctx.textBaseline = 'alphabetic'
  let y = padTop + headerHeight + fontSize
  for (const line of lines) {
    let x = padLeft
    for (const run of line) {
      const expanded = run.text.replace(/\t/g, '    ')
      const colorIndex = tokenColorIndex(run.types)
      ctx.fillStyle = colorIndex == null ? baseColor : colors[colorIndex]
      ctx.fillText(expanded, x, y)
      x += ctx.measureText(expanded).width
    }
    y += lineHeight
  }
  ctx.restore()
  return out
}

module.exports = { renderCodeBlock, normalizeLanguage }
