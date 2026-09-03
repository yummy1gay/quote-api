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
  const marginTop = 2 * scale
  const marginBottom = 2 * scale
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

  const seams = []
  for (let i = 0; i < layout.lines.length - 1; i++) {
    seams.push(Math.round(textTop + layout.lines[i].y + prepared.lineHeight / 2))
  }

  const rects = layout.lines.map((line, index) => {
    const lineWidth = Math.max(1, Math.ceil(line.contentWidth || line.width))
    const topY = index === 0 ? marginTop : seams[index - 1]
    const bottomY = index === layout.lines.length - 1 ? (marginTop + bodyHeight) : seams[index]
    return {
      x: (targetWidth - lineWidth - padX * 2) / 2,
      y: topY,
      w: lineWidth + padX * 2,
      h: bottomY - topY
    }
  })

  const minDelta = 40 * UI * scale
  equalizeServiceMessageRects(rects, targetWidth, minDelta)

  ctx.fillStyle = background
  drawComplexBubblePath(ctx, rects, radius)
  ctx.fill()

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

function drawComplexBubblePath (ctx, rects, outerRadius) {
  if (!rects || rects.length === 0) return
  if (rects.length === 1) {
    roundedRect(ctx, rects[0].x, rects[0].y, rects[0].w, rects[0].h, outerRadius)
    return
  }

  ctx.beginPath()

  const first = rects[0]
  const r0 = Math.min(outerRadius, first.w / 2, first.h / 2)
  ctx.moveTo(first.x + first.w / 2, first.y)

  ctx.lineTo(first.x + first.w - r0, first.y)
  ctx.arcTo(
    first.x + first.w, first.y,
    first.x + first.w, first.y + r0,
    r0
  )

  for (let i = 0; i < rects.length - 1; i++) {
    const curr = rects[i]
    const next = rects[i + 1]

    const currMaxX = curr.x + curr.w
    const nextMaxX = next.x + next.w
    const seamY = curr.y + curr.h

    const diff = currMaxX - nextMaxX
    if (Math.abs(diff) < 1) {
      ctx.lineTo(nextMaxX, next.y + next.h / 2)
    } else {
      const stepRadius = Math.min(
        outerRadius,
        curr.h / 2,
        next.h / 2,
        Math.abs(diff) / 2
      )

      ctx.lineTo(currMaxX, seamY - stepRadius)

      if (diff > 0) {
        ctx.arcTo(currMaxX, seamY, currMaxX - stepRadius, seamY, stepRadius)
        ctx.lineTo(nextMaxX + stepRadius, seamY)
        ctx.arcTo(nextMaxX, seamY, nextMaxX, seamY + stepRadius, stepRadius)
      } else {
        ctx.arcTo(currMaxX, seamY, currMaxX + stepRadius, seamY, stepRadius)
        ctx.lineTo(nextMaxX - stepRadius, seamY)
        ctx.arcTo(nextMaxX, seamY, nextMaxX, seamY + stepRadius, stepRadius)
      }

      ctx.lineTo(nextMaxX, next.y + next.h / 2)
    }
  }

  const last = rects[rects.length - 1]
  const rLast = Math.min(outerRadius, last.w / 2, last.h / 2)
  const lastMaxX = last.x + last.w

  ctx.lineTo(lastMaxX, last.y + last.h - rLast)
  ctx.arcTo(
    lastMaxX, last.y + last.h,
    lastMaxX - rLast, last.y + last.h,
    rLast
  )
  ctx.lineTo(last.x + rLast, last.y + last.h)
  ctx.arcTo(
    last.x, last.y + last.h,
    last.x, last.y + last.h - rLast,
    rLast
  )

  for (let i = rects.length - 1; i > 0; i--) {
    const curr = rects[i]
    const prev = rects[i - 1]

    const currMinX = curr.x
    const prevMinX = prev.x
    const seamY = curr.y

    const diff = currMinX - prevMinX
    if (Math.abs(diff) < 1) {
      ctx.lineTo(prevMinX, prev.y + prev.h / 2)
    } else {
      const stepRadius = Math.min(
        outerRadius,
        curr.h / 2,
        prev.h / 2,
        Math.abs(diff) / 2
      )

      ctx.lineTo(currMinX, seamY + stepRadius)

      if (diff > 0) {
        ctx.arcTo(currMinX, seamY, currMinX - stepRadius, seamY, stepRadius)
        ctx.lineTo(prevMinX + stepRadius, seamY)
        ctx.arcTo(prevMinX, seamY, prevMinX, seamY - stepRadius, stepRadius)
      } else {
        ctx.arcTo(currMinX, seamY, currMinX + stepRadius, seamY, stepRadius)
        ctx.lineTo(prevMinX - stepRadius, seamY)
        ctx.arcTo(prevMinX, seamY, prevMinX, seamY - stepRadius, stepRadius)
      }

      ctx.lineTo(prevMinX, prev.y + prev.h / 2)
    }
  }

  ctx.lineTo(first.x, first.y + r0)
  ctx.arcTo(
    first.x, first.y,
    first.x + r0, first.y,
    r0
  )
  ctx.closePath()
}

function equalizeServiceMessageRects (rects, targetWidth, minDelta) {
  if (!rects || rects.length <= 1) return

  for (let pass = 0; pass < rects.length; pass++) {
    let changed = false
    for (let i = 1; i < rects.length - 1; i++) {
      const minNeighbor = Math.min(rects[i - 1].w, rects[i + 1].w)
      if (rects[i].w < minNeighbor) {
        rects[i].w = minNeighbor
        rects[i].x = (targetWidth - minNeighbor) / 2
        changed = true
      }
    }
    if (!changed) break
  }

  const sorted = rects.map((_, i) => i).sort((a, b) => rects[b].w - rects[a].w)
  for (const idx of sorted) {
    for (const d of [-1, 1]) {
      const neighbor = idx + d
      if (neighbor >= 0 && neighbor < rects.length) {
        if (rects[idx].w - rects[neighbor].w > 0 && rects[idx].w - rects[neighbor].w < minDelta) {
          rects[neighbor].w = rects[idx].w
          rects[neighbor].x = (targetWidth - rects[idx].w) / 2
        }
      }
    }
  }

  for (let pass = 0; pass < rects.length; pass++) {
    let changed = false
    for (let i = 0; i < rects.length - 1; i++) {
      if (Math.abs(rects[i].w - rects[i + 1].w) > 0 && Math.abs(rects[i].w - rects[i + 1].w) < minDelta) {
        const maxW = Math.max(rects[i].w, rects[i + 1].w)
        rects[i].w = maxW
        rects[i].x = (targetWidth - maxW) / 2
        rects[i + 1].w = maxW
        rects[i + 1].x = (targetWidth - maxW) / 2
        changed = true
      }
    }
    if (!changed) break
  }
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
