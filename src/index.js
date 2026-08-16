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

const throwInvalid = value => {
  throw new ParseProxyError(value)
}

// Detached: URLSearchParams writes bypass the `search` accessor below.
const SEALED_SEARCH_PARAMS = new URLSearchParams()
for (const key of ['append', 'delete', 'set', 'sort']) {
  Object.defineProperty(SEALED_SEARCH_PARAMS, key, { value: throwInvalid })
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
    throwInvalid(value)
  }
}

// `isIP` matches IPv4 only as a dotted-quad, which always ends in a digit.
const isCanonicalIPv4 = hostname => {
  const last = hostname.charCodeAt(hostname.length - 1)
  return last >= 48 && last <= 57 && isIP(hostname) === 4
}

// WHATWG userinfo setters leave raw `%` alone, so encode it first.
const PERCENT_SIGN = /%/g
const encodePercents = value => {
  value = String(value)
  return value.includes('%') ? value.replace(PERCENT_SIGN, '%25') : value
}

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
  if (schemeEnd === -1) throwInvalid(proxy)
  return proxy.slice(schemeEnd + 3)
}

// WHATWG href drops the scheme's default port, so splicing onto it would
// retarget `http://proxy:80` → `socks5://proxy` (SOCKS clients use 1080).
const DEFAULT_PORT = {
  'ftp:': '21',
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443'
}

const writeProtocol = function (value) {
  value = value.toLowerCase()
  if (!value.endsWith(':')) value += ':'
  let authority = rawAuthority(HREF.get.call(this))
  const implicitPort = DEFAULT_PORT[this.protocol]
  if (implicitPort && !this.port) {
    const pathIndex = authority.search(PATH_START)
    const host = pathIndex === -1 ? authority : authority.slice(0, pathIndex)
    const path = pathIndex === -1 ? '' : authority.slice(pathIndex)
    authority = `${host}:${implicitPort}${path}`
  }
  HREF.set.call(this, `${value}//${authority}`)
  if (this.protocol !== value) throwInvalid(value)
}

// WHATWG host/port setters truncate or no-op on junk; reject anything that is
// not a canonical hostname / host / port token before trusting the write.
const SMUGGLE = /[/\\?#@]/

const isCanonicalPortString = value =>
  /^(?:0|[1-9]\d{0,4})$/.test(value) && Number(value) <= 65535

const splitHostValue = value => {
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end === -1) return null
    const hostname = value.slice(0, end + 1)
    const rest = value.slice(end + 1)
    if (rest === '') return { hostname, port: null }
    if (!rest.startsWith(':')) return null
    return { hostname, port: rest.slice(1) }
  }
  const colon = value.indexOf(':')
  const hostname = colon === -1 ? value : value.slice(0, colon)
  if (!hostname) return null
  return { hostname, port: colon === -1 ? null : value.slice(colon + 1) }
}

const isBracketedIPv6 = hostname =>
  hostname.startsWith('[') && hostname.endsWith(']')

const hasHostSmuggle = value =>
  !value || SMUGGLE.test(value) || hasControlChars(value)

// Dual-probe: a true no-op leaves two different bases unchanged.
const appliedHostname = value => {
  const a = new URL('http://a.invalid')
  const b = new URL('http://b.invalid')
  URL_ACCESSOR.hostname.set.call(a, value)
  URL_ACCESSOR.hostname.set.call(b, value)
  if (a.hostname !== b.hostname) return null
  return a.hostname
}

const writeHostname = function (value) {
  if (hasHostSmuggle(value)) throwInvalid(value)
  if (value.includes(':') && !isBracketedIPv6(value)) throwInvalid(value)
  URL_ACCESSOR.hostname.set.call(this, value)
  const hostname = appliedHostname(value)
  if (!hostname || hostname !== this.hostname) throwInvalid(value)
}

const writeHost = function (value) {
  if (hasHostSmuggle(value)) throwInvalid(value)
  const parts = splitHostValue(value)
  if (!parts) throwInvalid(value)
  // `foo:` keeps the previous port — require an omitted or canonical port.
  if (parts.port !== null && !isCanonicalPortString(parts.port)) {
    throwInvalid(value)
  }
  URL_ACCESSOR.host.set.call(this, value)
  const hostname = appliedHostname(parts.hostname)
  if (!hostname || hostname !== this.hostname) throwInvalid(value)
  if (parts.port !== null && this.port !== parts.port && this.port !== '') {
    throwInvalid(value)
  }
}

const writePort = function (value) {
  if (value !== '' && !isCanonicalPortString(value)) throwInvalid(value)
  URL_ACCESSOR.port.set.call(this, value)
  // Default ports elide to "" (e.g. http + "80"); anything else must stick.
  if (this.port !== value && this.port !== '') throwInvalid(value)
}

// Without `authority` the write cannot name a host, so the loop holds it to the
// hostname it had going in.
const MUTATION = {
  username: { encode: encodePercents },
  password: { encode: encodePercents },
  href: { authority: rawAuthority },
  host: { authority: String, write: writeHost },
  hostname: { authority: String, write: writeHostname },
  port: { write: writePort },
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
    (isCanonicalIPv4(hostname) &&
      decodeOrThrow(hostToken(authority)) !== hostname)
  ) {
    throwInvalid(url.href)
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

// WHATWG setters coerce via ToString, so `hostname = null` becomes host
// "null" and quietly retargets the proxy (credentials and all). Require a
// string — except `port`, where an integer in range is unambiguous.
const asMutationString = (key, value) => {
  if (typeof value === 'string') return value
  if (
    key === 'port' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 65535
  ) {
    return String(value)
  }
  throwInvalid(value)
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
        value = asMutationString(key, value)
        // Host-blind writes must keep the hostname they had going in —
        // special schemes percent-decode and IPv4-normalize, so a socks
        // opaque name like `127%2e0%2e0%2e1` would otherwise become loopback.
        const previousHostname = this.hostname
        const requested = authority ? authority(value) : previousHostname
        write.call(this, encode ? encode(value) : value)
        assertValidProxy(this, requested)
        if (!authority && this.hostname !== previousHostname) {
          throwInvalid(value)
        }
      } catch (_) {
        HREF.set.call(this, previous)
        throwInvalid(value)
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
    throwInvalid(proxy)
  }
}

module.exports.ProxyURL = ProxyURL
