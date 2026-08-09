'use strict'

const { isIP } = require('net')

// Whatever WHATWG lets you assign is what has to be guarded, so the set is read
// off the platform rather than hand-kept.
const URL_ACCESSOR = {}
for (const key of Object.getOwnPropertyNames(URL.prototype)) {
  const accessor = Object.getOwnPropertyDescriptor(URL.prototype, key)
  if (accessor.set) URL_ACCESSOR[key] = accessor
}

const HREF = URL_ACCESSOR.href

class ParseProxyError extends TypeError {
  constructor (value) {
    super()
    this.name = 'ParseProxyError'
    this.code = 'INVALID_PROXY'
    this.description = `The value \`${value}\` can't be parsed as proxy`
    this.message = `${this.code}, ${this.description}`
  }
}

// `URLSearchParams` writes straight through to `search`, out of reach of the
// accessors below. A proxy URI never carries a query, so this one is empty and
// detached: reads are accurate, writes are refused.
const SEALED_SEARCH_PARAMS = new URLSearchParams()
for (const key of ['append', 'delete', 'set', 'sort']) {
  Object.defineProperty(SEALED_SEARCH_PARAMS, key, {
    value: value => {
      throw new ParseProxyError(value)
    }
  })
}

const hasControlChars = value => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

const decodeOrThrow = value => {
  if (!value.includes('%')) return value
  try {
    return decodeURIComponent(value)
  } catch (_) {
    throw new ParseProxyError(value)
  }
}

// `isIP` matches IPv4 only as dotted-quad, which always ends in a digit — worth
// ruling out first, since a proxy host is usually a name.
const isCanonicalIPv4 = hostname => {
  const last = hostname.charCodeAt(hostname.length - 1)
  return last >= 48 && last <= 57 && isIP(hostname) === 4
}

// WHATWG userinfo setters percent-encode everything except `%` itself, so a raw
// `%` would later read back as the start of an escape.
const encodePercents = value => String(value).replace(/%/g, '%25')

// Host token before WHATWG IPv4 normalization (e.g. 2130706433 → 127.0.0.1).
const hostToken = authority => {
  const pathIndex = authority.search(/[/?#]/)
  const atIndex = authority.indexOf('@')

  if (atIndex !== -1 && (pathIndex === -1 || atIndex < pathIndex)) {
    authority = authority.slice(atIndex + 1)
  }

  const hostEnd = authority.search(/[:/?#]/)
  return hostEnd === -1 ? authority : authority.slice(0, hostEnd)
}

// WHATWG turns `host:port` / `http:8080` into wrong hosts, so `://` is
// required — and without it there is no authority to read.
const rawAuthority = proxy => {
  proxy = String(proxy)
  const schemeEnd = proxy.indexOf('://')
  if (schemeEnd === -1) throw new ParseProxyError(proxy)
  return proxy.slice(schemeEnd + 3)
}

// Serialized userinfo, including the trailing `@` when credentials exist.
const userinfo = url => {
  if (!url.username && !url.password) return ''
  return `${url.password ? `${url.username}:${url.password}` : url.username}@`
}

// WHATWG ignores protocol switches across the special/non-special boundary
// (`http:` ↔ `socks5:`), so assign via href, which does accept them.
const applyProtocol = (url, value) => {
  value = String(value).toLowerCase()
  if (!value.endsWith(':')) value += ':'
  HREF.set.call(url, `${value}//${userinfo(url)}${url.host}`)
  if (url.protocol !== value) throw new ParseProxyError(value)
}

// Only an assignment that can name a new host carries `authority`; for the rest
// the hostname in hand is already one, and already canonical. `apply` replaces
// the native setter when the platform write is the wrong tool.
const MUTATION = {
  username: { encode: true },
  password: { encode: true },
  href: { authority: rawAuthority },
  host: { authority: String },
  hostname: { authority: String },
  protocol: { apply: applyProtocol }
}

const assertValidProxy = (url, authority = url.hostname) => {
  const { hostname, pathname } = url
  const user = decodeOrThrow(url.username)
  const pass = decodeOrThrow(url.password)

  if (
    !hostname ||
    (pathname !== '' && pathname !== '/') ||
    url.search !== '' ||
    url.hash !== '' ||
    hasControlChars(user) ||
    hasControlChars(pass) ||
    (isCanonicalIPv4(hostname) &&
      decodeOrThrow(hostToken(authority)) !== hostname)
  ) {
    throw new ParseProxyError(url.href)
  }
}

// Own rather than inherited, so spreading a proxy yields the credentials a
// caller asked for and never the raw ones.
const AUTH = {
  enumerable: true,
  get () {
    const user = decodeOrThrow(this.username)
    const pass = decodeOrThrow(this.password)
    return user || pass ? `${user}:${pass}` : ''
  }
}

class ProxyURL extends URL {
  constructor (proxy) {
    const authority = rawAuthority(proxy)
    super(proxy)
    assertValidProxy(this, authority)
    Object.defineProperty(this, 'auth', AUTH)
  }

  get searchParams () {
    return SEALED_SEARCH_PARAMS
  }

  toString () {
    return `${this.protocol}//${userinfo(this)}${this.host}`
  }
}

for (const key of Object.keys(URL_ACCESSOR)) {
  const { get, set } = URL_ACCESSOR[key]
  const { encode, authority: authorityOf, apply } = MUTATION[key] ?? {}
  const write =
    apply ??
    ((url, value) => set.call(url, encode ? encodePercents(value) : value))

  Object.defineProperty(ProxyURL.prototype, key, {
    configurable: true,
    get,
    set (value) {
      const previous = HREF.get.call(this)
      try {
        const authority = authorityOf?.(value)
        write(this, value)
        assertValidProxy(this, authority)
      } catch (_) {
        HREF.set.call(this, previous)
        throw new ParseProxyError(value)
      }
    }
  })
}

module.exports = proxy => {
  if (!proxy) return undefined
  if (proxy instanceof ProxyURL) return proxy

  try {
    return new ProxyURL(proxy)
  } catch (_) {
    throw new ParseProxyError(proxy)
  }
}

module.exports.ProxyURL = ProxyURL
