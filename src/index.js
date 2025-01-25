'use strict'

class ParseProxyError extends Error {
  constructor (props) {
    super()
    this.name = 'ParseProxyError'
    Object.assign(this, props)
    this.description = this.message
    this.message = this.code
      ? `${this.code}, ${this.description}`
      : this.description
  }
}

module.exports = proxy => {
  if (!proxy) return undefined
  if (typeof proxy === 'object' && proxy.__parsed__) return proxy

  try {
    const {
      host,
      hostname,
      password: encodedPassword,
      port,
      protocol: rawProtocol,
      username: encodedUsername
    } = new URL(proxy)

    const username = decodeURIComponent(encodedUsername)
    const password = decodeURIComponent(encodedPassword)

    const auth = `${username}:${password}`
    const protocol = rawProtocol.replace(':', '')

    const proxyObj = {
      auth,
      host,
      hostname,
      password,
      port,
      protocol,
      username
    }

    Object.defineProperty(proxyObj, '__parsed__', {
      enumerable: false,
      writable: false,
      value: true
    })

    Object.defineProperty(proxyObj, 'toString', {
      enumerable: false,
      writable: false,
      value: () => `${protocol}://${auth}@${host}`
    })

    return proxyObj
  } catch (err) {
    throw new ParseProxyError({
      message: `The value \`${proxy}\` can't be parsed as proxy`,
      code: 'INVALID_PROXY'
    })
  }
}
