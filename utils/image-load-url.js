const https = require('https')
const http = require('http')

module.exports = (url, filter = false) => {
  return new Promise((resolve, reject) => {
    if (url.startsWith('data:')) {
      try {
        const [header, data] = url.split(',')
        const isBase64 = header.includes('base64')
        
        if (isBase64) {
          const buffer = Buffer.from(data, 'base64')
          resolve(buffer)
        } else {
          const buffer = Buffer.from(decodeURIComponent(data), 'utf8')
          resolve(buffer)
        }
        return
      } catch (err) {
        reject(new Error(`Invalid data URL: ${err.message}`))
        return
      }
    }

    const protocol = url.startsWith('https:') ? https : http
    
    const request = protocol.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP Error: ${res.statusCode}`))
        return
      }

      if (filter && filter(res.headers)) {
        resolve(Buffer.concat([]))
        return
      }

      const chunks = []

      res.on('error', (err) => {
        reject(err)
      })
      
      res.on('data', (chunk) => {
        chunks.push(chunk)
      })
      
      res.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
    })

    request.on('error', (err) => {
      reject(err)
    })

    request.setTimeout(10000, () => {
      request.destroy()
      reject(new Error('Request timeout'))
    })
  })
}
