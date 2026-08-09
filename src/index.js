'use strict'

const { isIP } = require('net')

// Guard every WHATWG-assignable field — the set is read off the platform.
const URL_ACCESSOR = {}
for (const key of Object.getOwnPropertyNames(URL.prototype)) {
  const accessor = Object.getOwnPropertyDescriptor(URL.prototype, key)
  if (accessor.set) URL_ACCESSOR[key] = accessor
}

const HREF = URL_ACCESSOR.href

const INVALID_PROXY = 'INVALID_PROXY'

class ParseProxyError extends TypeError {
  constructor (value) {
    const description = `The value \`${value}\` can't be parsed as proxy`
    super(`${INVALID_PROXY}, ${description}`)
    this.name = 'ParseProxyError'
    this.code = INVALID_PROXY
    this.description = description
  }
}

const invalid = value => {
  throw new ParseProxyError(value)
}

// Detached: URLSearchParams writes bypass the `search` accessor below.
const SEALED_SEARCH_PARAMS = new URLSearchParams()
for (const key of ['append', 'delete', 'set', 'sort']) {
  Object.defineProperty(SEALED_SEARCH_PARAMS, key, { value: invalid })
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
    invalid(value)
  }
}

// `isIP` matches IPv4 only as a dotted-quad, which always ends in a digit.
const isCanonicalIPv4 = hostname => {
  const last = hostname.charCodeAt(hostname.length - 1)
  return last >= 48 && last <= 57 && isIP(hostname) === 4
}

// WHATWG userinfo setters leave raw `%` alone, so encode it first.
const PERCENT_SIGN = /%/g
const encodePercents = value => String(value).replace(PERCENT_SIGN, '%25')

// Host token before WHATWG IPv4 normalization (e.g. 2130706433 → 127.0.0.1).
const PATH_START = /[/?#]/
const hostToken = authority => {
  const pathIndex = authority.search(PATH_START)
  if (pathIndex !== -1) authority = authority.slice(0, pathIndex)
  const userinfoEnd = authority.indexOf('@')
  if (userinfoEnd !== -1) authority = authority.slice(userinfoEnd + 1)
  const portStart = authority.indexOf(':')
  return portStart === -1 ? authority : authority.slice(0, portStart)
}

// Without `://`, WHATWG reads `host:port` / `http:8080` as the wrong host.
const rawAuthority = proxy => {
  proxy = String(proxy)
  const schemeEnd = proxy.indexOf('://')
  if (schemeEnd === -1) invalid(proxy)
  return proxy.slice(schemeEnd + 3)
}

// WHATWG ignores special↔non-special protocol switches; href accepts them, so
// the scheme is spliced onto the current href and everything else re-validated.
const writeProtocol = function (value) {
  value = String(value).toLowerCase()
  if (!value.endsWith(':')) value += ':'
  const href = HREF.get.call(this)
  const authorityStart = href.indexOf('://') + 1
  HREF.set.call(this, value + href.slice(authorityStart))
  if (this.protocol !== value) invalid(value)
}

// `encode` rewrites the value before the write, `authority` names the host the
// write is asking for, `write` replaces the native setter. All three optional.
const MUTATION = {
  username: { encode: encodePercents },
  password: { encode: encodePercents },
  href: { authority: rawAuthority },
  host: { authority: String },
  hostname: { authority: String },
  protocol: { write: writeProtocol }
}

const assertValidProxy = (url, authority) => {
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
    (authority !== undefined &&
      isCanonicalIPv4(hostname) &&
      decodeOrThrow(hostToken(authority)) !== hostname)
  ) {
    invalid(url.href)
  }
}

// Own + enumerable so spreads yield decoded credentials, never raw userinfo.
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
    const { protocol, username, password, host } = this
    if (!username && !password) return `${protocol}//${host}`
    const userinfo = password ? `${username}:${password}` : username
    return `${protocol}//${userinfo}@${host}`
  }
}

for (const key of Object.keys(URL_ACCESSOR)) {
  const { get, set } = URL_ACCESSOR[key]
  const { encode, authority, write = set } = MUTATION[key] ?? {}

  Object.defineProperty(ProxyURL.prototype, key, {
    configurable: true,
    get,
    set (value) {
      const previous = HREF.get.call(this)
      try {
        const token = authority?.(value)
        write.call(this, encode ? encode(value) : value)
        assertValidProxy(this, token)
      } catch (_) {
        HREF.set.call(this, previous)
        invalid(value)
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
    invalid(proxy)
  }
}

module.exports.ProxyURL = ProxyURL
