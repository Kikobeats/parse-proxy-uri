'use strict'

const whoops = require('whoops')

const ParseProxyError = whoops('ParseProxyError')

module.exports = proxy => {
  if (!proxy) return undefined
  if (typeof proxy === 'object' && proxy.__parsed__) return proxy

  try {
    const {
      username: encodedUsername,
      password: encodedPassword,
      hostname,
      protocol: rawProtocol,
      port
    } = new URL(proxy)

    const username = decodeURIComponent(encodedUsername)
    const password = decodeURIComponent(encodedPassword)

    const auth = `${username}:${password}`
    const protocol = rawProtocol.replace(':', '')

    const proxyObj = {
      username,
      password,
      hostname,
      protocol,
      port,
      auth
    }

    Object.defineProperty(proxyObj, '__parsed__', {
      enumerable: false,
      writable: false,
      value: true
    })

    Object.defineProperty(proxyObj, 'toString', {
      enumerable: false,
      writable: false,
      value: () => `${protocol}://${auth}@${hostname}:${port}`
    })

    return proxyObj
  } catch (err) {
    throw new ParseProxyError({
      message: `The value \`${proxy}\` can't be parsed as proxy`,
      code: 'INVALID_PROXY'
    })
  }
}
