function parseDate (value) {
  if (value instanceof Date) return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Math.abs(value) < 1e12 ? value * 1000 : value)
  }
  if (typeof value === 'string') {
    const numeric = Number(value)
    if (value.trim() && Number.isFinite(numeric)) {
      return new Date(Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric)
    }
    return new Date(value)
  }
  return new Date(NaN)
}

function relativeDate (date) {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000)
  const absolute = Math.abs(seconds)
  let divisor = 1
  let unit = 'second'
  if (absolute >= 365 * 86400) {
    divisor = 365 * 86400
    unit = 'year'
  } else if (absolute >= 30 * 86400) {
    divisor = 30 * 86400
    unit = 'month'
  } else if (absolute >= 86400) {
    divisor = 86400
    unit = 'day'
  } else if (absolute >= 3600) {
    divisor = 3600
    unit = 'hour'
  } else if (absolute >= 60) {
    divisor = 60
    unit = 'minute'
  }
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    Math.round(seconds / divisor),
    unit
  )
}

function formatFormattedDate (entity, fallback = '') {
  const date = parseDate(entity && entity.date)
  if (Number.isNaN(date.valueOf())) return fallback
  if (entity.relative) return relativeDate(date)

  const options = {}
  if (entity.day_of_week) options.weekday = entity.long_date ? 'long' : 'short'
  if (entity.long_date) {
    options.year = 'numeric'
    options.month = 'long'
    options.day = 'numeric'
  } else if (entity.short_date) {
    options.year = 'numeric'
    options.month = 'numeric'
    options.day = 'numeric'
  }
  if (entity.long_time || entity.short_time) {
    options.hour = '2-digit'
    options.minute = '2-digit'
    if (entity.long_time) options.second = '2-digit'
  }
  if (!Object.keys(options).length) {
    options.year = 'numeric'
    options.month = 'numeric'
    options.day = 'numeric'
    options.hour = '2-digit'
    options.minute = '2-digit'
  }
  return new Intl.DateTimeFormat('en', options).format(date)
}

function isFormattedDate (entity) {
  return ['formatted_date', 'formatteddate', 'messageentityformatteddate']
    .includes(String(entity && entity.type || '').replace(/_/g, '').toLowerCase()) ||
    String(entity && entity.type || '').toLowerCase() === 'formatted_date'
}

function resolveFormattedDates (text, entities) {
  if (!Array.isArray(entities) || !entities.some(isFormattedDate)) {
    return { text, entities }
  }

  let result = String(text)
  let working = entities.map((entity, index) => ({ ...entity, _dateEntityIndex: index }))
  const dates = working.filter(isFormattedDate).sort((a, b) => b.offset - a.offset)

  for (const dateEntity of dates) {
    const live = working.find(entity => entity._dateEntityIndex === dateEntity._dateEntityIndex)
    if (!live) continue
    const start = Math.max(0, Math.min(result.length, Number(live.offset) || 0))
    const end = Math.max(start, Math.min(result.length, start + (Number(live.length) || 0)))
    const replacement = formatFormattedDate(live, result.slice(start, end))
    const replacementEnd = start + replacement.length
    const delta = replacement.length - (end - start)
    result = result.slice(0, start) + replacement + result.slice(end)

    working = working
      .filter(entity => entity._dateEntityIndex !== live._dateEntityIndex)
      .map(entity => {
        const entityStart = Number(entity.offset) || 0
        const entityEnd = entityStart + (Number(entity.length) || 0)
        const mappedStart = entityStart <= start
          ? entityStart
          : entityStart >= end ? entityStart + delta : start
        const mappedEnd = entityEnd <= start
          ? entityEnd
          : entityEnd >= end ? entityEnd + delta : replacementEnd
        return { ...entity, offset: mappedStart, length: Math.max(0, mappedEnd - mappedStart) }
      })
  }

  return {
    text: result,
    entities: working.map(({ _dateEntityIndex, ...entity }) => entity)
  }
}

module.exports = { formatFormattedDate, resolveFormattedDates }
