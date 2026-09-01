const { createCanvas } = require('canvas')
const { drawMultilineText } = require('./text-renderer')
const { paintTDesktopIcon } = require('./tdesktop-icons')

// Telegram Desktop: msgBotKbButton + botKbStyle from ui/chat/chat.style.
// quote-api's message font is 24 logical px while Desktop's is 16, so the
// native 15/36px keyboard metrics are scaled by the same 1.5 ratio.
const UI_SCALE = 1.5
const KB = {
  gap: 2 * UI_SCALE,
  padding: 10 * UI_SCALE,
  height: 36 * UI_SCALE,
  textSize: 15 * UI_SCALE,
  icon: 10 * UI_SCALE,
  iconPadding: 4 * UI_SCALE,
  radiusSmall: 8 * UI_SCALE,
  radiusLarge: 16 * UI_SCALE
}

function tlType (value) {
  if (typeof value === 'string') return value.toLowerCase()
  return String(value && (value._ || value.type_name || value.typeName || value.kind) ? (value._ || value.type_name || value.typeName || value.kind) : '').toLowerCase()
}

function normalizeRows (markup) {
  if (!markup || typeof markup !== 'object') return []
  if (/replykeyboard(markup|forcereply|hide)/.test(tlType(markup))) return []
  const sourceRows = Array.isArray(markup.rows)
    ? markup.rows
    : Array.isArray(markup.inline_keyboard)
      ? markup.inline_keyboard
      : []
  return sourceRows.map((row) => {
    const buttons = Array.isArray(row)
      ? row
      : Array.isArray(row && row.buttons)
        ? row.buttons
        : []
    return buttons.map(normalizeButton).filter(Boolean)
  }).filter(row => row.length > 0)
}

function normalizeButton (button) {
  if (!button || typeof button !== 'object') return null
  const text = String(button.text == null ? '' : button.text).replace(/[\r\n]+/g, ' ')
  const type = button.type != null ? button.type : button
  const explicitIcon = button.icon_type || button.iconType || (type && (type.icon_type || type.iconType))
  const rawType = `${tlType(button)} ${tlType(type)} ${String(explicitIcon || '').toLowerCase()}`

  let icon = null
  if (/webview|\bweb\b/.test(rawType) || button.web_app) icon = 'web'
  else if (/switchinline/.test(rawType) || button.switch_inline_query != null || button.switch_inline_query_current_chat != null || button.switch_inline_query_chosen_chat) icon = 'switch'
  else if (/buy/.test(rawType) || button.pay) icon = 'card'
  else if (/copy/.test(rawType) || button.copy_text) icon = 'button'
  else if (/url|auth/.test(rawType) || button.url || button.login_url) icon = 'url'

  const style = button.style && typeof button.style === 'object' ? button.style : {}
  const botApiStyle = typeof button.style === 'string' ? button.style.toLowerCase() : ''
  const color = style.bg_danger || botApiStyle === 'danger'
    ? 'danger'
    : style.bg_primary || botApiStyle === 'primary'
      ? 'primary'
      : style.bg_success || botApiStyle === 'success'
        ? 'success'
        : 'normal'
  const iconId = style.icon == null ? button.icon_custom_emoji_id : style.icon
  const customIcon = iconId == null ? null : String(iconId)
  return { text, icon, color, customIcon }
}

async function prepareReplyMarkup (markup, options = {}) {
  const rows = normalizeRows(markup)
  if (!rows.length) return null

  const scale = Number.isFinite(options.scale) ? options.scale : 1
  const maxWidth = Math.max(1, Math.min(options.maxWidth || 430 * scale, 430 * scale))
  const fontSize = KB.textSize * scale
  for (const row of rows) {
    for (const button of row) {
      let labelText = button.text
      const entities = []
      if (button.customIcon) {
        labelText = `\uD83E\uDD21${labelText ? ` ${labelText}` : ''}`
        entities.push({
          type: 'custom_emoji',
          offset: 0,
          length: 2,
          custom_emoji_id: button.customIcon
        })
      }
      entities.push({ type: 'medium', offset: 0, length: labelText.length })
      try {
        button.label = await drawMultilineText(
          labelText || ' ',
          entities,
          fontSize,
          '#ffffff',
          0,
          fontSize,
          10000,
          KB.height * scale,
          options.emojiBrand,
          options.telegram
        )
      } catch (error) {
        console.warn('Failed to render reply-markup button:', error.message)
        button.customIcon = null
        button.label = await drawMultilineText(
          button.text || ' ',
          [{ type: 'medium', offset: 0, length: button.text.length }],
          fontSize,
          '#ffffff',
          0,
          fontSize,
          10000,
          KB.height * scale,
          options.emojiBrand,
          options.telegram
        )
      }
    }
  }

  const gap = KB.gap * scale
  let naturalWidth = 0
  for (const row of rows) {
    let rowMin = 0
    for (const button of row) rowMin = Math.max(rowMin, minButtonWidth(button, scale))
    let widest = 0
    for (const button of row) widest = Math.max(widest, Math.max(button.label.width, 1) + rowMin)
    naturalWidth = Math.max(naturalWidth, row.length * widest + (row.length - 1) * gap)
  }

  return {
    rows,
    scale,
    dark: !!options.dark,
    naturalWidth: Math.max(KB.height * scale, Math.min(maxWidth, Math.ceil(naturalWidth)))
  }
}

function minButtonWidth (button, scale) {
  // Desktop reserves symmetrical room for a right-side type icon so the
  // title stays visually centred. Custom emoji belongs to the title itself.
  return button.icon
    ? Math.max(2 * KB.padding * scale, 2 * KB.icon * scale + 4 * KB.iconPadding * scale)
    : 2 * KB.padding * scale
}

function renderReplyMarkup (markup, requestedWidth, outerRadii) {
  if (!markup || !markup.rows || !markup.rows.length) return null
  const scale = markup.scale
  const gap = KB.gap * scale
  const buttonHeight = KB.height * scale
  const width = Math.max(1, Math.ceil(requestedWidth))
  const height = Math.ceil(markup.rows.length * buttonHeight + (markup.rows.length - 1) * gap)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const rowsCount = markup.rows.length

  for (let rowIndex = 0; rowIndex < rowsCount; rowIndex++) {
    const row = markup.rows[rowIndex]
    const widths = layoutRow(row, width, scale)
    const y = Math.round(rowIndex * (buttonHeight + gap))
    let cursor = 0
    for (let column = 0; column < row.length; column++) {
      const x = Math.floor(cursor)
      cursor += widths[column]
      const right = column + 1 === row.length ? width : Math.floor(cursor)
      const buttonWidth = Math.max(1, right - x)
      paintButton(
        ctx,
        row[column],
        x,
        y,
        buttonWidth,
        Math.round(buttonHeight),
        markup.dark,
        scale,
        {
          tl: KB.radiusSmall * scale,
          tr: KB.radiusSmall * scale,
          bl: rowIndex + 1 === rowsCount && column === 0
            ? (outerRadii && outerRadii.bl) || KB.radiusLarge * scale
            : KB.radiusSmall * scale,
          br: rowIndex + 1 === rowsCount && column + 1 === row.length
            ? (outerRadii && outerRadii.br) || KB.radiusLarge * scale
            : KB.radiusSmall * scale
        }
      )
      cursor += gap
    }
  }
  return canvas
}

function layoutRow (row, width, scale) {
  const gap = KB.gap * scale
  const count = row.length
  const widthForButtons = width - (count - 1) * gap
  let widthForText = widthForButtons
  let widthOfText = 0
  let maxMinimum = 0
  for (const button of row) {
    const labelWidth = Math.max(button.label.width, 1)
    const minimum = minButtonWidth(button, scale)
    widthForText -= minimum
    widthOfText += labelWidth
    maxMinimum = Math.max(maxMinimum, minimum)
  }
  const exact = Math.abs(widthForText - widthOfText) < 0.5
  const enough = widthForButtons - count * maxMinimum >= widthOfText
  return row.map((button) => {
    const minimum = minButtonWidth(button, scale)
    if (exact) return Math.max(button.label.width, 1) + minimum
    if (enough) return widthForButtons / count
    return Math.max(2 * KB.padding * scale, minimum + widthForText / count)
  })
}

function paintButton (ctx, button, x, y, width, height, dark, scale, radii) {
  ctx.save()
  roundedRectPath(ctx, x, y, width, height, radii)
  ctx.fillStyle = buttonFill(button.color, dark)
  ctx.fill()

  const padding = KB.padding * scale
  const available = Math.max(1, width - padding * 2)
  const label = button.label.width > available ? cropFade(button.label, available) : button.label
  ctx.drawImage(label, x + (width - label.width) / 2, y + (height - label.height) / 2)

  if (button.icon) {
    const size = KB.icon * scale
    paintTDesktopIcon(
      ctx,
      button.icon,
      x + width - size - KB.iconPadding * scale,
      y + KB.iconPadding * scale,
      size,
      '#ffffff'
    )
  }
  ctx.restore()
}

function buttonFill (color, dark) {
  if (color === 'danger') return 'rgba(201, 84, 62, 0.702)'
  if (color === 'primary') return 'rgba(55, 142, 174, 0.702)'
  if (color === 'success') return 'rgba(72, 157, 56, 0.702)'
  return dark ? '#242f3d' : 'rgba(0, 0, 0, 0.45)'
}

function roundedRectPath (ctx, x, y, width, height, radii) {
  let { tl, tr, br, bl } = radii
  const cap = value => Math.max(0, Math.min(value, width / 2, height / 2))
  tl = cap(tl)
  tr = cap(tr)
  br = cap(br)
  bl = cap(bl)
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.arcTo(x + width, y, x + width, y + height, tr)
  ctx.arcTo(x + width, y + height, x, y + height, br)
  ctx.arcTo(x, y + height, x, y, bl)
  ctx.arcTo(x, y, x + width, y, tl)
  ctx.closePath()
}

function cropFade (source, width) {
  if (!source || source.width <= width) return source
  const out = createCanvas(Math.max(1, Math.floor(width)), source.height)
  const ctx = out.getContext('2d')
  ctx.drawImage(source, 0, 0)
  const fade = Math.min(out.width, source.height)
  const gradient = ctx.createLinearGradient(out.width - fade, 0, out.width, 0)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = gradient
  ctx.fillRect(out.width - fade, 0, fade, out.height)
  return out
}

module.exports = { prepareReplyMarkup, renderReplyMarkup }
