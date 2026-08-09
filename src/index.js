'use strict'

const { isIP } = require('net')

// Guard every WHATWG-assignable field — the set is read off the platform.
const URL_ACCESSOR = {}
for (const key of Object.getOwnPropertyNames(URL.prototype)) {
  const accessor = Object.getOwnPropertyDescriptor(URL.prototype, key)
  if (accessor.set) URL_ACCESSOR[key] = accessor
}

const HREF = URL_ACCESSOR.href

class ParseProxyError extends TypeError {
  constructor (value) {
    const description = `The value \`${value}\` can't be parsed as proxy`
    super(`INVALID_PROXY, ${description}`)
    this.name = 'ParseProxyError'
    this.code = 'INVALID_PROXY'
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

// Hostnames rarely end in a digit — skip `isIP` for the common case.
const isCanonicalIPv4 = hostname => {
  const last = hostname.charCodeAt(hostname.length - 1)
  return last >= 48 && last <= 57 && isIP(hostname) === 4
}

// WHATWG userinfo setters leave raw `%` alone, so encode it first.
const encodePercents = value => String(value).replace(/%/g, '%25')

// Host token before WHATWG IPv4 normalization (e.g. 2130706433 → 127.0.0.1).
const hostToken = authority => {
  let end = authority.search(/[/?#]/)
  if (end !== -1) authority = authority.slice(0, end)
  end = authority.indexOf('@')
  if (end !== -1) authority = authority.slice(end + 1)
  end = authority.indexOf(':')
  return end === -1 ? authority : authority.slice(0, end)
}

// Without `://`, WHATWG reads `host:port` / `http:8080` as the wrong host.
const rawAuthority = proxy => {
  proxy = String(proxy)
  const schemeEnd = proxy.indexOf('://')
  if (schemeEnd === -1) invalid(proxy)
  return proxy.slice(schemeEnd + 3)
}

const serialize = (url, protocol = url.protocol) => {
  const { username, password, host } = url
  if (!username && !password) return `${protocol}//${host}`
  const creds = password ? `${username}:${password}` : username
  return `${protocol}//${creds}@${host}`
}

// WHATWG ignores special↔non-special protocol switches; href accepts them.
const applyProtocol = (url, value) => {
  value = String(value).toLowerCase()
  if (!value.endsWith(':')) value += ':'
  HREF.set.call(url, serialize(url, value))
  if (url.protocol !== value) invalid(value)
}

// Mutators may return an authority token when the write can rename the host.
const encodeCredentials = (url, value, set) => {
  set.call(url, encodePercents(value))
}

const assignHost = (url, value, set) => {
  const authority = String(value)
  set.call(url, value)
  return authority
}

const MUTATION = {
  username: encodeCredentials,
  password: encodeCredentials,
  href (url, value, set) {
    const authority = rawAuthority(value)
    set.call(url, value)
    return authority
  },
  host: assignHost,
  hostname: assignHost,
  protocol: applyProtocol
}

const assertValidProxy = (url, authority = url.hostname) => {
  const user = decodeOrThrow(url.username)
  const pass = decodeOrThrow(url.password)

  if (
    !url.hostname ||
    !['', '/'].includes(url.pathname) ||
    url.search ||
    url.hash ||
    hasControlChars(user) ||
    hasControlChars(pass) ||
    (isCanonicalIPv4(url.hostname) &&
      decodeOrThrow(hostToken(authority)) !== url.hostname)
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
    return serialize(this)
  }
}

for (const key of Object.keys(URL_ACCESSOR)) {
  const { get, set } = URL_ACCESSOR[key]
  const mutate =
    MUTATION[key] ?? ((url, value, native) => native.call(url, value))

  Object.defineProperty(ProxyURL.prototype, key, {
    configurable: true,
    get,
    set (value) {
      const previous = HREF.get.call(this)
      try {
        assertValidProxy(this, mutate(this, value, set))
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
