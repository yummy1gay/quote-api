// utils/quote-generate/composer.js
//
// Composes a quote bubble from pre-rendered canvases using a DOM/CSS-style
// box model (see layout-box.js): the bubble is a column with padding and a
// uniform vertical gap; every spacing constant lives in SP. No element is
// positioned with ad-hoc offsets — parents size themselves from children.

const { createCanvas } = require('canvas')
const { drawRoundRect, drawGradientRoundRect, roundImage, drawQuoteIcon, drawLabel, drawForwardLabel } = require('./canvas-utils')
const { paintMediaBadges } = require('./attachments')
const { paintMapPoint } = require('./tdesktop-icons')
const { leaf, box, measure, place, render } = require('./layout-box')
const { renderReplyMarkup } = require('./reply-markup')

// All spacing in logical px (multiplied by scale at use). The single place
// to tune how a quote breathes.
const SP = {
  padX: 16, // bubble inner padding → ink, horizontal
  padY: 12, // bubble inner padding → first metric box (which adds its own slack)
  // Vertical rhythm between solid blocks (reply chip, media, attachment).
  // Text nodes override it with mt 0: their metric line box already carries
  // the air above the cap line, so stacking at 0 lands on the same
  // baseline-to-baseline rhythm as the text's own line height.
  gap: 5,
  headerGap: 8, // min gap between name and sender tag
  maxHeader: 300, // header/forward-label width cap — longer names fade out instead of inflating the bubble
  radius: 25, // bubble corner radius
  radiusGrouped: 7, // corner radius facing a same-sender neighbour bubble
  replyThumb: 32, // Telegram Desktop historyReplyPreview
  shadowPad: 12, // canvas margin (right/bottom) so the drop shadow isn't clipped
  shadowPadTop: 4, // canvas margin above the bubble (shadow blur spills up a little)
  glass: 1.25, // frosted-glass hairline width (border + top edge highlight)
  tail: 14, // bubble tail size (when avatar is shown)
  minWidth: 100, // min bubble width
  avatar: 50, // avatar diameter
  avatarGap: 10, // avatar → bubble
  mediaRound: 12, // media corner radius (inside a bubble)
  // Accent block — the modern-Telegram rounded tinted block used for both
  // the reply preview and the partial-quote body: solid bar on the left,
  // accent tint behind, optional ❝ in the corner.
  block: { padY: 5, padL: 9, padR: 9, padRIcon: 22, padRGift: 32, bar: 3, icon: 15, iconInset: 5, radius: 6, tint: 0.1, gap: 2 }
}

// Telegram Desktop's rank palette and geometry. Regular member tags are
// plain secondary text; admin/owner ranks are coloured pills at 15% opacity.
function drawSenderTag (senderTag, scale, memberColor) {
  const data = typeof senderTag === 'object'
    ? senderTag
    : { text: senderTag, role: 'member' }
  const text = String(data.text || data.label || '').replace(/[\r\n]+/g, ' ').trim()
  if (!text) return null

  const role = String(data.role || 'member').toLowerCase()
  const color = role === 'owner' || role === 'creator'
    ? '#956ac8'
    : role === 'admin'
      ? '#49a355'
      : memberColor
  const label = drawLabel(text, 13 * scale, color)
  if (role !== 'owner' && role !== 'creator' && role !== 'admin') return label

  const padX = 5 * scale
  const height = label.height
  const width = Math.ceil(Math.max(label.width + padX * 2, height))
  const rgb = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  const fill = rgb
    ? `rgba(${parseInt(rgb[1], 16)}, ${parseInt(rgb[2], 16)}, ${parseInt(rgb[3], 16)}, 0.15)`
    : color
  const pill = drawRoundRect(fill, width, height, height / 2)
  const ctx = pill.getContext('2d')
  ctx.drawImage(label, Math.round((width - label.width) / 2), 0)
  return pill
}

function drawQuote (options) {
  const {
    scale = 1,
    background,
    avatar,
    reply,
    name,
    text,
    textBlocks, // [{ canvas, quote, pre }] — text split around structural entities
    media,
    venue, // { title, address } — Telegram location/venue caption canvases
    attachment, // pre-rendered in-bubble row canvas (voice/document/audio)
    richContent, // recursively rendered Telegram RichMessage page
    replyMarkup, // prepared ReplyInlineMarkup grid attached below the bubble
    isForward,
    forwardLabel,
    nameColor,
    senderTag,
    viaBot, // pre-rendered "via @bot" canvas (or null)
    groupPos = 'single', // single | first | middle | last — corners facing a same-sender neighbour flatten
    isQuote
  } = options

  const s = (v) => v * scale
  const accent = nameColor || background.textColor || '#fff'

  const mediaType = media ? media.type : null
  const mediaCanvas = media ? media.canvas : null
  const isSticker = mediaType === 'sticker'
  const hasVenue = Boolean(venue && (venue.title || venue.address))
  const hasReplyMarkup = Boolean(replyMarkup && replyMarkup.rows && replyMarkup.rows.length)
  const nameCanvas = isSticker ? null : name

  // ---- Leaves -------------------------------------------------------------

  let headerNode = null
  if (nameCanvas || viaBot) {
    let tagLeaf = null
    if (senderTag) {
      tagLeaf = leaf(drawSenderTag(senderTag, scale, background.tagColor || '#999999'))
    }
    // The header fits into maxHeader as a whole: the name yields (fades)
    // first, "via @bot" and the tag always stay visible.
    const viaLeaf = viaBot ? leaf(viaBot) : null
    let nameMax = s(SP.maxHeader)
    if (viaLeaf) nameMax -= viaLeaf.w + s(6)
    if (tagLeaf) nameMax -= tagLeaf.w + s(SP.headerGap)
    const nameLeaf = nameCanvas ? leaf(nameCanvas, { maxW: Math.max(s(40), nameMax) }) : null
    const nameSide = nameLeaf && viaLeaf
      ? box({ dir: 'row', align: 'center', gap: s(6), children: [nameLeaf, viaLeaf] })
      : nameLeaf || viaLeaf
    headerNode = tagLeaf
      ? box({ dir: 'row', justify: 'between', align: 'center', gap: s(SP.headerGap), stretch: true, children: [nameSide, tagLeaf] })
      : nameSide
  }

  let forwardNode = null
  if (isForward && forwardLabel) {
    forwardNode = leaf(drawForwardLabel(forwardLabel, s(13), accent), { maxW: s(SP.maxHeader) })
  }

  let replyNode = null
  let replyNameLeaf = null
  if (reply) {
    // Modern Telegram renders the reply preview as a tinted accent block in
    // the replied sender's color — same visual language as a quote. A media
    // thumbnail (when the replied message has one) sits left of the texts.
    replyNameLeaf = leaf(reply.name)
    const textLine = reply.icon
      ? box({ dir: 'row', gap: s(3), align: 'center', children: [leaf(reply.icon), leaf(reply.text)] })
      : leaf(reply.text)
    const replyTexts = box({ dir: 'col', gap: s(SP.block.gap), children: [replyNameLeaf, textLine] })
    const inner = reply.thumb
      ? box({
        dir: 'row',
        gap: s(7),
        align: 'center',
        children: [
          leaf(reply.thumb, {
            trim: false,
            w: s(SP.replyThumb),
            h: s(SP.replyThumb),
            paint: (ctx, n) => ctx.drawImage(roundImage(coverSquare(n.canvas), s(4)), n.x, n.y, n.w, n.h)
          }),
          replyTexts
        ]
      })
      : replyTexts
    replyNode = accentBlock(s, reply.colors || reply.nameColor, {
      icon: reply.quote,
      fillColor: reply.nameColor,
      backgroundEmoji: reply.backgroundEmoji,
      giftEmoji: reply.giftEmoji,
      children: [inner]
    })
    // Reply headers occupy the message's full content width, regardless of
    // how short their own name/text happens to be.
    replyNode.stretch = true
  }

  // Media-only bubbles (photo with no caption/name/reply) are pure media:
  // the photo IS the bubble, rounded with the bubble radius.
  const mediaOnly = !!mediaCanvas && !headerNode && !text && !reply && !forwardLabel && !attachment && !richContent && !hasVenue

  // Grouped bubbles flatten the left corners that face their neighbours.
  const R = s(SP.radius)
  const rSmall = s(SP.radiusGrouped)
  const radii = {
    tl: groupPos === 'middle' || groupPos === 'last' ? rSmall : R,
    tr: R,
    br: R,
    bl: groupPos === 'first' || groupPos === 'middle' ? rSmall : R
  }
  const keyboardRadii = {
    bl: radii.bl === R ? s(24) : s(12),
    br: radii.br === R ? s(24) : s(12)
  }
  // An attached inline keyboard continues the shape below the bubble. The
  // bubble-facing corners therefore become the small Telegram corners.
  if (hasReplyMarkup) {
    radii.bl = s(8)
    radii.br = s(8)
  }

  // Like Telegram, media hugs the bubble edge it borders: with no caption
  // below (or no header above) the bubble padding on that side collapses and
  // the media corners inherit the bubble's own radii.
  const isRound = mediaType === 'video_note' // round video — circular mask
  const hasCaption = Boolean(text) || (Array.isArray(textBlocks) && textBlocks.length > 0) || Boolean(attachment) || Boolean(richContent) || hasVenue
  const flushable = !!mediaCanvas && !mediaOnly && !isSticker && !isRound
  const flushBottom = flushable && !hasCaption
  const flushTop = flushable && !headerNode && !(isForward && forwardLabel) && !reply

  let mediaNode = null
  if (mediaCanvas) {
    const maxMediaSize = media.maxSize
    let mediaWidth = mediaCanvas.width * (maxMediaSize / mediaCanvas.height)
    let mediaHeight = maxMediaSize
    if (mediaWidth >= maxMediaSize) {
      mediaWidth = maxMediaSize
      mediaHeight = mediaCanvas.height * (maxMediaSize / mediaCanvas.width)
    }
    const mr = s(SP.mediaRound)
    const mediaRadius = mediaOnly || isSticker
      ? (mediaOnly && hasReplyMarkup
          ? { tl: s(SP.radius * 0.6), tr: s(SP.radius * 0.6), br: s(8), bl: s(8) }
          : s(SP.radius * 0.6))
      : {
        tl: flushTop ? radii.tl : mr,
        tr: flushTop ? radii.tr : mr,
        br: hasVenue ? 0 : (flushBottom ? radii.br : mr),
        bl: hasVenue ? 0 : (flushBottom ? radii.bl : mr)
      }
    mediaNode = leaf(mediaCanvas, {
      trim: false,
      bleed: !isRound,
      w: isRound ? Math.min(mediaWidth, mediaHeight) : mediaWidth,
      h: isRound ? Math.min(mediaWidth, mediaHeight) : mediaHeight,
      paint: (ctx, n) => {
        ctx.save()
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        if (isRound) {
          ctx.beginPath()
          ctx.arc(n.x + n.w / 2, n.y + n.h / 2, n.w / 2, 0, Math.PI * 2)
          ctx.clip()
          ctx.drawImage(coverSquare(n.canvas), n.x, n.y, n.w, n.h)
        } else {
          // roundImage clips in SOURCE pixel space; the leaf then scales the
          // result down to n.w×n.h — so the radii must scale up by the same
          // factor or hi-res photos end up with visually smaller corners.
          const k = n.canvas.width / n.w
          const rSrc = typeof mediaRadius === 'number'
            ? mediaRadius * k
            : { tl: mediaRadius.tl * k, tr: mediaRadius.tr * k, br: mediaRadius.br * k, bl: mediaRadius.bl * k }
          ctx.drawImage(roundImage(n.canvas, rSrc), n.x, n.y, n.w, n.h)
        }
        if (mediaType === 'location' || mediaType === 'venue') {
          paintMapPoint(ctx, n.x, n.y, n.w, n.h, scale)
        }
        // Video/GIF overlays are painted in destination space so their size
        // doesn't depend on the source media resolution.
        if (media.badge) paintMediaBadges(ctx, n.x, n.y, n.w, n.h, media.badge, scale)
        ctx.restore()
      }
    })
  }

  // Voice/document/audio rows sit in the media slot but behave like text:
  // padded by the bubble, never flush.
  const venueNode = hasVenue
    ? box({
      dir: 'col',
      gap: 0,
      children: [venue.title ? leaf(venue.title) : null, venue.address ? leaf(venue.address) : null]
    })
    : null
  const isDocumentAttachment = Boolean(attachment && attachment.type === 'document')
  const attachmentLeaf = attachment ? leaf(attachment.canvas) : null
  // msgFileLayout starts the document a touch farther inside than ordinary
  // message text. Keep that local inset document-only: voice and audio have
  // their own layout geometry.
  const attachmentNode = isDocumentAttachment && attachmentLeaf
    ? box({ pad: { t: s(3), l: s(3) }, children: [attachmentLeaf] })
    : attachmentLeaf
  const richNode = richContent ? leaf(richContent) : null

  let textNode = null
  if (Array.isArray(textBlocks) && textBlocks.length > 0 && !isQuote) {
    // Structural text runs stack in one column; only quote runs receive the
    // sender accent treatment. Pre blocks paint their own neutral chrome.
    const parts = textBlocks.map((b) => {
      if (b.quote) return accentBlock(s, accent, { icon: true, children: [leaf(b.canvas)] })
      const l = leaf(b.canvas)
      if (l) l.mt = s(2) // plain runs carry their own metric air
      return l
    })
    textNode = box({ dir: 'col', gap: s(5), children: parts })
  } else if (text) {
    textNode = isQuote
      ? accentBlock(s, accent, { icon: true, children: [leaf(text)] })
      : leaf(text)
  }
  // Text supplies its own air above the cap line (metric ascent slack) —
  // no extra flow gap, the name reads like the previous text line.
  if (textNode && !isQuote) {
    // A document's message text is its caption. Desktop places it after the
    // file row's bottom padding; the generic zero-gap text rule made captions
    // stick directly to the enlarged icon.
    textNode.mt = isDocumentAttachment ? s(12) : 0
  }

  // ---- Tree ---------------------------------------------------------------

  const bubblePad = {
    t: flushTop ? 0 : s(SP.padY),
    r: s(SP.padX),
    b: flushBottom ? 0 : s(SP.padY),
    l: s(SP.padX)
  }
  // Desktop suppresses the bubble tail when inline buttons are attached.
  const tailSize = avatar && !hasReplyMarkup ? s(SP.tail) : 0

  const bubbleBg = (ctx, n) => {
    const one = background.colorOne
    const two = background.colorTwo
    const glassLw = s(SP.glass)
    const rect = one === two
      ? drawRoundRect(one, n.w, n.h, radii, tailSize, glassLw)
      : drawGradientRoundRect(one, two, n.w, n.h, radii, tailSize, glassLw)
    ctx.save()
    // A soft neutral drop shadow lifts the sticker off any chat wallpaper.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.24)'
    ctx.shadowBlur = s(6)
    ctx.shadowOffsetY = s(2)
    ctx.drawImage(rect, n.x - (rect._tailOffset || 0), n.y)
    ctx.restore()
  }

  let root
  let stickerChip = null
  if (isSticker) {
    // Sticker: no bubble; an optional dark overlay chip holds metadata/reply.
    stickerChip = headerNode || forwardNode || replyNode
      ? box({
        pad: bubblePad,
        bg: (ctx, n) => ctx.drawImage(drawRoundRect('rgba(0, 0, 0, 0.5)', n.w, n.h, s(SP.radius), 0), n.x, n.y),
        children: [headerNode, forwardNode, replyNode]
      })
      : null
    root = box({ dir: 'col', gap: s(SP.gap), children: [stickerChip, mediaNode] })
  } else {
    root = box({
      dir: 'col',
      gap: s(SP.gap),
      pad: mediaOnly ? 0 : bubblePad,
      minW: mediaOnly ? 0 : s(SP.minWidth),
      bg: bubbleBg,
      children: [headerNode, forwardNode, replyNode, mediaNode, venueNode, attachmentNode, richNode, textNode]
    })
  }

  // ---- Compose ------------------------------------------------------------

  measure(root)
  if (hasReplyMarkup && root.w < replyMarkup.naturalWidth) {
    root.minW = Math.ceil(replyMarkup.naturalWidth)
    measure(root)
  }
  if (replyNode && reply.giftEmoji && replyNameLeaf) {
    const parent = stickerChip || root
    const replyWidth = parent.w - parent.pad.l - parent.pad.r
    const thumbOffset = reply.thumb ? s(SP.replyThumb + 7) : 0
    const nameRight = replyNode.pad.l + thumbOffset + replyNameLeaf.w
    if (nameRight > replyWidth - s(28)) {
      replyNode.pad.r = s(SP.block.padRGift)
      measure(root)
    }
  }

  let keyboardCanvas = null
  if (hasReplyMarkup) {
    try {
      keyboardCanvas = renderReplyMarkup(replyMarkup, root.w, keyboardRadii)
    } catch (error) {
      // A malformed/new button style must never make the whole message
      // disappear. The preparation step is already best-effort; keep the
      // same boundary around final canvas painting as well.
      console.error('Failed to compose reply markup:', error.message, error.stack)
      throw error
    }
  }
  const keyboardGap = keyboardCanvas ? s(3) : 0
  const keyboardHeight = keyboardCanvas ? keyboardGap + keyboardCanvas.height : 0

  const shadowPad = s(SP.shadowPad)
  const shadowPadTop = s(SP.shadowPadTop)
  const bubblePosX = s(SP.avatar) + s(SP.avatarGap)
  const width = bubblePosX + root.w + shadowPad
  const messageHeight = root.h + keyboardHeight
  const height = shadowPadTop + Math.max(messageHeight, avatar ? s(SP.avatar) + s(2) : 0) + shadowPad

  place(root, bubblePosX, shadowPadTop)

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  render(ctx, root)
  if (keyboardCanvas) {
    ctx.drawImage(keyboardCanvas, bubblePosX, shadowPadTop + root.h + keyboardGap)
  }

  // Avatar at the bottom-left, over the bubble tail.
  if (avatar) {
    // Inline buttons do not move the avatar down: it remains aligned with
    // the message bubble, exactly as in Desktop.
    const avatarY = Math.max(0, shadowPadTop + root.h - s(SP.avatar) - s(2))
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(avatar, 0, avatarY, s(SP.avatar), s(SP.avatar))
  }

  canvas._hasReplyMarkup = hasReplyMarkup
  return canvas
}

// Center-crops an image/canvas to a square (cover fit) for round/thumb media.
function coverSquare (img) {
  const side = Math.min(img.width, img.height)
  if (img.width === img.height) return img
  const out = createCanvas(side, side)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, side, side)
  return out
}

// The modern-Telegram accent block: rounded backdrop tinted with the accent
// color, solid accent bar on the left, optional mini_quote in the top-right
// corner. Used for the reply preview (accent = replied sender's color) and
// the partial-quote body (accent = quoted sender's color).
function accentBlock (s, accent, { icon = false, fillColor = null, backgroundEmoji = null, giftEmoji = null, children }) {
  const b = SP.block
  const colors = (Array.isArray(accent) ? accent : [accent]).filter(Boolean)
  const primary = fillColor || colors[0] || '#fff'
  return box({
    gap: s(b.gap),
    pad: { t: s(b.padY), r: s(icon ? b.padRIcon : b.padR), b: s(b.padY), l: s(b.padL) },
    bg: (ctx, n) => {
      const solid = drawRoundRect(primary, n.w, n.h, s(b.radius), 0)
      ctx.save()
      ctx.globalAlpha = b.tint
      ctx.drawImage(solid, n.x, n.y)
      ctx.restore()
      paintAccentBar(ctx, n, colors, s(b.bar), s(2))
      if (backgroundEmoji || giftEmoji) {
        paintBackgroundEmoji(ctx, n, backgroundEmoji, giftEmoji, primary, icon, s)
      }
      if (icon) ctx.drawImage(drawQuoteIcon(s(b.icon), primary, 1), n.x + n.w - s(b.icon) - s(b.iconInset), n.y + s(b.iconInset))
    },
    children
  })
}

function paintAccentBar (ctx, n, colors, width, shift) {
  ctx.save()
  ctx.beginPath()
  roundedRectPath(ctx, n.x, n.y, width, n.h, width / 2)
  ctx.clip()
  if (colors.length < 2) {
    ctx.fillStyle = colors[0] || '#fff'
    ctx.fillRect(n.x, n.y, width, n.h)
  } else {
    // Exact QuotePaint outline tile from Telegram Desktop/lib_ui.
    const hasThird = colors.length > 2
    const tileH = width * (hasThird ? 6 : 4)
    ctx.fillStyle = colors[0]
    ctx.fillRect(n.x, n.y, width, n.h)
    for (let y = -shift; y < n.h + tileH; y += tileH) {
      ctx.fillStyle = colors[hasThird ? 2 : 1]
      ctx.beginPath()
      ctx.moveTo(n.x + width, n.y + y + width)
      ctx.lineTo(n.x + width, n.y + y + width * (hasThird ? 4 : 3))
      ctx.lineTo(n.x, n.y + y + width * (hasThird ? 5 : 4))
      ctx.lineTo(n.x, n.y + y + width * 2)
      ctx.closePath()
      ctx.fill()
      if (hasThird) {
        ctx.fillStyle = colors[1]
        ctx.beginPath()
        ctx.moveTo(n.x + width, n.y + y + width * 3)
        ctx.lineTo(n.x + width, n.y + y + width * 5)
        ctx.lineTo(n.x, n.y + y + width * 6)
        ctx.lineTo(n.x, n.y + y + width * 4)
        ctx.closePath()
        ctx.fill()
      }
    }
  }
  ctx.restore()
}

function paintBackgroundEmoji (ctx, n, image, giftImage, color, quote, s) {
  // right offset, y, size, opacity — copied from FillBackgroundEmoji.
  const placements = [
    [28, 4, 20, 0.32], [51, 15, 16, 0.32], [64, -2, 12, 0.28],
    [87, 11, 16, 0.24], [125, -2, 20, 0.16], [28, 31, 16, 0.24],
    [72, 33, 20, 0.2], [46, 52, 16, 0.24], [24, 55, 20, 0.18]
  ]
  if (quote) {
    placements.push([4, 23, 16, 0.28], [0, 48, 12, 0.24])
  }
  ctx.save()
  ctx.beginPath()
  roundedRectPath(ctx, n.x, n.y, n.w, n.h, s(SP.block.radius))
  ctx.clip()
  for (let i = 0; i < placements.length; i++) {
    const [right, py, rawSize, opacity] = placements[i]
    const isGift = i === 0 && giftImage
    if (!isGift && !image) continue
    const size = s(rawSize)
    const x = n.x + n.w - s(right + (quote ? 12 : 0))
    const y = n.y + s(py)
    ctx.save()
    ctx.globalAlpha = isGift ? 1 : opacity
    ctx.drawImage(isGift ? giftImage : tintImage(image, color, size), x, y, size, size)
    ctx.restore()
  }
  ctx.restore()
}

function tintImage (image, color, size) {
  const out = createCanvas(Math.max(1, Math.ceil(size)), Math.max(1, Math.ceil(size)))
  const ctx = out.getContext('2d')
  ctx.drawImage(image, 0, 0, out.width, out.height)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, out.width, out.height)
  return out
}

function roundedRectPath (ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2)
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

module.exports = { drawQuote, SP }
