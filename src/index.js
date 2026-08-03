'use strict'

const { isIP } = require('net')

class ParseProxyError extends Error {
  constructor (props) {
    super()
    this.name = 'ParseProxyError'
    Object.assign(this, props)
    this.description = this.message
    this.message = `${this.code}, ${this.description}`
  }
}

// Pull the hostname token out of the original URI before WHATWG normalizes it.
// Special schemes rewrite decimal/octal/hex/short IPv4 forms (e.g. 2130706433 →
// 127.0.0.1), which would silently misroute the proxy if we trusted hostname.
const rawHostname = proxy => {
  let authority = proxy.slice(proxy.indexOf('://') + 3)
  const pathIndex = authority.search(/[/?#]/)
  const atIndex = authority.indexOf('@')

  if (atIndex !== -1 && (pathIndex === -1 || atIndex < pathIndex)) {
    authority = authority.slice(atIndex + 1)
  }

  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    return end === -1 ? authority : authority.slice(0, end + 1)
  }

  const hostEnd = authority.search(/[:/?#]/)
  return hostEnd === -1 ? authority : authority.slice(0, hostEnd)
}

class ProxyURL extends URL {
  constructor (proxy) {
    super(proxy)

    // Proxy URIs are authority-only. A path/query/hash usually means reserved
    // characters in userinfo were not percent-encoded, which WHATWG then
    // treats as the start of the path and drops the real host (e.g.
    // http://us/er:pass@proxy.example:8080 → host "us").
    if (
      (this.pathname !== '' && this.pathname !== '/') ||
      this.search !== '' ||
      this.hash !== ''
    ) {
      throw new TypeError('Invalid proxy')
    }

    if (isIP(this.hostname) === 4 && rawHostname(proxy) !== this.hostname) {
      throw new TypeError('Invalid proxy')
    }

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
