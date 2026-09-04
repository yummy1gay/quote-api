const { createCanvas, loadImage } = require('canvas')
const sharp = require('sharp')
const { drawMultilineText } = require('./text-renderer')
const { renderMath } = require('./math-renderer')
const { renderCodeBlock } = require('./code-block')
const { paintCopyIcon, paintMapPoint, paintQuoteIcon } = require('./tdesktop-icons')
const { drawDocumentRow, drawAudioRow, paintMediaBadges } = require('./attachments')
const { hexToRgb, normalizeColor, lightOrDark } = require('./color')
const loadImageFromUrl = require('../image-load-url')

const typeOf = (value) => String(value && value._ ? value._ : '')
  .replace(/^PageBlock/, '')
  .replace(/^Text/, '')
  .toLowerCase()
const utf16Length = (value) => String(value).length
const cloneEntities = (entities) => entities.map(entity => ({ ...entity }))

function richText (node, inherited = []) {
  if (!node) return { text: '', entities: [] }
  if (typeof node === 'string') return { text: node, entities: cloneEntities(inherited) }
  const type = typeOf(node)
  if (type === 'empty') return { text: '', entities: [] }
  if (type === 'plain') {
    return {
      text: node.text || '',
      entities: cloneEntities(inherited)
    }
  }
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
  if (type === 'math') {
    const source = node.source || ''
    return { text: source, entities: inherited.concat([{ type: 'code', offset: 0, length: utf16Length(source) }]) }
  }
  if (type === 'image') return { text: '[image]', entities: cloneEntities(inherited) }
  if (type === 'customemoji') {
    const text = node.alt || '\uFFFC'
    return {
      text,
      entities: inherited.concat([{
        type: 'custom_emoji',
        offset: 0,
        length: utf16Length(text),
        custom_emoji_id: String(node.document_id)
      }])
    }
  }
  if (type === 'button') {
    const label = richText(node.text)
    if (!label.text) return { text: '', entities: [] }
    return {
      text: '\uFFFC',
      entities: inherited.concat([{
        type: 'inline_button',
        offset: 0,
        length: 1,
        button: node,
        label
      }])
    }
  }
  if (type === 'date') {
    // TextDate already carries Telegram's localized fallback text. Its date
    // may arrive as an ISO string after TL serialization, so preserve the
    // canonical visible value instead of attempting a numeric-only parse.
    return richText(node.text, inherited)
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
    bold: 'bold',
    italic: 'italic',
    underline: 'underline',
    strike: 'strikethrough',
    fixed: 'code',
    spoiler: 'spoiler',
    marked: 'marked',
    url: 'text_link',
    email: 'email',
    phone: 'phone_number',
    mention: 'mention',
    hashtag: 'hashtag',
    botcommand: 'bot_command',
    cashtag: 'cashtag',
    autourl: 'url',
    autoemail: 'email',
    autophone: 'phone_number',
    mentionname: 'text_mention',
    subscript: 'italic',
    superscript: 'italic'
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

function stackCentered (canvases, gap = 10, padding = 0) {
  const items = canvases.filter(canvas => canvas && canvas.width && canvas.height)
  if (!items.length) return null
  const width = Math.max(...items.map(canvas => canvas.width)) + padding * 2
  const height = items.reduce((sum, canvas) => sum + canvas.height, 0) + gap * (items.length - 1) + padding * 2
  const out = createCanvas(Math.ceil(width), Math.ceil(height))
  const ctx = out.getContext('2d')
  let y = padding
  for (const canvas of items) {
    ctx.drawImage(canvas, (out.width - canvas.width) / 2, y)
    y += canvas.height + gap
  }
  return out
}

function centerCanvas (canvas, width) {
  if (!canvas) return null
  const outWidth = Math.max(canvas.width, Math.ceil(width))
  if (outWidth === canvas.width) return canvas
  const out = createCanvas(outWidth, canvas.height)
  out.getContext('2d').drawImage(canvas, (out.width - canvas.width) / 2, 0)
  return out
}

function decorate (canvas, options = {}) {
  if (!canvas) return null
  const pad = options.pad == null ? 12 : options.pad
  const barWidth = options.barWidth || 4
  const barGap = options.barGap == null ? 3 : options.barGap
  const left = options.bar ? barWidth + barGap : 0
  const radius = options.radius == null ? 10 : options.radius
  const out = createCanvas(
    Math.max(1, Math.ceil(canvas.width + pad * 2 + left)),
    Math.max(1, Math.ceil(canvas.height + pad * 2))
  )
  const ctx = out.getContext('2d')
  if (options.fill) {
    ctx.fillStyle = options.fill
    ctx.beginPath()
    roundedRect(ctx, 0, 0, out.width, out.height, radius)
    ctx.fill()
  }
  if (options.stroke) {
    const lineWidth = options.lineWidth || 1
    ctx.strokeStyle = options.stroke
    ctx.lineWidth = lineWidth
    ctx.beginPath()
    roundedRect(ctx, lineWidth / 2, lineWidth / 2, out.width - lineWidth, out.height - lineWidth, radius)
    ctx.stroke()
  }
  if (options.bar) {
    ctx.save()
    ctx.beginPath()
    roundedRect(ctx, 0, 0, out.width, out.height, radius)
    ctx.clip()
    ctx.fillStyle = options.bar
    ctx.fillRect(0, 0, barWidth, out.height)
    ctx.restore()
  }
  ctx.drawImage(canvas, pad + left, pad)
  return out
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

function withAlpha (color, alpha) {
  const [r, g, b] = hexToRgb(normalizeColor(color))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

async function drawText (node, size, color, maxWidth, maxHeight, emojiBrand, telegram, style, files, accent, scale) {
  const value = richText(node)
  if (!value.text) return null
  if (style) value.entities.push({ type: style, offset: 0, length: utf16Length(value.text) })
  for (const entity of value.entities) {
    if (entity.type !== 'inline_button') continue
    entity.inlineButtonImage = await renderInlineButton(
      entity.button,
      entity.label,
      {
        size,
        color,
        accent: accent || color,
        scale: scale || Math.max(1, size / 16),
        maxWidth,
        maxHeight,
        emojiBrand,
        telegram,
        files
      }
    )
  }
  return drawMultilineText(
    value.text,
    value.entities,
    size,
    color,
    0,
    size,
    maxWidth,
    maxHeight,
    emojiBrand,
    telegram,
    files,
    { markColor: accent || color }
  )
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
  if (['customemoji', 'date', 'button', 'diff', 'image'].includes(type)) {
    result.push({ value: richText(node), styles })
    return result
  }
  const style = {
    bold: 'bold',
    italic: 'italic',
    underline: 'underline',
    strike: 'strikethrough',
    fixed: 'code',
    spoiler: 'spoiler',
    marked: 'marked',
    url: 'mention',
    email: 'mention',
    phone: 'mention',
    mention: 'mention',
    hashtag: 'mention',
    botcommand: 'mention',
    cashtag: 'mention',
    autourl: 'mention',
    autoemail: 'mention',
    autophone: 'mention',
    mentionname: 'mention',
    subscript: 'italic',
    superscript: 'italic'
  }[type]
  return mixedRuns(node.text, style ? styles.concat(style) : styles, result)
}

async function drawMixedText (node, size, color, maxWidth, maxHeight, emojiBrand, telegram, files, accent) {
  const items = []
  for (const run of mixedRuns(node)) {
    if (run.math != null) {
      items.push(renderMath(run.math, { fontSize: size, color, maxWidth, display: false }))
      continue
    }
    if (run.value) {
      const entities = run.value.entities.concat(
        run.styles.map(type => ({ type, offset: 0, length: utf16Length(run.value.text) }))
      )
      items.push(await drawMultilineText(
        run.value.text,
        entities,
        size,
        color,
        0,
        size,
        maxWidth,
        maxHeight,
        emojiBrand,
        telegram,
        files,
        { markColor: accent || color }
      ))
      continue
    }
    for (const token of String(run.text || '').split(/(\s+)/).filter(Boolean)) {
      const entities = run.styles.map(type => ({ type, offset: 0, length: token.length }))
      items.push(await drawMultilineText(
        token,
        entities,
        size,
        color,
        0,
        size,
        maxWidth,
        maxHeight,
        emojiBrand,
        telegram,
        files,
        { markColor: accent || color }
      ))
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

function mediaId (block) {
  return block.photo_id || block.video_id || block.audio_id || block.document_id || block.poster_photo_id || block.map_preview_key
}

function findFile (files, id) {
  if (!files || id == null) return null
  const exact = files[String(id)]
  if (exact) return exact
  const numeric = Number(id)
  const match = Object.entries(files).find(([key]) => Number(key) === numeric)
  return match ? match[1] : null
}

async function loadFileImage (file, cache) {
  if (!file || !file.url) return null
  const key = file.url
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const data = await loadImageFromUrl(file.url).catch(() => null)
      if (!data) return null
      const png = await sharp(data, { animated: false }).rotate().png().toBuffer().catch(() => null)
      return loadImage(png || data).catch(() => null)
    })())
  }
  return cache.get(key)
}

function clipRoundedImage (image, width, height, radius) {
  const out = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
  const ctx = out.getContext('2d')
  ctx.beginPath()
  roundedRect(ctx, 0, 0, out.width, out.height, radius)
  ctx.clip()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, out.width, out.height)
  return out
}

function coverRoundedImage (image, width, height, radius) {
  const out = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
  const ctx = out.getContext('2d')
  ctx.beginPath()
  roundedRect(ctx, 0, 0, out.width, out.height, radius)
  ctx.clip()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const ratio = Math.max(out.width / image.width, out.height / image.height)
  const sourceWidth = out.width / ratio
  const sourceHeight = out.height / ratio
  const sourceX = (image.width - sourceWidth) / 2
  const sourceY = (image.height - sourceHeight) / 2
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, out.width, out.height)
  return out
}

async function drawMedia (block, context, play = false, map = false) {
  const file = findFile(context.files, mediaId(block))
  const image = await loadFileImage(file, context.imageCache)
  if (!image) return null
  const maxHeight = 360 * context.scale
  const ratio = Math.min(context.width / image.width, maxHeight / image.height)
  const media = clipRoundedImage(
    image,
    Math.max(1, image.width * ratio),
    Math.max(1, image.height * ratio),
    8 * context.scale
  )
  if (map) {
    paintMapPoint(media.getContext('2d'), 0, 0, media.width, media.height, context.scale)
  }
  if (play) {
    paintMediaBadges(media.getContext('2d'), 0, 0, media.width, media.height, { play: true }, context.scale)
  }
  return centerCanvas(media, context.width)
}

async function drawGroupedMediaTile (block, width, height, context) {
  const file = findFile(context.files, mediaId(block))
  const image = await loadFileImage(file, context.imageCache)
  if (!image) return null
  const tile = coverRoundedImage(image, width, height, 3 * context.scale)
  if (typeOf(block) === 'video') {
    paintMediaBadges(tile.getContext('2d'), 0, 0, tile.width, tile.height, { play: true }, context.scale)
  }
  return tile
}

async function drawCaption (caption, context) {
  if (!caption) return null
  return stack([
    await drawText(
      caption.text,
      context.small,
      context.color,
      context.width,
      context.height,
      context.emojiBrand,
      context.telegram,
      null,
      context.files,
      context.accent,
      context.scale
    ),
    await drawText(
      caption.credit,
      context.small,
      context.muted,
      context.width,
      context.height,
      context.emojiBrand,
      context.telegram,
      'italic',
      context.files,
      context.accent,
      context.scale
    )
  ], 3 * context.scale)
}

function paintQuoteGlyph (ctx, x, y, size, color, closing = false) {
  paintQuoteIcon(ctx, closing ? x - size : x, y, size, color)
}

async function renderQuoteBlock (block, context, depth, containsBlocks = false) {
  const s = context.scale
  const left = 10 * s
  const right = 20 * s
  const top = 3 * s
  const bottom = 4 * s
  const innerWidth = Math.max(1, context.width - left - right)
  const body = containsBlocks
    ? await renderBlocks(block.blocks, { ...context, width: innerWidth }, depth + 1)
    : await drawText(
      block.text,
      context.font,
      context.color,
      innerWidth,
      context.height,
      context.emojiBrand,
      context.telegram,
      null,
      context.files,
      context.accent,
      context.scale
    )
  const caption = await drawText(
    block.caption,
    context.small,
    context.muted,
    innerWidth,
    context.height,
    context.emojiBrand,
    context.telegram,
    null,
    context.files,
    context.accent,
    context.scale
  )
  const content = stack([body, caption], 4 * s)
  if (!content) return null
  const out = createCanvas(
    Math.max(1, Math.ceil(context.width)),
    Math.max(1, Math.ceil(content.height + top + bottom))
  )
  const ctx = out.getContext('2d')
  const cardRadius = 7 * s
  ctx.fillStyle = context.tint
  ctx.beginPath()
  roundedRect(ctx, 0, 0, out.width, out.height, cardRadius)
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  roundedRect(ctx, 0, 0, out.width, out.height, cardRadius)
  ctx.clip()
  ctx.fillStyle = context.accent
  ctx.fillRect(0, 0, 3 * s, out.height)
  ctx.restore()
  paintQuoteGlyph(ctx, out.width - 5 * s, 1 * s, 18 * s, context.accent, true)
  ctx.drawImage(content, left, top)
  return out
}

async function renderPullquote (block, context) {
  const s = context.scale
  const inset = 22 * s
  const innerWidth = Math.max(1, Math.min(280 * s, context.width - inset * 2))
  const body = await drawText(
    block.text,
    context.font,
    context.color,
    innerWidth,
    context.height,
    context.emojiBrand,
    context.telegram,
    'italic',
    context.files,
    context.accent,
    context.scale
  )
  const caption = await drawText(
    block.caption,
    context.small,
    context.muted,
    innerWidth,
    context.height,
    context.emojiBrand,
    context.telegram,
    null,
    context.files,
    context.accent,
    context.scale
  )
  const content = stackCentered([body, caption], 4 * s)
  if (!content) return null
  const cardWidth = Math.min(context.width, Math.max(content.width + inset * 2, 84 * s))
  const cardHeight = content.height + 16 * s
  const out = createCanvas(Math.max(1, Math.ceil(context.width)), Math.max(1, Math.ceil(cardHeight)))
  const ctx = out.getContext('2d')
  const x = (out.width - cardWidth) / 2
  ctx.fillStyle = context.tint
  ctx.beginPath()
  roundedRect(ctx, x, 0, cardWidth, cardHeight, 7 * s)
  ctx.fill()
  paintQuoteGlyph(ctx, x + 7 * s, 1 * s, 18 * s, context.accent)
  paintQuoteGlyph(ctx, x + cardWidth - 7 * s, cardHeight - 21 * s, 18 * s, context.accent, true)
  ctx.drawImage(content, (out.width - content.width) / 2, 8 * s)
  return out
}

async function renderGroupedMedia (block, type, context) {
  const s = context.scale
  const items = (block.items || []).filter(Boolean)
  if (!items.length) return drawCaption(block.caption, context)
  let media
  if (type === 'slideshow') {
    const height = Math.min(360 * s, Math.max(160 * s, context.width * 9 / 16))
    media = await drawGroupedMediaTile(items[0], context.width, height, context)
  } else {
    const gap = 2 * s
    const rows = []
    for (let i = 0; i < items.length; i += 2) {
      const pair = items.slice(i, i + 2)
      if (pair.length === 1) {
        const height = Math.min(360 * s, Math.max(160 * s, context.width * 9 / 16))
        rows.push(await drawGroupedMediaTile(pair[0], context.width, height, context))
        continue
      }
      const tileWidth = (context.width - gap) / 2
      const tiles = await Promise.all(pair.map(item => drawGroupedMediaTile(item, tileWidth, tileWidth, context)))
      rows.push(stackRow(...tiles, gap, 'top'))
    }
    media = stack(rows, gap)
  }
  return stack([media, await drawCaption(block.caption, context)], 8 * s)
}

async function renderDetails (block, context, depth) {
  const s = context.scale
  const horizontalPadding = 11 * s
  const headerTop = 4 * s
  const headerBottom = 4 * s
  const bodyTop = 4 * s
  const bodyBottom = 6 * s
  const iconSize = 14 * s
  const iconSkip = 8 * s
  const innerWidth = Math.max(1, context.width - horizontalPadding * 2)
  const title = await drawText(
    block.title,
    context.font,
    context.color,
    Math.max(1, innerWidth - iconSize - iconSkip),
    context.height,
    context.emojiBrand,
    context.telegram,
    null,
    context.files,
    context.accent,
    context.scale
  )
  const icon = createCanvas(iconSize, iconSize)
  const iconContext = icon.getContext('2d')
  iconContext.strokeStyle = context.muted
  iconContext.lineWidth = Math.max(1, 1.5 * s)
  iconContext.lineCap = 'round'
  iconContext.lineJoin = 'round'
  iconContext.beginPath()
  if (block.open) {
    iconContext.moveTo(3 * s, 5 * s)
    iconContext.lineTo(7 * s, 9 * s)
    iconContext.lineTo(11 * s, 5 * s)
  } else {
    iconContext.moveTo(5 * s, 3 * s)
    iconContext.lineTo(9 * s, 7 * s)
    iconContext.lineTo(5 * s, 11 * s)
  }
  iconContext.stroke()
  const header = stackRow(icon, title, iconSkip)
  const body = block.open
    ? await renderBlocks(block.blocks, { ...context, width: innerWidth }, depth + 1)
    : null
  const headerHeight = headerTop + Math.max(header ? header.height : 0, iconSize) + headerBottom
  const bodyHeight = body ? bodyTop + body.height + bodyBottom : 0
  const dividerHeight = Math.max(1, Math.round(s))
  const out = createCanvas(
    Math.max(1, Math.ceil(context.width)),
    Math.max(1, Math.ceil(headerHeight + bodyHeight + dividerHeight))
  )
  const outContext = out.getContext('2d')
  if (header) outContext.drawImage(header, horizontalPadding, headerTop)
  if (body) outContext.drawImage(body, horizontalPadding, headerHeight + bodyTop)
  outContext.fillStyle = context.divider
  outContext.fillRect(0, out.height - dividerHeight, out.width, dividerHeight)
  return out
}

async function renderMediaPlaceholder (label, context, kind = '') {
  const s = context.scale
  const text = await drawText(
    { _: 'TextPlain', text: label },
    context.small,
    context.muted,
    context.width - 56 * s,
    context.height,
    context.emojiBrand,
    context.telegram,
    'bold',
    context.files,
    context.accent,
    context.scale
  )
  const icon = createCanvas(30 * s, 30 * s)
  const ctx = icon.getContext('2d')
  ctx.fillStyle = context.link
  ctx.beginPath()
  ctx.arc(15 * s, 15 * s, 15 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  if (kind === 'map') {
    ctx.beginPath()
    ctx.arc(15 * s, 12 * s, 5 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(10.7 * s, 15 * s)
    ctx.lineTo(15 * s, 23 * s)
    ctx.lineTo(19.3 * s, 15 * s)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = context.link
    ctx.beginPath()
    ctx.arc(15 * s, 12 * s, 2 * s, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(12 * s, 9 * s)
    ctx.lineTo(22 * s, 15 * s)
    ctx.lineTo(12 * s, 21 * s)
    ctx.closePath()
    ctx.fill()
  }
  return decorate(stackRow(icon, text, 8 * s), {
    fill: context.code,
    pad: 8 * s,
    radius: 8 * s
  })
}

async function renderDocumentBlock (block, type, context) {
  const s = context.scale
  const file = findFile(context.files, mediaId(block)) || {}
  const maxWidth = Math.max(1, context.width - 16 * s)
  let row
  if (type === 'audio') {
    const thumb = await loadFileImage(file, context.imageCache)
    row = drawAudioRow({
      title: file.title || file.file_name || 'Audio',
      performer: file.performer,
      duration: file.duration
    }, context.accent, context.color, s, maxWidth, thumb)
  } else {
    row = drawDocumentRow({
      file_name: file.file_name || 'Document',
      file_size: file.file_size
    }, context.accent, context.color, s, maxWidth)
  }
  const card = decorate(row, {
    fill: context.code,
    stroke: type === 'audio' ? null : context.border,
    lineWidth: Math.max(1, s),
    pad: 7 * s,
    radius: 8 * s
  })
  return stack([card, await drawCaption(block.caption, context)], 8 * s)
}

function buttonType (button) {
  return String(button && button.type && button.type._ ? button.type._ : '')
    .replace(/^InlineButtonType/, '')
    .toLowerCase()
}

function buttonAppearance (button, context) {
  const style = button.style || {}
  let color = context.buttonFill || (context.dark ? '#ffffff' : '#000000')
  let fillAlpha = context.buttonFill ? 1 : 0.08
  const foreground = context.dark ? '#ffffff' : '#000000'
  if (style.bg_danger) color = '#e05d5d'
  else if (style.bg_primary) {
    color = context.link || '#3390ec'
    fillAlpha = 1
  } else if (style.bg_success) color = '#4fae78'
  const disabled = buttonType(button) === 'disabled'
  return {
    fill: color,
    fillAlpha,
    foreground,
    opacity: disabled ? (style.bg_primary ? 0.6 : 0.33) : 1
  }
}

function buttonHasIcon (button) {
  return ['url', 'urlauth', 'webview', 'copy', 'switchinline', 'userprofile'].includes(buttonType(button))
}

function paintButtonIcon (ctx, type, x, y, size, color) {
  if (type === 'copy') {
    paintCopyIcon(ctx, 'button', x, y, size, color)
    return
  }
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, size * 0.11)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x + size * 0.25, y + size * 0.75)
  ctx.lineTo(x + size * 0.75, y + size * 0.25)
  ctx.moveTo(x + size * 0.43, y + size * 0.25)
  ctx.lineTo(x + size * 0.75, y + size * 0.25)
  ctx.lineTo(x + size * 0.75, y + size * 0.57)
  ctx.stroke()
  ctx.restore()
}

async function renderInlineButton (button, labelValue, options) {
  const s = options.scale
  const dark = lightOrDark(options.color) === 'light'
  const appearance = buttonAppearance(button, {
    dark,
    link: dark ? '#6ab7ec' : '#3390ec'
  })
  const label = await drawMultilineText(
    labelValue.text,
    labelValue.entities.concat([{
      type: 'bold',
      offset: 0,
      length: utf16Length(labelValue.text)
    }]),
    12 * s,
    appearance.foreground,
    0,
    12 * s,
    Math.max(1, options.maxWidth - 12 * s),
    options.maxHeight,
    options.emojiBrand,
    options.telegram,
    options.files
  )
  const height = Math.max(1, Math.min(options.size * 1.15, Math.max(14 * s, label.height + 4 * s)))
  const icon = buttonHasIcon(button)
  const iconSize = buttonType(button) === 'copy' ? 10 * s : 11 * s
  const trailing = icon ? 17 * s : 6 * s
  const width = Math.max(height, Math.min(options.maxWidth, 6 * s + label.width + trailing))
  const out = createCanvas(Math.ceil(width), Math.ceil(height))
  const ctx = out.getContext('2d')
  ctx.save()
  ctx.globalAlpha = appearance.opacity * appearance.fillAlpha
  ctx.fillStyle = appearance.fill
  ctx.beginPath()
  roundedRect(ctx, 0, 0, out.width, out.height, out.height / 2)
  ctx.fill()
  ctx.restore()
  const available = Math.max(1, out.width - 6 * s - trailing)
  const renderedLabel = label.width > available ? cropFade(label, available) : label
  ctx.save()
  ctx.globalAlpha = appearance.opacity
  ctx.drawImage(renderedLabel, 6 * s, (out.height - renderedLabel.height) / 2)
  ctx.restore()
  if (icon) {
    paintButtonIcon(
      ctx,
      buttonType(button),
      out.width - 14 * s,
      (out.height - iconSize) / 2,
      iconSize,
      appearance.foreground
    )
  }
  return out
}

function distributeButtonCells (naturals, available, spacing, stretch, scale) {
  const count = naturals.length
  const free = Math.max(available - spacing * (count - 1), 0)
  const widths = new Array(count).fill(0)
  if (stretch) {
    for (let i = 0; i < count; i++) widths[i] = free / count
    return widths
  }
  const total = naturals.reduce((sum, width) => sum + width, 0)
  if (total <= free) return naturals.slice()
  const floor = free >= count * 26 * scale ? 26 * scale : 0
  const remaining = free - floor * count
  const weights = naturals.map(width => Math.max(0, width - floor))
  const weightTotal = weights.reduce((sum, width) => sum + width, 0)
  for (let i = 0; i < count; i++) {
    const share = weightTotal ? remaining * weights[i] / weightTotal : remaining / count
    widths[i] = floor + share
  }
  return widths
}

async function renderButtonRow (block, context) {
  const buttons = (block.buttons || []).slice(0, 8)
  if (!buttons.length) return null
  const s = context.scale
  const height = 26 * s
  const spacing = 6 * s
  const padding = 17 * s
  const labels = []
  const naturals = []
  for (const button of buttons) {
    const appearance = buttonAppearance(button, context)
    const label = await drawText(
      button.text,
      13 * s,
      appearance.foreground,
      context.width,
      height,
      context.emojiBrand,
      context.telegram,
      'bold',
      context.files,
      context.accent,
      context.scale
    )
    labels.push(label)
    naturals.push(Math.max(height, (label ? label.width : 0) + padding * 2 + (buttonHasIcon(button) ? 10 * s : 0)))
  }
  const explicitlyAligned = block.align_left || block.align_center || block.align_right
  const widths = distributeButtonCells(naturals, context.width, spacing, !explicitlyAligned, s)
  const used = widths.reduce((sum, width) => sum + width, 0) + spacing * (buttons.length - 1)
  let x = block.align_center
    ? (context.width - used) / 2
    : block.align_right
      ? context.width - used
      : 0
  const out = createCanvas(Math.max(1, Math.ceil(context.width)), Math.max(1, Math.ceil(height)))
  const ctx = out.getContext('2d')
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i]
    const appearance = buttonAppearance(button, context)
    const width = widths[i]
    ctx.save()
    ctx.globalAlpha = appearance.opacity * appearance.fillAlpha
    ctx.fillStyle = appearance.fill
    ctx.beginPath()
    roundedRect(ctx, x, 0, width, height, height / 2)
    ctx.fill()
    ctx.restore()

    const icon = buttonHasIcon(button)
    const iconSize = 12 * s
    const iconRoom = icon ? 16 * s : 0
    const available = Math.max(1, width - 8 * s - iconRoom)
    let label = labels[i]
    if (label && label.width > available) label = cropFade(label, available)
    if (label) {
      ctx.save()
      ctx.globalAlpha = appearance.opacity
      ctx.drawImage(label, x + (width - label.width) / 2, (height - label.height) / 2)
      ctx.restore()
    }
    if (icon && width >= (label ? label.width : 0) + 2 * padding + 10 * s) {
      paintButtonIcon(
        ctx,
        buttonType(button),
        x + width - 18 * s,
        (height - iconSize) / 2,
        iconSize,
        appearance.foreground
      )
    }
    x += width + spacing
  }
  return out
}

function cropFade (canvas, width) {
  if (!canvas || canvas.width <= width) return canvas
  const out = createCanvas(Math.max(1, Math.floor(width)), canvas.height)
  const ctx = out.getContext('2d')
  ctx.drawImage(canvas, 0, 0)
  const fade = Math.min(out.width, canvas.height)
  const gradient = ctx.createLinearGradient(out.width - fade, 0, out.width, 0)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = gradient
  ctx.fillRect(out.width - fade, 0, fade, out.height)
  return out
}

function buildTableGrid (rows) {
  const rowCount = rows.length
  const occupancy = Array.from({ length: rowCount }, () => [])
  const placements = []
  let columnCount = 0
  for (let row = 0; row < rowCount; row++) {
    let column = 0
    for (const cell of rows[row].cells || []) {
      const colspan = Math.max(1, Math.min(32, Number(cell.colspan) || 1))
      const rowspan = Math.max(1, Math.min(rowCount - row, Number(cell.rowspan) || 1))
      while (true) {
        let available = true
        for (let r = row; r < row + rowspan && available; r++) {
          for (let c = column; c < column + colspan; c++) {
            if (occupancy[r][c]) {
              available = false
              break
            }
          }
        }
        if (available) break
        column++
      }
      const placement = { cell, row, column, colspan, rowspan, canvas: null }
      placements.push(placement)
      for (let r = row; r < row + rowspan; r++) {
        for (let c = column; c < column + colspan; c++) occupancy[r][c] = placement
      }
      column += colspan
      columnCount = Math.max(columnCount, column)
    }
  }
  return { rowCount, columnCount, occupancy, placements }
}

function measurePlainText (node, fontSize, bold) {
  const value = richText(node).text
  if (!value) return 0
  const ctx = createCanvas(1, 1).getContext('2d')
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px NotoSans`
  return Math.max(...String(value).split(/\r?\n/).map(line => ctx.measureText(line).width))
}

function tableColumnWidths (grid, context, border, padX) {
  const available = Math.max(1, context.width - border * (grid.columnCount + 1))
  const desired = new Array(grid.columnCount).fill(0)
  for (const placement of grid.placements) {
    if (placement.colspan !== 1) continue
    desired[placement.column] = Math.max(
      desired[placement.column],
      measurePlainText(placement.cell.text, context.tableFont, placement.cell.header) + padX * 2
    )
  }
  const floor = Math.min(72 * context.scale, available / grid.columnCount)
  const widths = new Array(grid.columnCount).fill(floor)
  let remaining = available - floor * grid.columnCount
  const deficits = desired.map((width, index) => Math.max(width - widths[index], 0))
  const deficitTotal = deficits.reduce((sum, width) => sum + width, 0)
  if (deficitTotal > 0 && remaining > 0) {
    const used = Math.min(remaining, deficitTotal)
    for (let i = 0; i < widths.length; i++) widths[i] += used * deficits[i] / deficitTotal
    remaining -= used
  }
  if (remaining > 0) {
    const extra = remaining / widths.length
    widths.forEach((width, index) => { widths[index] = width + extra })
  }
  return widths
}

function spanSize (values, from, count, separator) {
  return values.slice(from, from + count).reduce((sum, value) => sum + value, 0) + separator * (count - 1)
}

async function renderTable (block, context) {
  const rows = block.rows || []
  const title = await drawText(
    block.title,
    context.font,
    context.color,
    context.width,
    context.height,
    context.emojiBrand,
    context.telegram,
    'bold',
    context.files,
    context.accent,
    context.scale
  )
  if (!rows.length) return title
  const grid = buildTableGrid(rows)
  if (!grid.columnCount) return title

  const s = context.scale
  const border = block.bordered ? Math.max(1, Math.round(s)) : 0
  const padX = 8 * s
  const padY = (block.compact ? 3 : 6) * s
  const columnWidths = tableColumnWidths(grid, context, border, padX)
  const rowHeights = new Array(grid.rowCount).fill(context.tableFont * 1.25 + padY * 2)

  for (const placement of grid.placements) {
    const width = Math.max(1, spanSize(columnWidths, placement.column, placement.colspan, border) - padX * 2)
    placement.canvas = await drawText(
      placement.cell.text,
      context.tableFont,
      context.color,
      width,
      context.height,
      context.emojiBrand,
      context.telegram,
      placement.cell.header ? 'bold' : null,
      context.files,
      context.accent,
      context.scale
    )
    if (placement.rowspan === 1) {
      rowHeights[placement.row] = Math.max(rowHeights[placement.row], (placement.canvas ? placement.canvas.height : 0) + padY * 2)
    }
  }
  for (const placement of grid.placements.filter(item => item.rowspan > 1)) {
    const current = spanSize(rowHeights, placement.row, placement.rowspan, border)
    const needed = (placement.canvas ? placement.canvas.height : 0) + padY * 2
    if (needed > current) {
      const extra = (needed - current) / placement.rowspan
      for (let row = placement.row; row < placement.row + placement.rowspan; row++) rowHeights[row] += extra
    }
  }

  const width = columnWidths.reduce((sum, value) => sum + value, 0) + border * (grid.columnCount + 1)
  const height = rowHeights.reduce((sum, value) => sum + value, 0) + border * (grid.rowCount + 1)
  const table = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
  const ctx = table.getContext('2d')
  const columnStarts = []
  const rowStarts = []
  let cursor = border
  for (const columnWidth of columnWidths) {
    columnStarts.push(cursor)
    cursor += columnWidth + border
  }
  cursor = border
  for (const rowHeight of rowHeights) {
    rowStarts.push(cursor)
    cursor += rowHeight + border
  }

  ctx.save()
  ctx.beginPath()
  roundedRect(ctx, 0, 0, table.width, table.height, 8 * s)
  ctx.clip()
  for (const placement of grid.placements) {
    if (!placement.cell.header && !(block.striped && placement.row % 2 === 0)) continue
    ctx.fillStyle = context.tableTint
    ctx.fillRect(
      columnStarts[placement.column],
      rowStarts[placement.row],
      spanSize(columnWidths, placement.column, placement.colspan, border),
      spanSize(rowHeights, placement.row, placement.rowspan, border)
    )
  }
  ctx.restore()

  for (const placement of grid.placements) {
    if (!placement.canvas) continue
    const cellWidth = spanSize(columnWidths, placement.column, placement.colspan, border)
    const cellHeight = spanSize(rowHeights, placement.row, placement.rowspan, border)
    let x = columnStarts[placement.column] + padX
    let y = rowStarts[placement.row] + padY
    if (placement.cell.align_center) x += (cellWidth - padX * 2 - placement.canvas.width) / 2
    if (placement.cell.align_right) x += cellWidth - padX * 2 - placement.canvas.width
    if (placement.cell.valign_middle) y += (cellHeight - padY * 2 - placement.canvas.height) / 2
    if (placement.cell.valign_bottom) y += cellHeight - padY * 2 - placement.canvas.height
    ctx.drawImage(placement.canvas, x, y)
  }

  if (border) {
    ctx.strokeStyle = context.border
    ctx.lineWidth = border
    ctx.beginPath()
    roundedRect(ctx, border / 2, border / 2, table.width - border, table.height - border, 8 * s)
    ctx.stroke()
    ctx.beginPath()
    for (let row = 1; row < grid.rowCount; row++) {
      const y = rowStarts[row] - border / 2
      let start = null
      for (let column = 0; column <= grid.columnCount; column++) {
        const split = column < grid.columnCount && grid.occupancy[row - 1][column] !== grid.occupancy[row][column]
        if (split && start == null) start = column
        if ((!split || column === grid.columnCount) && start != null) {
          const x1 = start === 0 ? border / 2 : columnStarts[start] - border / 2
          const x2 = column === grid.columnCount ? table.width - border / 2 : columnStarts[column] - border / 2
          ctx.moveTo(x1, y)
          ctx.lineTo(x2, y)
          start = null
        }
      }
    }
    for (let column = 1; column < grid.columnCount; column++) {
      const x = columnStarts[column] - border / 2
      let start = null
      for (let row = 0; row <= grid.rowCount; row++) {
        const split = row < grid.rowCount && grid.occupancy[row][column - 1] !== grid.occupancy[row][column]
        if (split && start == null) start = row
        if ((!split || row === grid.rowCount) && start != null) {
          const y1 = start === 0 ? border / 2 : rowStarts[start] - border / 2
          const y2 = row === grid.rowCount ? table.height - border / 2 : rowStarts[row] - border / 2
          ctx.moveTo(x, y1)
          ctx.lineTo(x, y2)
          start = null
        }
      }
    }
    ctx.stroke()
  }
  return stack([title, table], 6 * s)
}

async function renderBlock (block, context, depth = 0) {
  if (!block || depth > 32) return null
  const type = typeOf(block)
  const s = context.scale
  const text = (node, size = context.font, color = context.color, width = context.width, style = null) =>
    drawText(
      node,
      size,
      color,
      width,
      context.height,
      context.emojiBrand,
      context.telegram,
      style,
      context.files,
      context.accent,
      context.scale
    )
  const textSizes = {
    title: 26,
    subtitle: 22,
    header: 22,
    subheader: 20,
    heading1: 23,
    heading2: 22,
    heading3: 21,
    heading4: 20,
    heading5: 18,
    heading6: 17,
    kicker: 14,
    footer: 14
  }
  if (textSizes[type]) {
    return text(block.text, textSizes[type] * s, context.color, context.width, type === 'kicker' ? 'bold' : null)
  }
  if (type === 'paragraph' || type === 'thinking') {
    const textColor = type === 'thinking' ? context.muted : context.color
    return hasMath(block.text)
      ? drawMixedText(block.text, context.font, textColor, context.width, context.height, context.emojiBrand, context.telegram, context.files, context.accent)
      : text(block.text, context.font, textColor, context.width, type === 'thinking' ? 'italic' : null)
  }
  if (type === 'math') {
    return centerCanvas(
      renderMath(block.source, { fontSize: context.font * 1.12, color: context.color, maxWidth: context.width, display: true }),
      context.width
    )
  }
  if (type === 'preformatted') {
    return renderCodeBlock({
      text: richText(block.text).text,
      language: block.language || '',
      width: context.width,
      fontSize: context.font,
      scale: context.scale,
      color: context.color,
      muted: context.muted,
      dark: context.dark
    })
  }
  if (type === 'authordate') {
    const author = richText(block.author).text
    const date = block.published_date ? new Date(block.published_date * 1000).toLocaleDateString('en-GB') : ''
    return text({ _: 'TextPlain', text: [author, date].filter(Boolean).join(' · ') }, context.small, context.muted)
  }
  if (type === 'divider') {
    const out = createCanvas(context.width, Math.max(1, s))
    out.getContext('2d').fillStyle = context.muted
    out.getContext('2d').fillRect(0, 0, out.width, out.height)
    return out
  }
  if (type === 'blockquote') return renderQuoteBlock(block, context, depth)
  if (type === 'pullquote') return renderPullquote(block, context)
  if (type === 'blockquoteblocks') return renderQuoteBlock(block, context, depth, true)
  if (type === 'list' || type === 'orderedlist') {
    const rendered = []
    let index = Number(block.start || 1)
    for (const item of block.items || []) {
      const task = type === 'list' && item.checkbox === true
      const marker = type === 'orderedlist' ? `${item.num || index++}.` : null
      const markerWidth = 22 * s
      const markerSkip = 8 * s
      const valueWidth = Math.max(1, context.width - markerWidth - markerSkip)
      const value = item.text
        ? await text(item.text, context.font, context.color, valueWidth)
        : await renderBlocks(item.blocks, { ...context, width: valueWidth }, depth + 1)
      let markerCanvas
      if (marker) {
        markerCanvas = await text(
          { _: 'TextPlain', text: marker },
          context.font,
          context.color,
          markerWidth
        )
      } else {
        const markerHeight = Math.max(context.font * 1.2, 16 * s)
        markerCanvas = createCanvas(Math.max(1, Math.ceil(markerWidth)), Math.max(1, Math.ceil(markerHeight)))
        const markerContext = markerCanvas.getContext('2d')
        markerContext.strokeStyle = context.muted
        markerContext.fillStyle = context.color
        markerContext.lineWidth = Math.max(1, s)
        if (task) {
          const size = 14 * s
          const x = (markerWidth - size) / 2
          const y = (markerHeight - size) / 2
          markerContext.beginPath()
          roundedRect(markerContext, x, y, size, size, 2 * s)
          markerContext.stroke()
          if (item.checked) {
            markerContext.strokeStyle = context.color
            markerContext.lineWidth = Math.max(1.5, 1.5 * s)
            markerContext.lineCap = 'round'
            markerContext.lineJoin = 'round'
            markerContext.beginPath()
            markerContext.moveTo(x + 3 * s, y + 7 * s)
            markerContext.lineTo(x + 6 * s, y + 10 * s)
            markerContext.lineTo(x + 11 * s, y + 4 * s)
            markerContext.stroke()
          }
        } else {
          markerContext.beginPath()
          markerContext.arc(markerWidth / 2, markerHeight / 2, 2 * s, 0, Math.PI * 2)
          markerContext.fill()
        }
      }
      rendered.push(stackRow(markerCanvas, value, markerSkip, 'top'))
    }
    return stack(rendered, 7 * s)
  }
  if (type === 'details') return renderDetails(block, context, depth)
  if (type === 'table') return renderTable(block, context)
  if (type === 'buttonrow') return renderButtonRow(block, context)
  if (['photo', 'video', 'audio', 'document', 'map', 'cover'].includes(type)) {
    if (type === 'cover' && block.cover) return renderBlock(block.cover, context, depth + 1)
    if (type === 'audio' || type === 'document') return renderDocumentBlock(block, type, context)
    const media = await drawMedia(block, context, type === 'video', type === 'map')
    const caption = await drawCaption(block.caption, context)
    if (media) {
      return stack([media, caption], 8 * s)
    }
    const label = type === 'map' ? 'Map' : type[0].toUpperCase() + type.slice(1)
    return stack([await renderMediaPlaceholder(label, context, type), caption], 8 * s)
  }
  if (type === 'collage' || type === 'slideshow') {
    return renderGroupedMedia(block, type, context)
  }
  if (type === 'embedpost') {
    const inner = await renderBlocks(block.blocks, { ...context, width: context.width - 24 * s }, depth + 1)
    return decorate(inner, {
      fill: context.tint,
      bar: context.accent,
      barWidth: 3 * s,
      barGap: 3 * s,
      pad: 10 * s,
      radius: 8 * s
    })
  }
  if (type === 'embed') {
    const label = block.url || (block.html ? 'Embedded content' : 'Embed')
    return decorate(await text({ _: 'TextPlain', text: `↗  ${label}` }, context.small, context.accent, context.width - 20 * s), {
      fill: context.tint,
      pad: 10 * s,
      radius: 8 * s
    })
  }
  if (type === 'channel') {
    const channel = block.channel || {}
    const name = channel.title || channel.username || 'Channel'
    return decorate(await text({ _: 'TextPlain', text: name }, context.font, context.accent, context.width - 20 * s, 'bold'), {
      fill: context.tint,
      pad: 10 * s,
      radius: 8 * s
    })
  }
  if (type === 'relatedarticles') {
    const rows = [await text(block.title, context.font, context.color, context.width, 'bold')]
    for (const article of block.articles || []) {
      const title = richText(article.title).text || article.url || 'Related article'
      rows.push(await text({ _: 'TextPlain', text: `↗  ${title}` }, context.small, context.accent))
    }
    return stack(rows, 6 * s)
  }
  if (block.text) return text(block.text)
  if (block.blocks) return renderBlocks(block.blocks, context, depth + 1)
  return null
}

function stackRow (...args) {
  let align = 'center'
  if (typeof args[args.length - 1] === 'string') align = args.pop()
  const gap = typeof args[args.length - 1] === 'number' ? args.pop() : 0
  const items = args.filter(Boolean)
  if (!items.length) return null
  const width = items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1)
  const height = Math.max(...items.map(item => item.height))
  const out = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
  const ctx = out.getContext('2d')
  let x = 0
  for (const item of items) {
    const y = align === 'top' ? 0 : align === 'bottom' ? height - item.height : (height - item.height) / 2
    ctx.drawImage(item, x, y)
    x += item.width + gap
  }
  return out
}

async function renderBlocks (blocks, context, depth = 0) {
  const rendered = []
  for (const block of blocks || []) rendered.push(await renderBlock(block, context, depth))
  return stack(rendered, 8 * context.scale)
}

async function renderRichMessage (rich, options) {
  if (!rich || !Array.isArray(rich.blocks)) return null
  const context = {
    scale: options.scale,
    font: 16 * options.scale,
    small: 14 * options.scale,
    tableFont: 16 * options.scale,
    color: options.color,
    muted: options.muted,
    accent: options.accent,
    tint: withAlpha(options.accent, 0.12),
    dark: options.dark,
    link: options.dark ? '#6ab7ec' : '#3390ec',
    border: options.dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)',
    tableTint: options.dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.065)',
    divider: withAlpha(options.muted, options.dark ? 0.42 : 0.32),
    code: options.dark ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.07)',
    width: Math.max(1, Math.floor(options.width)),
    height: options.height,
    emojiBrand: options.emojiBrand,
    telegram: options.telegram,
    files: rich.files || {},
    imageCache: new Map()
  }
  return renderBlocks(rich.blocks, context)
}

module.exports = { renderRichMessage, richText, typeOf }
