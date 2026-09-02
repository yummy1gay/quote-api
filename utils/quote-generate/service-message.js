const { createCanvas, loadImage } = require('canvas')
const loadImageFromUrl = require('../image-load-url')
const { prepareText } = require('./text-prepare')
const { layoutText } = require('./text-layout')
const { renderText } = require('./text-render')
const { renderReplyMarkup } = require('./reply-markup')

// quote-api renders Telegram's 16px message font at 24 logical pixels.
// Applying the same 1.5 ratio to the native service-message metrics keeps
// the pill, photo and gaps in the same proportion as Telegram Desktop.
const UI = 1.5

async function renderServiceMessage (service, options = {}) {
  const scale = Number.isFinite(options.scale) ? options.scale : 1
  const targetWidth = Math.max(1, Math.ceil(options.width || 512 * scale))
  const targetHeight = Math.max(1, Math.ceil(options.height || 768 * scale))
  const text = String(service && service.text ? service.text : 'Service message')
  const entities = Array.isArray(service && service.entities) ? service.entities : []

  const fontSize = 13 * UI * scale
  const padX = 12 * UI * scale
  const padTop = 3 * UI * scale
  const padBottom = 4 * UI * scale
  const marginTop = 10 * UI * scale
  const marginBottom = 2 * UI * scale
  const radius = 8 * UI * scale
  const serviceWidth = Math.max(fontSize * 5, Math.min(430 * scale, targetWidth - 20 * UI * scale))
  const maxTextWidth = Math.max(fontSize * 3, serviceWidth - padX * 2)

  const prepared = await prepareText(
    text,
    entities,
    fontSize,
    options.emojiBrand,
    options.telegram
  )
  const maxTextHeight = Math.max(fontSize * 2, targetHeight - marginTop - marginBottom)
  const layout = layoutText(prepared, maxTextWidth, maxTextHeight)
  if (!layout.lines.length) return null

  const textHeight = Math.max(1, Math.ceil(layout.height))
  const bodyHeight = padTop + textHeight + padBottom

  let photo = null
  const mediaUrl = service && service.media && service.media.url
  if (mediaUrl) {
    try {
      if (/^https?:/i.test(mediaUrl)) {
        photo = await loadImage(await loadImageFromUrl(mediaUrl))
      } else {
        photo = await loadImage(mediaUrl)
      }
    } catch (error) {
      console.warn('Failed to load service-message media:', error.message)
    }
  }

  const photoSize = photo ? Math.min(100 * UI * scale, serviceWidth) : 0
  const mediaGap = photo ? 10 * UI * scale : 0
  const preparedMarkup = options.replyMarkup || null
  let keyboard = null
  if (preparedMarkup) {
    keyboard = renderReplyMarkup(preparedMarkup, serviceWidth, {
      tl: 16 * UI * scale,
      tr: 16 * UI * scale,
      br: 16 * UI * scale,
      bl: 16 * UI * scale
    })
  }
  const keyboardGap = keyboard ? 3 * scale : 0
  const height = Math.ceil(
    marginTop + bodyHeight + mediaGap + photoSize + keyboardGap +
    (keyboard ? keyboard.height : 0) + marginBottom
  )
  const canvas = createCanvas(targetWidth, Math.max(1, height))
  const ctx = canvas.getContext('2d')

  const background = options.dark
    ? 'rgba(37, 49, 61, 0.82)'
    : 'rgba(66, 101, 123, 0.68)'
  const textTop = marginTop + padTop
  const rects = layout.lines.map((line, index) => {
    const lineWidth = Math.max(1, Math.ceil(line.contentWidth || line.width))
    const lineTop = line.y - prepared.ascent
    const last = index === layout.lines.length - 1
    return {
      x: (targetWidth - lineWidth - padX * 2) / 2,
      y: textTop + lineTop - (index === 0 ? padTop : 0),
      w: lineWidth + padX * 2,
      h: (last ? prepared.ascent + prepared.descent : prepared.lineHeight) +
        (index === 0 ? padTop : 0) + (last ? padBottom : 0)
    }
  })

  ctx.fillStyle = background
  for (const rect of rects) {
    roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, radius)
    ctx.fill()
  }
  // Adjacent rounded rows are joined through their shared center. This is
  // the same contour principle as PaintComplexBubble: wide/narrow lines form
  // one continuous pill instead of a stack of detached capsules.
  for (let i = 0; i + 1 < rects.length; i++) {
    const current = rects[i]
    const next = rects[i + 1]
    const left = Math.max(current.x, next.x)
    const right = Math.min(current.x + current.w, next.x + next.w)
    const seam = next.y
    if (right > left) ctx.fillRect(left, seam - radius, right - left, radius * 2)
  }

  for (const line of layout.lines) {
    const lineWidth = Math.max(1, Math.ceil(line.contentWidth || line.width))
    const oneLine = {
      lines: [{ ...line, y: prepared.ascent }],
      width: lineWidth,
      height: prepared.ascent + prepared.descent,
      lineCount: 1,
      truncated: !!line.truncated
    }
    const lineCanvas = renderText(oneLine, prepared, '#ffffff')
    const lineTop = line.y - prepared.ascent
    ctx.drawImage(lineCanvas, Math.round((targetWidth - lineCanvas.width) / 2), Math.round(textTop + lineTop))
  }

  let cursorY = marginTop + bodyHeight
  if (photo) {
    cursorY += mediaGap
    const x = Math.round((targetWidth - photoSize) / 2)
    ctx.save()
    ctx.beginPath()
    ctx.arc(x + photoSize / 2, cursorY + photoSize / 2, photoSize / 2, 0, Math.PI * 2)
    ctx.clip()
    drawCover(ctx, photo, x, cursorY, photoSize, photoSize)
    ctx.restore()
    cursorY += photoSize
  }
  if (keyboard) {
    cursorY += keyboardGap
    ctx.drawImage(keyboard, Math.round((targetWidth - keyboard.width) / 2), Math.round(cursorY))
  }

  canvas._isService = true
  canvas._disableOuterShadow = true
  canvas._hasReplyMarkup = !!keyboard
  return canvas
}

function roundedRect (ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function drawCover (ctx, image, x, y, width, height) {
  const ratio = Math.max(width / image.width, height / image.height)
  const sourceWidth = width / ratio
  const sourceHeight = height / ratio
  const sourceX = (image.width - sourceWidth) / 2
  const sourceY = (image.height - sourceHeight) / 2
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height)
}

module.exports = { renderServiceMessage }
