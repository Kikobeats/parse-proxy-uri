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

    const decoded = getter => decodeURIComponent(getter.call(this))
    decoded(usernameGetter) // reject malformed escapes at parse time
    decoded(passwordGetter)

    Object.defineProperty(this, 'username', {
      enumerable: true,
      get: () => decoded(usernameGetter)
    })

    Object.defineProperty(this, 'password', {
      enumerable: true,
      get: () => decoded(passwordGetter)
    })

    Object.defineProperty(this, 'auth', {
      enumerable: true,
      get: () => {
        const user = this.username
        const pass = this.password
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
