const { createCanvas } = require('canvas')

const SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ϵ', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', sigma: 'σ', varsigma: 'ς',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ',
  Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', infty: '∞', partial: '∂',
  nabla: '∇', pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗', circ: '∘', bullet: '•', le: '≤', leq: '≤',
  ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝', in: '∈', notin: '∉', ni: '∋',
  subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', forall: '∀', exists: '∃',
  neg: '¬', land: '∧', lor: '∨', to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐',
  Leftrightarrow: '⇔', mapsto: '↦', degree: '°', prime: '′', ell: 'ℓ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ', emptyset: '∅', angle: '∠'
}

const OPERATORS = { sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂', bigvee: '⋁', bigwedge: '⋀' }
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'gcd'])

function font (size, upright = false) {
  return `${upright ? '' : 'italic '}${size}px Georgia, "Times New Roman", serif`
}

function textBox (text, size, color, upright = false) {
  const probe = createCanvas(1, 1).getContext('2d')
  probe.font = font(size, upright)
  const metrics = probe.measureText(text)
  const ascent = metrics.actualBoundingBoxAscent || size * 0.78
  const descent = metrics.actualBoundingBoxDescent || size * 0.22
  return {
    w: Math.max(1, metrics.width), h: ascent + descent, baseline: ascent,
    draw: (ctx, x, y) => {
      ctx.font = font(size, upright)
      ctx.fillStyle = color
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(text, x, y + ascent)
    }
  }
}

function rowBox (items, gap = 1) {
  const children = items.filter(Boolean)
  if (!children.length) return { w: 1, h: 1, baseline: 1, draw: () => {} }
  const baseline = Math.max(...children.map(box => box.baseline))
  const descent = Math.max(...children.map(box => box.h - box.baseline))
  return {
    w: children.reduce((sum, box) => sum + box.w, 0) + gap * (children.length - 1), h: baseline + descent, baseline,
    draw: (ctx, x, y) => {
      let dx = x
      for (const box of children) {
        box.draw(ctx, dx, y + baseline - box.baseline)
        dx += box.w + gap
      }
    }
  }
}

function scriptBox (base, sub, sup, size) {
  if (!sub && !sup) return base
  const gap = size * 0.06
  const scriptsWidth = Math.max(sub ? sub.w : 0, sup ? sup.w : 0)
  const baseline = Math.max(base.baseline, (sup ? sup.h + gap : 0) + base.baseline * 0.62)
  const subTop = baseline + gap
  const height = Math.max(baseline + (base.h - base.baseline), sub ? subTop + sub.h : 0)
  return {
    w: base.w + scriptsWidth + gap, h: height, baseline,
    draw: (ctx, x, y) => {
      base.draw(ctx, x, y + baseline - base.baseline)
      if (sup) sup.draw(ctx, x + base.w + gap, y)
      if (sub) sub.draw(ctx, x + base.w + gap, y + subTop)
    }
  }
}

function fractionBox (numerator, denominator, size, color) {
  const pad = size * 0.18
  const gap = size * 0.12
  const line = Math.max(1, size * 0.045)
  const width = Math.max(numerator.w, denominator.w) + pad * 2
  const baseline = numerator.h + gap + line + gap + denominator.baseline
  return {
    w: width, h: numerator.h + denominator.h + gap * 2 + line, baseline,
    draw: (ctx, x, y) => {
      numerator.draw(ctx, x + (width - numerator.w) / 2, y)
      const lineY = y + numerator.h + gap
      ctx.fillStyle = color
      ctx.fillRect(x, lineY, width, line)
      denominator.draw(ctx, x + (width - denominator.w) / 2, lineY + line + gap)
    }
  }
}

function rootBox (body, index, size, color) {
  const root = textBox('√', Math.max(size * 1.1, body.h * 1.03), color, true)
  const pad = size * 0.1
  const overline = Math.max(1, size * 0.045)
  const indexWidth = index ? index.w * 0.7 : 0
  const baseline = Math.max(root.baseline, body.baseline + pad)
  return {
    w: indexWidth + root.w + body.w + pad, h: Math.max(root.h, body.h + pad + overline), baseline,
    draw: (ctx, x, y) => {
      if (index) index.draw(ctx, x, y)
      root.draw(ctx, x + indexWidth, y + baseline - root.baseline)
      const bodyX = x + indexWidth + root.w
      ctx.fillStyle = color
      ctx.fillRect(bodyX - pad * 0.35, y, body.w + pad, overline)
      body.draw(ctx, bodyX, y + pad + overline)
    }
  }
}

function fencedBox (body, left, right, size, color) {
  const fenceSize = Math.max(size, body.h * 1.03)
  return rowBox([left === '.' ? null : textBox(left, fenceSize, color, true), body, right === '.' ? null : textBox(right, fenceSize, color, true)], size * 0.08)
}

function matrixBox (rows, size, color, left = '[', right = ']') {
  const columns = Math.max(1, ...rows.map(row => row.length))
  const widths = Array(columns).fill(0)
  for (const row of rows) row.forEach((cell, column) => { widths[column] = Math.max(widths[column], cell.w) })
  const colGap = size * 0.55
  const rowGap = size * 0.3
  const rowHeights = rows.map(row => Math.max(...row.map(cell => cell.h), size))
  const bodyWidth = widths.reduce((a, b) => a + b, 0) + colGap * (columns - 1)
  const bodyHeight = rowHeights.reduce((a, b) => a + b, 0) + rowGap * (rows.length - 1)
  const body = {
    w: bodyWidth, h: bodyHeight, baseline: bodyHeight / 2 + size * 0.28,
    draw: (ctx, x, y) => {
      let dy = y
      rows.forEach((row, rowIndex) => {
        let dx = x
        row.forEach((cell, column) => {
          cell.draw(ctx, dx + (widths[column] - cell.w) / 2, dy + (rowHeights[rowIndex] - cell.h) / 2)
          dx += widths[column] + colGap
        })
        dy += rowHeights[rowIndex] + rowGap
      })
    }
  }
  return fencedBox(body, left, right, size, color)
}

class Parser {
  constructor (source, size, color) {
    this.source = String(source || '').replace(/\s+/g, ' ').trim()
    this.pos = 0
    this.size = size
    this.color = color
  }

  parse (stop = null) {
    const items = []
    while (this.pos < this.source.length && this.source[this.pos] !== stop) {
      if (/\s/.test(this.source[this.pos])) {
        this.pos++
        items.push(textBox(' ', this.size, this.color, true))
        continue
      }
      let base = this.atom()
      let sub = null
      let sup = null
      while (this.source[this.pos] === '_' || this.source[this.pos] === '^') {
        const kind = this.source[this.pos++]
        const value = this.group(this.size * 0.7)
        if (kind === '_') sub = value
        else sup = value
      }
      base = scriptBox(base, sub, sup, this.size)
      items.push(base)
    }
    if (stop && this.source[this.pos] === stop) this.pos++
    return rowBox(items, this.size * 0.035)
  }

  group (size = this.size) {
    if (this.source[this.pos] === '{') {
      this.pos++
      const child = new Parser('', size, this.color)
      child.source = this.source
      child.pos = this.pos
      const result = child.parse('}')
      this.pos = child.pos
      return result
    }
    const oldSize = this.size
    this.size = size
    const result = this.atom()
    this.size = oldSize
    return result
  }

  command () {
    this.pos++
    if (!/[A-Za-z]/.test(this.source[this.pos] || '')) return this.source[this.pos++] || ''
    const start = this.pos
    while (/[A-Za-z]/.test(this.source[this.pos] || '')) this.pos++
    return this.source.slice(start, this.pos)
  }

  atom () {
    const char = this.source[this.pos]
    if (char === '{') return this.group()
    if (char !== '\\') {
      this.pos++
      return textBox(char, this.size, this.color, /[0-9.,=+\-:;]/.test(char))
    }
    const command = this.command()
    if (command === 'frac' || command === 'dfrac' || command === 'tfrac') {
      return fractionBox(this.group(this.size * 0.9), this.group(this.size * 0.9), this.size, this.color)
    }
    if (command === 'sqrt') {
      let index = null
      if (this.source[this.pos] === '[') {
        this.pos++
        const parser = new Parser('', this.size * 0.55, this.color)
        parser.source = this.source
        parser.pos = this.pos
        index = parser.parse(']')
        this.pos = parser.pos
      }
      return rootBox(this.group(), index, this.size, this.color)
    }
    if (command === 'left') {
      const left = this.readDelimiter()
      const end = this.source.indexOf('\\right', this.pos)
      if (end >= 0) {
        const inside = new Parser(this.source.slice(this.pos, end), this.size, this.color).parse()
        this.pos = end + 6
        return fencedBox(inside, left, this.readDelimiter(), this.size, this.color)
      }
    }
    if (command === 'begin') return this.environment()
    if (command === 'text' || command === 'mathrm' || command === 'operatorname') {
      const value = this.group()
      return value
    }
    if (OPERATORS[command]) return textBox(OPERATORS[command], this.size * 1.3, this.color, true)
    if (SYMBOLS[command]) return textBox(SYMBOLS[command], this.size, this.color, false)
    if (FUNCTIONS.has(command)) return textBox(command, this.size, this.color, true)
    if (command === ',' || command === ';' || command === 'quad' || command === 'qquad') return textBox(' '.repeat(command === 'qquad' ? 4 : command === 'quad' ? 2 : 1), this.size, this.color, true)
    return textBox(command, this.size, this.color, true)
  }

  readDelimiter () {
    while (/\s/.test(this.source[this.pos] || '')) this.pos++
    if (this.source[this.pos] === '\\') {
      const value = this.command()
      return { langle: '⟨', rangle: '⟩', lbrace: '{', rbrace: '}', vert: '|' }[value] || value
    }
    return this.source[this.pos++] || '.'
  }

  environment () {
    const name = this.readRawGroup()
    const endToken = `\\end{${name}}`
    const end = this.source.indexOf(endToken, this.pos)
    if (end < 0) return textBox(name, this.size, this.color, true)
    const content = this.source.slice(this.pos, end)
    this.pos = end + endToken.length
    const rows = content.split(/\\\\/).map(row => row.split('&').map(cell => new Parser(cell, this.size * 0.9, this.color).parse()))
    const fences = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'] }[name] || ['.', '.']
    return matrixBox(rows, this.size, this.color, fences[0], fences[1])
  }

  readRawGroup () {
    if (this.source[this.pos] !== '{') return ''
    const start = ++this.pos
    const end = this.source.indexOf('}', start)
    if (end < 0) return ''
    this.pos = end + 1
    return this.source.slice(start, end)
  }
}

function renderMath (source, options = {}) {
  const size = Math.max(8, options.fontSize || 28)
  const color = options.color || '#fff'
  let box
  try {
    box = new Parser(source, size, color).parse()
  } catch (_) {
    box = textBox(String(source || '[math]'), size, color)
  }
  const padding = Math.ceil(size * (options.display ? 0.35 : 0.12))
  const maxWidth = Math.max(1, options.maxWidth || box.w + padding * 2)
  const ratio = Math.min(1, (maxWidth - padding * 2) / box.w)
  const out = createCanvas(Math.ceil(box.w * ratio + padding * 2), Math.ceil(box.h * ratio + padding * 2))
  const ctx = out.getContext('2d')
  ctx.save()
  ctx.translate(padding, padding)
  ctx.scale(ratio, ratio)
  box.draw(ctx, 0, 0)
  ctx.restore()
  return out
}

module.exports = { renderMath, Parser }
