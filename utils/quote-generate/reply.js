function firstDefined () {
  for (const value of arguments) {
    if (value !== undefined) return value
  }
}

function normalizeReplyMessage (reply) {
  if (reply.quoteText === undefined && reply.quote_text !== undefined) {
    reply.quoteText = reply.quote_text
  }
  if (reply.quoteEntities === undefined && reply.quote_entities !== undefined) {
    reply.quoteEntities = reply.quote_entities
  }
  if (reply.quoteOffset === undefined && reply.quote_offset !== undefined) {
    reply.quoteOffset = reply.quote_offset
  }
  if (reply.manualQuote === undefined) {
    reply.manualQuote = firstDefined(
      reply.manual_quote,
      reply.quote,
      Boolean(reply.quoteText)
    )
  }
  if (!Array.isArray(reply.entities)) reply.entities = []
  if (!Array.isArray(reply.quoteEntities)) reply.quoteEntities = []
  return reply
}

function resolveReplyContent (reply) {
  const rawQuoteText = firstDefined(reply.quoteText, reply.quote_text)
  const quoteText = rawQuoteText === undefined || rawQuoteText === null
    ? ''
    : String(rawQuoteText)
  const quoteFlag = firstDefined(
    reply.manualQuote,
    reply.manual_quote,
    reply.quote,
    rawQuoteText !== undefined
  )
  const manualQuote = Boolean(quoteFlag && quoteText)
  const rawText = manualQuote ? quoteText : reply.text
  const entities = manualQuote
    ? firstDefined(reply.quoteEntities, reply.quote_entities, [])
    : firstDefined(reply.entities, [])
  const rawOffset = firstDefined(reply.quoteOffset, reply.quote_offset, 0)
  const numericOffset = Number(rawOffset)

  return {
    text: rawText === undefined || rawText === null ? '' : String(rawText),
    entities: Array.isArray(entities) ? entities.slice() : [],
    manualQuote,
    quoteOffset: Number.isFinite(numericOffset) ? Math.max(0, Math.trunc(numericOffset)) : 0
  }
}

module.exports = { normalizeReplyMessage, resolveReplyContent }
