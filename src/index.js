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
    // WHATWG URL treats `host:port` as a custom scheme (empty host) and
    // `http:8080` as the IPv4 integer host 0.0.31.144. Require an explicit
    // `://` authority so we never return a silently misrouted proxy.
    if (typeof proxy !== 'string' || !proxy.includes('://')) {
      throw new TypeError('Invalid proxy')
    }

    super(proxy)

    if (!this.hostname) {
      throw new TypeError('Invalid proxy')
    }

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

    // Fail fast on malformed percent-escapes so parseProxy still returns
    // INVALID_PROXY instead of a late URIError from the getters below.
    decodeURIComponent(usernameGetter.call(this))
    decodeURIComponent(passwordGetter.call(this))

    // Expose decoded credentials, but always read them from the underlying URL
    // slots. Capturing them once (and freezing the values) desyncs from later
    // href/host mutations: toString() would keep shipping the old userinfo to
    // a new host, and username/password/auth would disagree with href.
    Object.defineProperty(this, 'username', {
      enumerable: true,
      get: () => decodeURIComponent(usernameGetter.call(this))
    })

    Object.defineProperty(this, 'password', {
      enumerable: true,
      get: () => decodeURIComponent(passwordGetter.call(this))
    })

    // Match toString(): omit credentials entirely when both are empty so
    // truthy checks on `auth` do not force a blank Proxy-Authorization.
    Object.defineProperty(this, 'auth', {
      enumerable: true,
      get: () =>
        this.username || this.password
          ? `${this.username}:${this.password}`
          : ''
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
        // Use the live percent-encoded userinfo so reserved characters round-
        // trip and mutations of host/href stay consistent.
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
