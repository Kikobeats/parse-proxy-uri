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
        // Read percent-encoded credentials from the URL internal slots.
        // The own `username`/`password` properties are decoded for callers,
        // but serializing those decoded values would corrupt proxies whose
        // credentials contain reserved characters (@, :, /, etc.).
        const username = Object.getOwnPropertyDescriptor(
          URL.prototype,
          'username'
        ).get.call(this)
        const password = Object.getOwnPropertyDescriptor(
          URL.prototype,
          'password'
        ).get.call(this)

        if (!username && !password) {
          return `${this.protocol}//${this.host}`
        }

        return `${this.protocol}//${username}:${password}@${this.host}`
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
