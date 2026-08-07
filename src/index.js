'use strict'

const { isIP } = require('net')

const MUTABLE_KEYS = [
  'username',
  'password',
  'href',
  'host',
  'hostname',
  'pathname',
  'search',
  'hash'
]

const native = {}
for (const key of MUTABLE_KEYS) {
  native[key] = Object.getOwnPropertyDescriptor(URL.prototype, key)
}

// WHATWG userinfo setters percent-encode everything except `%` itself, so a raw
// `%` would later read back as the start of an escape. Setters take raw values;
// `auth` hands them back verbatim.
const encodePercents = value => String(value).replace(/%/g, '%25')

// `username`/`password` stay in their WHATWG percent-encoded form so callers
// consuming this as a URL (e.g. got-scraping) decode exactly once.
const decodedCredentials = url => ({
  user: decodeURIComponent(url.username),
  pass: decodeURIComponent(url.password)
})

const hasControlChars = value => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

class ParseProxyError extends TypeError {
  constructor (props) {
    super()
    this.name = 'ParseProxyError'
    Object.assign(this, props)
    this.description = this.message
    this.message = `${this.code}, ${this.description}`
  }
}

const invalidProxy = value =>
  new ParseProxyError({
    message: `The value \`${value}\` can't be parsed as proxy`,
    code: 'INVALID_PROXY'
  })

// `URLSearchParams` writes straight through to `search`, out of reach of the
// setters below. A proxy URI never carries a query, so this stays empty and
// detached: reads are accurate, writes are refused.
const sealedSearchParams = () => {
  const params = new URLSearchParams()
  for (const key of ['append', 'delete', 'set', 'sort']) {
    params[key] = (...args) => {
      throw invalidProxy(args[0])
    }
  }
  return params
}

const assertProxyShape = url => {
  if (
    !url.hostname ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new TypeError('Invalid proxy')
  }
}

// WHATWG rewrites integer/octal/hex IPv4 hosts (e.g. 2130706433 → 127.0.0.1),
// which would let an obfuscated host reach a different peer than it reads as.
const assertCanonicalHost = (url, rawHost) => {
  if (isIP(url.hostname) !== 4) return
  let decoded
  try {
    decoded = decodeURIComponent(rawHost)
  } catch (_) {
    throw new TypeError('Invalid proxy')
  }
  if (decoded !== url.hostname) throw new TypeError('Invalid proxy')
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

// Host token before WHATWG IPv4 normalization.
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

    assertProxyShape(this)
    assertCanonicalHost(this, rawHostname(proxy))
    assertValidCredentials(this)

    const guard = (key, mutate) =>
      Object.defineProperty(this, key, {
        enumerable: false,
        configurable: true,
        get: () => native[key].get.call(this),
        set: value => {
          const previous = native.href.get.call(this)
          try {
            mutate(value)
          } catch (_) {
            native.href.set.call(this, previous)
            throw invalidProxy(value)
          }
        }
      })

    guard('username', value => {
      native.username.set.call(this, encodePercents(value))
      assertValidCredentials(this)
    })

    guard('password', value => {
      native.password.set.call(this, encodePercents(value))
      assertValidCredentials(this)
    })

    // A whole proxy URI, held to the same rules as the constructor.
    guard('href', value => {
      const candidate = new ProxyURL(value)
      native.href.set.call(this, native.href.get.call(candidate))
    })

    guard('host', value => {
      native.host.set.call(this, value)
      assertProxyShape(this)
      assertCanonicalHost(this, String(value).split(':')[0])
    })

    guard('hostname', value => {
      native.hostname.set.call(this, value)
      assertProxyShape(this)
      assertCanonicalHost(this, String(value))
    })

    for (const key of ['pathname', 'search', 'hash']) {
      guard(key, value => {
        native[key].set.call(this, value)
        assertProxyShape(this)
      })
    }

    Object.defineProperty(this, 'searchParams', {
      enumerable: false,
      configurable: true,
      get: () => sealedSearchParams()
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
    throw invalidProxy(proxy)
  }
}

module.exports.ProxyURL = ProxyURL
