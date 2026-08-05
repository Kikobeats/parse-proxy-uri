'use strict'

const { isIP } = require('net')

const usernameGetter = Object.getOwnPropertyDescriptor(
  URL.prototype,
  'username'
).get
const passwordGetter = Object.getOwnPropertyDescriptor(
  URL.prototype,
  'password'
).get

const hasControlChars = value => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

class ParseProxyError extends Error {
  constructor (props) {
    super()
    this.name = 'ParseProxyError'
    Object.assign(this, props)
    this.description = this.message
    this.message = `${this.code}, ${this.description}`
  }
}

// Host token before WHATWG IPv4 normalization (e.g. 2130706433 → 127.0.0.1).
const rawHostname = proxy => {
  let authority = proxy.slice(proxy.indexOf('://') + 3)
  const pathIndex = authority.search(/[/?#]/)
  const atIndex = authority.indexOf('@')

  if (atIndex !== -1 && (pathIndex === -1 || atIndex < pathIndex)) {
    authority = authority.slice(atIndex + 1)
  }

  const hostEnd = authority.search(/[:/?#]/)
  return hostEnd === -1 ? authority : authority.slice(0, hostEnd)
}

class ProxyURL extends URL {
  constructor (proxy) {
    // Require `://` — WHATWG turns `host:port` / `http:8080` into wrong hosts.
    proxy = String(proxy)
    if (!proxy.includes('://')) {
      throw new TypeError('Invalid proxy')
    }

    super(proxy)

    if (
      !this.hostname ||
      (this.pathname !== '' && this.pathname !== '/') ||
      this.search !== '' ||
      this.hash !== ''
    ) {
      throw new TypeError('Invalid proxy')
    }

    if (
      isIP(this.hostname) === 4 &&
      decodeURIComponent(rawHostname(proxy)) !== this.hostname
    ) {
      throw new TypeError('Invalid proxy')
    }

    // Validate credentials at parse time. Keep username/password getters as the
    // WHATWG percent-encoded forms so URL-consuming callers (e.g. got-scraping)
    // can decodeURIComponent exactly once without corrupting credentials or
    // throwing URIError on passwords that contain `%`.
    const decodedUser = decodeURIComponent(usernameGetter.call(this))
    const decodedPass = decodeURIComponent(passwordGetter.call(this))
    if (hasControlChars(decodedUser) || hasControlChars(decodedPass)) {
      throw new TypeError('Invalid proxy')
    }

    Object.defineProperty(this, 'auth', {
      enumerable: true,
      get: () => {
        const user = decodeURIComponent(usernameGetter.call(this))
        const pass = decodeURIComponent(passwordGetter.call(this))
        return user || pass ? `${user}:${pass}` : ''
      }
    })

    Object.defineProperty(this, '__parsed__', {
      enumerable: false,
      writable: false,
      value: true
    })

    Object.defineProperty(this, 'toString', {
      enumerable: false,
      writable: false,
      value: () => {
        const encodedUsername = usernameGetter.call(this)
        const encodedPassword = passwordGetter.call(this)
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
  // Only trust instances we created — a plain `{ __parsed__: true }` must not
  // skip validation (host/credential spoofing).
  if (proxy instanceof ProxyURL) return proxy

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
