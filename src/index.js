'use strict'

class ParseProxyError extends Error {
  constructor (props) {
    super()
    this.name = 'ParseProxyError'
    Object.assign(this, props)
    this.description = this.message
    this.message = `${this.code}, ${this.description}`
  }
}

class ProxyURL extends URL {
  constructor (proxy) {
    super(proxy)

    // Capture the percent-encoded credentials before shadowing the accessors
    // below with decoded values. Serializing the decoded values in `toString`
    // would corrupt proxies whose credentials contain reserved characters
    // (@, :, /, etc.).
    const encodedUsername = this.username
    const encodedPassword = this.password

    Object.defineProperty(this, 'username', {
      enumerable: true,
      writable: false,
      value: decodeURIComponent(this.username)
    })

    Object.defineProperty(this, 'password', {
      enumerable: true,
      writable: false,
      value: decodeURIComponent(this.password)
    })

    this.auth = `${this.username}:${this.password}`

    Object.defineProperty(this, '__parsed__', {
      enumerable: false,
      writable: false,
      value: true
    })

    Object.defineProperty(this, 'toString', {
      enumerable: false,
      writable: false,
      value: () => {
        if (!encodedUsername && !encodedPassword) {
          return `${this.protocol}//${this.host}`
        }
        const userinfo = encodedPassword
          ? `${encodedUsername}:${encodedPassword}`
          : encodedUsername
        return `${this.protocol}//${userinfo}@${this.host}`
      }
    })
  }
}

module.exports = proxy => {
  if (!proxy) return undefined
  if (typeof proxy === 'object' && proxy.__parsed__) return proxy

  try {
    return new ProxyURL(proxy)
  } catch (_) {
    throw new ParseProxyError({
      message: `The value \`${proxy}\` can't be parsed as proxy`,
      code: 'INVALID_PROXY'
    })
  }
}

module.exports.ProxyURL = ProxyURL
