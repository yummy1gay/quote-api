const { createCanvas, loadImage } = require('canvas')
const { drawMultilineText } = require('./text-renderer')
const { renderMath } = require('./math-renderer')

const typeOf = (value) => String(value && value._ ? value._ : '').replace(/^PageBlock/, '').replace(/^Text/, '').toLowerCase()
const utf16Length = (value) => String(value).length

function richText (node, inherited = []) {
  if (!node) return { text: '', entities: [] }
  if (typeof node === 'string') return { text: node, entities: inherited }
  const type = typeOf(node)
  if (type === 'empty') return { text: '', entities: [] }
  if (type === 'plain') return { text: node.text || '', entities: inherited }
  if (type === 'concat') {
    const result = { text: '', entities: [] }
    for (const child of node.texts || []) {
      const part = richText(child, inherited)
      const offset = utf16Length(result.text)
      result.text += part.text
      result.entities.push(...part.entities.map(entity => ({ ...entity, offset: entity.offset + offset })))
    }
    return result
  }
  if (type === 'math') return { text: node.source || '', entities: inherited.concat([{ type: 'code', offset: 0, length: utf16Length(node.source || '') }]) }
  if (type === 'image') return { text: '\uFFFC', entities: inherited }
  if (type === 'customemoji') {
    const text = node.alt || '\uFFFC'
    return { text, entities: inherited.concat([{ type: 'custom_emoji', offset: 0, length: utf16Length(text), custom_emoji_id: String(node.document_id) }]) }
  }
  if (type === 'date') {
    const date = new Date(Number(node.date || 0) * 1000)
    return { text: Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('en-GB'), entities: inherited }
  }
  if (type === 'diff') {
    const oldValue = richText(node.old_text, inherited)
    const newValue = richText(node.text, inherited)
    const separator = oldValue.text && newValue.text ? '  ' : ''
    const offset = utf16Length(oldValue.text + separator)
    return {
      text: oldValue.text + separator + newValue.text,
      entities: oldValue.entities.concat(
        oldValue.text ? [{ type: 'strikethrough', offset: 0, length: utf16Length(oldValue.text) }] : [],
        newValue.entities.map(entity => ({ ...entity, offset: entity.offset + offset })),
        newValue.text ? [{ type: 'underline', offset, length: utf16Length(newValue.text) }] : []
      )
    }
  }
  const child = richText(node.text, inherited)
  const entityType = {
    bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikethrough',
    fixed: 'code', spoiler: 'spoiler', marked: 'bold', url: 'text_link', email: 'email',
    phone: 'phone_number', mention: 'mention', hashtag: 'hashtag', botcommand: 'bot_command',
    cashtag: 'cashtag', autourl: 'url', autoemail: 'email', autophone: 'phone_number',
    mentionname: 'text_mention', subscript: 'italic', superscript: 'italic'
  }[type]
  if (entityType && child.text) {
    const entity = { type: entityType, offset: 0, length: utf16Length(child.text) }
    if (type === 'url') entity.url = node.url || ''
    if (type === 'mentionname') entity.user = { id: node.user_id }
    child.entities.push(entity)
  }
  return child
}

function stack (canvases, gap = 10, padding = 0) {
  const items = canvases.filter(canvas => canvas && canvas.width && canvas.height)
  if (!items.length) return null
  const width = Math.max(...items.map(canvas => canvas.width)) + padding * 2
  const height = items.reduce((sum, canvas) => sum + canvas.height, 0) + gap * (items.length - 1) + padding * 2
  const out = createCanvas(Math.ceil(width), Math.ceil(height))
  const ctx = out.getContext('2d')
  let y = padding
  for (const canvas of items) {
    ctx.drawImage(canvas, padding, y)
    y += canvas.height + gap
  }
  return out
}

function decorate (canvas, options = {}) {
  if (!canvas) return null
  const pad = options.pad == null ? 12 : options.pad
  const left = options.bar ? 7 : 0
  const out = createCanvas(canvas.width + pad * 2 + left, canvas.height + pad * 2)
  const ctx = out.getContext('2d')
  if (options.fill) {
    ctx.fillStyle = options.fill
    ctx.beginPath()
    roundedRect(ctx, 0, 0, out.width, out.height, 10)
    ctx.fill()
  }
  if (options.bar) {
    ctx.fillStyle = options.bar
    ctx.beginPath()
    roundedRect(ctx, 0, 0, 4, out.height, 2)
    ctx.fill()
  }
  ctx.drawImage(canvas, pad + left, pad)
  return out
}

function roundedRect (ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

async function drawText (node, size, color, maxWidth, maxHeight, emojiBrand, telegram, style) {
  const value = richText(node)
  if (!value.text) return null
  if (style) value.entities.push({ type: style, offset: 0, length: utf16Length(value.text) })
  return drawMultilineText(value.text, value.entities, size, color, 0, size, maxWidth, maxHeight, emojiBrand, telegram)
}

function hasMath (node) {
  if (!node || typeof node !== 'object') return false
  if (typeOf(node) === 'math') return true
  return Object.values(node).some(value => Array.isArray(value) ? value.some(hasMath) : hasMath(value))
}

function mixedRuns (node, styles = [], result = []) {
  if (!node) return result
  if (typeof node === 'string') {
    result.push({ text: node, styles })
    return result
  }
  const type = typeOf(node)
  if (type === 'math') {
    result.push({ math: node.source || '' })
    return result
  }
  if (type === 'concat') {
    for (const child of node.texts || []) mixedRuns(child, styles, result)
    return result
  }
  if (type === 'plain') {
    result.push({ text: node.text || '', styles })
    return result
  }
  const style = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikethrough', fixed: 'code', spoiler: 'spoiler' }[type]
  return mixedRuns(node.text, style ? styles.concat(style) : styles, result)
}

async function drawMixedText (node, size, color, maxWidth, maxHeight, emojiBrand, telegram) {
  const items = []
  for (const run of mixedRuns(node)) {
    if (run.math != null) {
      items.push(renderMath(run.math, { fontSize: size, color, maxWidth, display: false }))
      continue
    }
    for (const token of String(run.text || '').split(/(\s+)/).filter(Boolean)) {
      const entities = run.styles.map(type => ({ type, offset: 0, length: token.length }))
      items.push(await drawMultilineText(token, entities, size, color, 0, size, maxWidth, maxHeight, emojiBrand, telegram))
    }
  }
  const rows = []
  let row = []
  let width = 0
  for (const item of items) {
    if (row.length && width + item.width > maxWidth) {
      rows.push(stackRow(...row))
      row = []
      width = 0
    }
    row.push(item)
    width += item.width
  }
  if (row.length) rows.push(stackRow(...row))
  return stack(rows, size * 0.22)
}

async function drawMedia (block, files, maxWidth) {
  const id = block.photo_id || block.video_id || block.audio_id || block.document_id || block.poster_photo_id
  const file = files[String(id)]
  if (!file || !file.url) return null
  try {
    const image = await loadImage(file.url)
    const ratio = Math.min(1, maxWidth / image.width, 360 / image.height)
    const out = createCanvas(Math.max(1, image.width * ratio), Math.max(1, image.height * ratio))
    out.getContext('2d').drawImage(image, 0, 0, out.width, out.height)
    return out
  } catch (_) {
    return null
  }
}

async function drawCaption (caption, context) {
  if (!caption) return null
  return stack([
    await drawText(caption.text, context.small, context.color, context.width, context.height, context.emojiBrand, context.telegram),
    await drawText(caption.credit, context.small, context.muted, context.width, context.height, context.emojiBrand, context.telegram, 'italic')
  ], 3)
}

async function renderBlock (block, context, depth = 0) {
  if (!block || depth > 32) return null
  const type = typeOf(block)
  const textSizes = { title: 34, subtitle: 26, header: 29, subheader: 25, heading1: 34, heading2: 31, heading3: 28, heading4: 26, heading5: 24, heading6: 22, kicker: 16, footer: 16 }
  if (textSizes[type]) {
    return drawText(block.text, textSizes[type] * context.scale, context.color, context.width, context.height, context.emojiBrand, context.telegram, type === 'kicker' ? 'bold' : null)
  }
  if (type === 'paragraph' || type === 'thinking') {
    const textColor = type === 'thinking' ? context.muted : context.color
    const text = hasMath(block.text)
      ? await drawMixedText(block.text, context.font, textColor, context.width, context.height, context.emojiBrand, context.telegram)
      : await drawText(block.text, context.font, textColor, context.width, context.height, context.emojiBrand, context.telegram, type === 'thinking' ? 'italic' : null)
    return type === 'thinking' ? decorate(text, { fill: context.tint, pad: 10 }) : text
  }
  if (type === 'math') {
    return renderMath(block.source, { fontSize: context.font * 1.12, color: context.color, maxWidth: context.width, display: true })
  }
  if (type === 'preformatted') {
    return decorate(await drawText(block.text, context.small, context.color, context.width - 24, context.height, context.emojiBrand, context.telegram, 'code'), { fill: context.code, pad: 12 })
  }
  if (type === 'authordate') {
    const author = richText(block.author).text
    const date = block.published_date ? new Date(block.published_date * 1000).toLocaleDateString('en-GB') : ''
    return drawText({ _: 'TextPlain', text: [author, date].filter(Boolean).join(' · ') }, context.small, context.muted, context.width, context.height, context.emojiBrand, context.telegram)
  }
  if (type === 'divider') {
    const out = createCanvas(context.width, 1 * context.scale)
    out.getContext('2d').fillStyle = context.muted
    out.getContext('2d').fillRect(0, 0, out.width, out.height)
    return out
  }
  if (type === 'blockquote' || type === 'pullquote') {
    const body = await drawText(block.text, context.font, context.color, context.width - 30, context.height, context.emojiBrand, context.telegram, type === 'pullquote' ? 'italic' : null)
    const caption = await drawText(block.caption, context.small, context.muted, context.width - 30, context.height, context.emojiBrand, context.telegram)
    return decorate(stack([body, caption], 4), { fill: context.tint, bar: context.accent, pad: 10 })
  }
  if (type === 'blockquoteblocks') {
    const body = await renderBlocks(block.blocks, { ...context, width: context.width - 30 }, depth + 1)
    const caption = await drawText(block.caption, context.small, context.muted, context.width - 30, context.height, context.emojiBrand, context.telegram)
    return decorate(stack([body, caption], 5), { fill: context.tint, bar: context.accent, pad: 10 })
  }
  if (type === 'list' || type === 'orderedlist') {
    const rows = []
    let index = Number(block.start || 1)
    for (const item of block.items || []) {
      const marker = type === 'list' ? (item.checked == null ? '•' : (item.checked ? '☑' : '☐')) : `${item.num || index++}.`
      const value = item.text ? await drawText(item.text, context.font, context.color, context.width - 45, context.height, context.emojiBrand, context.telegram) : await renderBlocks(item.blocks, { ...context, width: context.width - 45 }, depth + 1)
      const markerCanvas = await drawText({ _: 'TextPlain', text: marker }, context.font, context.accent, 38 * context.scale, context.height, context.emojiBrand, context.telegram, 'bold')
      rows.push(stackRow(markerCanvas, value, 8 * context.scale))
    }
    return stack(rows, 7 * context.scale)
  }
  if (type === 'details') {
    const title = await drawText(block.title, context.font, context.color, context.width - 30, context.height, context.emojiBrand, context.telegram, 'bold')
    const body = await renderBlocks(block.blocks, { ...context, width: context.width - 24 }, depth + 1)
    return decorate(stack([stackRow(await drawText({ _: 'TextPlain', text: block.open ? '⌄' : '›' }, context.font, context.accent, 20 * context.scale, context.height, context.emojiBrand, context.telegram), title, 5), body], 7), { fill: context.tint, pad: 10 })
  }
  if (type === 'table') return renderTable(block, context)
  if (type === 'buttonrow') {
    const buttons = []
    for (const button of block.buttons || []) {
      buttons.push(decorate(await drawText(button.text, context.small, context.accent, context.width, context.height, context.emojiBrand, context.telegram, 'bold'), { fill: context.tint, pad: 10 }))
    }
    return stackRow(...buttons, 6 * context.scale)
  }
  if (['photo', 'video', 'audio', 'document', 'map', 'cover'].includes(type)) {
    if (type === 'cover' && block.cover) return renderBlock(block.cover, context, depth + 1)
    const media = await drawMedia(block, context.files, context.width)
    const caption = await drawCaption(block.caption, context)
    if (media) return stack([media, caption], 5)
    const label = type === 'document' ? ((context.files[String(block.document_id)] || {}).file_name || 'Document') : type[0].toUpperCase() + type.slice(1)
    return stack([await drawText({ _: 'TextPlain', text: `▣  ${label}` }, context.font, context.color, context.width, context.height, context.emojiBrand, context.telegram), caption], 4)
  }
  if (type === 'collage' || type === 'slideshow') {
    const items = []
    for (const item of block.items || []) items.push(await renderBlock(item, { ...context, width: context.width / 2 - 4 }, depth + 1))
    return stack([stackGrid(items, context.width, 6 * context.scale), await drawCaption(block.caption, context)], 5)
  }
  if (type === 'embedpost') return decorate(await renderBlocks(block.blocks, { ...context, width: context.width - 24 }, depth + 1), { fill: context.tint, pad: 12 })
  if (type === 'embed') {
    const label = block.url || (block.html ? 'Embedded content' : 'Embed')
    return decorate(await drawText({ _: 'TextPlain', text: `↗  ${label}` }, context.small, context.accent, context.width - 24, context.height, context.emojiBrand, context.telegram), { fill: context.tint, pad: 12 })
  }
  if (type === 'channel') {
    const channel = block.channel || {}
    const name = channel.title || channel.username || 'Channel'
    return decorate(await drawText({ _: 'TextPlain', text: `◉  ${name}` }, context.font, context.accent, context.width - 24, context.height, context.emojiBrand, context.telegram, 'bold'), { fill: context.tint, pad: 12 })
  }
  if (type === 'relatedarticles') {
    const rows = [await drawText(block.title, context.font, context.color, context.width, context.height, context.emojiBrand, context.telegram, 'bold')]
    for (const article of block.articles || []) {
      const title = richText(article.title).text || article.url || 'Related article'
      rows.push(await drawText({ _: 'TextPlain', text: `↗  ${title}` }, context.small, context.accent, context.width, context.height, context.emojiBrand, context.telegram))
    }
    return stack(rows, 6)
  }
  if (block.text) return drawText(block.text, context.font, context.color, context.width, context.height, context.emojiBrand, context.telegram)
  if (block.blocks) return renderBlocks(block.blocks, context, depth + 1)
  return null
}

function stackRow (...args) {
  const gap = typeof args[args.length - 1] === 'number' ? args.pop() : 0
  const items = args.filter(Boolean)
  if (!items.length) return null
  const out = createCanvas(items.reduce((n, item) => n + item.width, 0) + gap * (items.length - 1), Math.max(...items.map(item => item.height)))
  let x = 0
  for (const item of items) {
    out.getContext('2d').drawImage(item, x, 0)
    x += item.width + gap
  }
  return out
}

function stackGrid (items, width, gap) {
  const rows = []
  for (let i = 0; i < items.length; i += 2) rows.push(stackRow(items[i], items[i + 1], gap))
  return stack(rows.map(row => row && row.width > width ? resize(row, width) : row), gap)
}

function resize (canvas, width) {
  const out = createCanvas(width, canvas.height * width / canvas.width)
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height)
  return out
}

async function renderTable (block, context) {
  const rows = []
  const columns = Math.max(1, ...(block.rows || []).map(row => (row.cells || []).length))
  const cellWidth = context.width / columns
  for (const row of block.rows || []) {
    const cells = []
    for (const cell of row.cells || []) {
      const text = await drawText(cell.text, context.small, context.color, cellWidth - 16, context.height, context.emojiBrand, context.telegram, cell.header ? 'bold' : null)
      cells.push(decorate(text, { fill: cell.header ? context.tint : context.code, pad: 8 }))
    }
    rows.push(stackRow(...cells, 2))
  }
  return stack([await drawText(block.title, context.font, context.color, context.width, context.height, context.emojiBrand, context.telegram, 'bold'), stack(rows, 2)], 6)
}

async function renderBlocks (blocks, context, depth = 0) {
  const rendered = []
  for (const block of blocks || []) rendered.push(await renderBlock(block, context, depth))
  return stack(rendered, 10 * context.scale)
}

async function renderRichMessage (rich, options) {
  if (!rich || !Array.isArray(rich.blocks)) return null
  const context = {
    scale: options.scale,
    font: 21 * options.scale,
    small: 16 * options.scale,
    color: options.color,
    muted: options.muted,
    accent: options.accent,
    tint: options.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    code: options.dark ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.07)',
    width: options.width,
    height: options.height,
    emojiBrand: options.emojiBrand,
    telegram: options.telegram,
    files: rich.files || {}
  }
  return renderBlocks(rich.blocks, context)
}

module.exports = { renderRichMessage, richText, typeOf }
