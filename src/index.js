'use strict'

const { isIP } = require('net')

const usernameGetter = Object.getOwnPropertyDescriptor(
  URL.prototype,
  'username'
).get
const usernameSetter = Object.getOwnPropertyDescriptor(
  URL.prototype,
  'username'
).set
const passwordGetter = Object.getOwnPropertyDescriptor(
  URL.prototype,
  'password'
).get
const passwordSetter = Object.getOwnPropertyDescriptor(
  URL.prototype,
  'password'
).set
const hrefGetter = Object.getOwnPropertyDescriptor(URL.prototype, 'href').get
const hrefSetter = Object.getOwnPropertyDescriptor(URL.prototype, 'href').set

// Node's userinfo setters leave bare `%` sequences intact, which later breaks
// decodeURIComponent (auth, got-scraping). Encode only invalid `%` so valid
// escapes like `%40` keep their WHATWG setter meaning.
const encodeBarePercents = value =>
  String(value).replace(/%(?![0-9A-Fa-f]{2})/g, '%25')

// `username`/`password` stay in their WHATWG percent-encoded form so callers
// consuming this as a URL (e.g. got-scraping) decode exactly once.
const decodedCredentials = url => ({
  user: decodeURIComponent(usernameGetter.call(url)),
  pass: decodeURIComponent(passwordGetter.call(url))
})

const hasControlChars = value => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

const assertValidCredentials = url => {
  let user
  let pass
  try {
    ;({ user, pass } = decodedCredentials(url))
  } catch (_) {
    throw new TypeError('Invalid proxy')
  }
  if (hasControlChars(user) || hasControlChars(pass)) {
    throw new TypeError('Invalid proxy')
  }
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

    assertValidCredentials(this)

    Object.defineProperty(this, 'username', {
      enumerable: true,
      get: () => usernameGetter.call(this),
      set: value => {
        const previous = usernameGetter.call(this)
        usernameSetter.call(this, encodeBarePercents(value))
        try {
          assertValidCredentials(this)
        } catch (error) {
          usernameSetter.call(this, previous)
          throw error
        }
      }
    })

    Object.defineProperty(this, 'password', {
      enumerable: true,
      get: () => passwordGetter.call(this),
      set: value => {
        const previous = passwordGetter.call(this)
        passwordSetter.call(this, encodeBarePercents(value))
        try {
          assertValidCredentials(this)
        } catch (error) {
          passwordSetter.call(this, previous)
          throw error
        }
      }
    })

    Object.defineProperty(this, 'href', {
      enumerable: true,
      get: () => hrefGetter.call(this),
      set: value => {
        const previous = hrefGetter.call(this)
        hrefSetter.call(this, value)
        try {
          assertValidCredentials(this)
        } catch (error) {
          hrefSetter.call(this, previous)
          throw error
        }
      }
    })

    Object.defineProperty(this, 'auth', {
      enumerable: true,
      get: () => {
        const { user, pass } = decodedCredentials(this)
        return user || pass ? `${user}:${pass}` : ''
      }
    })

    Object.defineProperty(this, 'toString', {
      enumerable: false,
      writable: false,
      value: () => {
        if (!this.username && !this.password) {
          return `${this.protocol}//${this.host}`
        }
        const userinfo = this.password
          ? `${this.username}:${this.password}`
          : this.username
        return `${this.protocol}//${userinfo}@${this.host}`
      }
    })
  }
}

module.exports = proxy => {
  if (!proxy) return undefined
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
