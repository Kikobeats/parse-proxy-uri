'use strict'

const usernameGetter = Object.getOwnPropertyDescriptor(URL.prototype, 'username')
  .get
const passwordGetter = Object.getOwnPropertyDescriptor(URL.prototype, 'password')
  .get

class ParseProxyError extends Error {
  constructor (props) {
    super()
    this.name = 'ParseProxyError'
    Object.assign(this, props)
    this.description = this.message
    this.message = `${this.code}, ${this.description}`
  }
}

class ProxyURL extends URL {
  constructor (proxy) {
    super(proxy)

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

    Object.defineProperty(this, 'auth', {
      enumerable: true,
      get: () => `${this.username}:${this.password}`
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
