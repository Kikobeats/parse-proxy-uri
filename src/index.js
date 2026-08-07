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

const ENCODED_KEYS = new Set(['username', 'password'])

const nativeGet = (url, key) => Reflect.get(URL.prototype, key, url)

const nativeSet = (url, key, value) =>
  Reflect.set(URL.prototype, key, value, url)

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
// accessors below. A proxy URI never carries a query, so this one is empty,
// detached and shared: reads are accurate, writes are refused.
const SEALED_SEARCH_PARAMS = new URLSearchParams()
for (const key of ['append', 'delete', 'set', 'sort']) {
  SEALED_SEARCH_PARAMS[key] = value => {
    throw invalidProxy(value)
  }
}

const hasControlChars = value => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

const decodeOrThrow = value => {
  try {
    return decodeURIComponent(value)
  } catch (_) {
    throw new TypeError('Invalid proxy')
  }
}

// WHATWG userinfo setters percent-encode everything except `%` itself, so a raw
// `%` would later read back as the start of an escape. Setters take raw values;
// `auth` hands them back verbatim.
const encodePercents = value => String(value).replace(/%/g, '%25')

// Host token before WHATWG IPv4 normalization (e.g. 2130706433 → 127.0.0.1).
// Also where `://` is required — WHATWG turns `host:port` / `http:8080` into
// wrong hosts, and without it there is no authority to read.
const rawHostname = proxy => {
  proxy = String(proxy)
  if (!proxy.includes('://')) throw new TypeError('Invalid proxy')

  let authority = proxy.slice(proxy.indexOf('://') + 3)
  const pathIndex = authority.search(/[/?#]/)
  const atIndex = authority.indexOf('@')

  if (atIndex !== -1 && (pathIndex === -1 || atIndex < pathIndex)) {
    authority = authority.slice(atIndex + 1)
  }

  const hostEnd = authority.search(/[:/?#]/)
  return hostEnd === -1 ? authority : authority.slice(0, hostEnd)
}

// Only a mutation that can introduce a new host needs the pre-normalization
// token; for the rest the current hostname is already canonical.
const RAW_HOSTNAME = {
  href: value => rawHostname(value),
  host: value => rawHostname(`x://${value}`),
  hostname: value => String(value)
}

const assertValidProxy = (url, rawHost = url.hostname) => {
  const user = decodeOrThrow(url.username)
  const pass = decodeOrThrow(url.password)

  if (
    !url.hostname ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== '' ||
    hasControlChars(user) ||
    hasControlChars(pass) ||
    (isIP(url.hostname) === 4 && decodeOrThrow(rawHost) !== url.hostname)
  ) {
    throw new TypeError('Invalid proxy')
  }
}

// `auth` is the only own property, so spreading a proxy yields just the
// credentials a caller asked for and never the raw ones.
const AUTH = {
  enumerable: true,
  get () {
    const user = decodeURIComponent(this.username)
    const pass = decodeURIComponent(this.password)
    return user || pass ? `${user}:${pass}` : ''
  }
}

class ProxyURL extends URL {
  constructor (proxy) {
    const rawHost = rawHostname(proxy)
    super(String(proxy))
    assertValidProxy(this, rawHost)
    Object.defineProperty(this, 'auth', AUTH)
  }

  get searchParams () {
    return SEALED_SEARCH_PARAMS
  }

  toString () {
    if (!this.username && !this.password) {
      return `${this.protocol}//${this.host}`
    }
    const userinfo = this.password
      ? `${this.username}:${this.password}`
      : this.username
    return `${this.protocol}//${userinfo}@${this.host}`
  }
}

// Every mutation runs the same check the constructor ran, and unwinds through
// `href` when it fails, so a parsed proxy can never become one `parseProxy`
// would have rejected.
for (const key of MUTABLE_KEYS) {
  const rawHostnameOf = RAW_HOSTNAME[key]
  const encode = ENCODED_KEYS.has(key)

  Object.defineProperty(ProxyURL.prototype, key, {
    configurable: true,
    get () {
      return nativeGet(this, key)
    },
    set (value) {
      const previous = nativeGet(this, 'href')
      try {
        const rawHost = rawHostnameOf && rawHostnameOf(value)
        nativeSet(this, key, encode ? encodePercents(value) : value)
        assertValidProxy(this, rawHost)
      } catch (_) {
        nativeSet(this, 'href', previous)
        throw invalidProxy(value)
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
    throw invalidProxy(proxy)
  }
}

module.exports.ProxyURL = ProxyURL
