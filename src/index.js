'use strict'

const whoops = require('whoops')

const ParseProxyError = whoops('ParseProxyError')

module.exports = proxy => {
  if (typeof proxy !== 'string' || !proxy) return undefined

  try {
    let { username, password, hostname, protocol, port } = new URL(proxy)
    const auth = `${username}:${password}`
    protocol = protocol.replace(':', '')
    const toString = () => `${protocol}://${auth}@${hostname}:${port}`
    return { username, password, hostname, protocol, port, auth, toString }
  } catch (err) {
    throw new ParseProxyError({
      message: `The value \`${proxy}\` can't be parsed as proxy`,
      code: 'INVALID_PROXY'
    })
  }
}
