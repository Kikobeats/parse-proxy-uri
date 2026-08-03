'use strict'

const ProxyChain = require('proxy-chain')
const test = require('ava').default
const got = require('got')

const parseProxy = require('..')

const { ProxyURL } = parseProxy

const PROXY_USERNAME = 'bob'
const PROXY_PASSWORD = 'TopSecret'

const getProxyUrl = proxy => {
  const { address, port, family } = proxy.server.address()
  const hostname = family === 'IPv6' ? `[${address}]` : address
  return parseProxy(
    `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${hostname}:${port}`
  )
}

test('invalid', t => {
  t.is(parseProxy(), undefined)
  t.is(parseProxy(null), undefined)
  t.is(parseProxy(''), undefined)
})

test('valid HTTP proxy uri', t => {
  const str = 'http://username:password@foo:1337'
  const parsedProxy = parseProxy(str)

  t.is(parsedProxy.username, 'username')
  t.is(parsedProxy.password, 'password')
  t.is(parsedProxy.hostname, 'foo')
  t.is(parsedProxy.host, 'foo:1337')
  t.is(parsedProxy.protocol, 'http:')
  t.is(parsedProxy.port, '1337')
  t.is(parsedProxy.auth, 'username:password')
  t.is(parsedProxy.toString(), str)

  t.true(parsedProxy instanceof URL)
  t.true(parsedProxy instanceof ProxyURL)
})

test('valid HTTPS proxy uri', t => {
  const str = 'https://username:password@foo:1337'
  const parsedProxy = parseProxy(str)

  t.is(parsedProxy.username, 'username')
  t.is(parsedProxy.password, 'password')
  t.is(parsedProxy.hostname, 'foo')
  t.is(parsedProxy.host, 'foo:1337')
  t.is(parsedProxy.protocol, 'https:')
  t.is(parsedProxy.port, '1337')
  t.is(parsedProxy.auth, 'username:password')
  t.is(parsedProxy.toString(), str)

  t.true(parsedProxy instanceof URL)
  t.true(parsedProxy instanceof ProxyURL)
})

test('valid socks5 proxy uri', t => {
  const str = 'socks5://username:password@foo:1337'
  const parsedProxy = parseProxy(str)

  t.is(parsedProxy.username, 'username')
  t.is(parsedProxy.password, 'password')
  t.is(parsedProxy.hostname, 'foo')
  t.is(parsedProxy.host, 'foo:1337')
  t.is(parsedProxy.protocol, 'socks5:')
  t.is(parsedProxy.port, '1337')
  t.is(parsedProxy.auth, 'username:password')
  t.is(parsedProxy.toString(), str)

  t.true(parsedProxy instanceof URL)
  t.true(parsedProxy instanceof ProxyURL)
})

test('decode HTML chars', t => {
  const str = 'socks5://foo=bar&hello=world:p@ssw=1+$$@foo:1337'
  const parsedProxy = parseProxy(str)

  t.is(parsedProxy.username, 'foo=bar&hello=world')
  t.is(parsedProxy.password, 'p@ssw=1+$$')
  t.is(parsedProxy.hostname, 'foo')
  t.is(parsedProxy.host, 'foo:1337')
  t.is(parsedProxy.protocol, 'socks5:')
  t.is(parsedProxy.port, '1337')
  t.is(parsedProxy.auth, 'foo=bar&hello=world:p@ssw=1+$$')
  t.is(
    parsedProxy.toString(),
    'socks5://foo%3Dbar&hello%3Dworld:p%40ssw%3D1+$$@foo:1337'
  )

  t.true(parsedProxy instanceof URL)
  t.true(parsedProxy instanceof ProxyURL)
})

test('toString percent-encodes reserved characters in credentials', t => {
  const parsedProxy = parseProxy(
    'http://user%3Aname:pass%40word%2Fpath@proxy.example:8080'
  )

  t.is(parsedProxy.username, 'user:name')
  t.is(parsedProxy.password, 'pass@word/path')
  t.is(
    parsedProxy.toString(),
    'http://user%3Aname:pass%40word%2Fpath@proxy.example:8080'
  )

  const roundTrip = parseProxy(parsedProxy.toString())
  t.is(roundTrip.username, 'user:name')
  t.is(roundTrip.password, 'pass@word/path')
})

test('toString omits empty credentials', t => {
  const parsedProxy = parseProxy('http://proxy.example:8080')
  t.is(parsedProxy.toString(), 'http://proxy.example:8080')
})

test('toString omits colon when only username is present', t => {
  const parsedProxy = parseProxy('http://user@proxy.example:8080')
  t.is(parsedProxy.toString(), 'http://user@proxy.example:8080')
})

test('toString keeps password when only password is present', t => {
  const parsedProxy = parseProxy('http://:pass@proxy.example:8080')
  t.is(parsedProxy.toString(), 'http://:pass@proxy.example:8080')
})

test('prevent reparsing a proxy object', t => {
  const str = 'https://username:password@foo:1337'
  const proxyOne = parseProxy(str)
  const proxyTwo = parseProxy(proxyOne)
  t.deepEqual(proxyOne, proxyTwo)
})

test('throw a qualified error', t => {
  const error = t.throws(() => parseProxy('foo'))
  t.is(error.message, "INVALID_PROXY, The value `foo` can't be parsed as proxy")
  t.is(error.code, 'INVALID_PROXY')
})

test('reject non-canonical IPv4 hosts that WHATWG would rewrite', t => {
  // Special-scheme IPv4 parser turns these into different addresses (often
  // loopback/private). A proxy parser must not silently retarget traffic.
  for (const input of [
    'http://2130706433:8080',
    'https://0x7f000001:8080',
    'http://127.1:8080',
    'http://00127.0.0.1:8080',
    'http://user:pass@0300.0250.0001.0001:8080'
  ]) {
    const error = t.throws(() => parseProxy(input), { instanceOf: Error })
    t.is(error.code, 'INVALID_PROXY')
  }
})

test('accept canonical dotted-decimal IPv4 hosts', t => {
  const parsedProxy = parseProxy('http://127.0.0.1:8080')
  t.is(parsedProxy.hostname, '127.0.0.1')
  t.is(parsedProxy.toString(), 'http://127.0.0.1:8080')
})

test('reject path/query/hash that swallow credentials or host', t => {
  for (const input of [
    'http://us/er:pass@proxy.example:8080',
    'http://us?er:pass@proxy.example:8080',
    'http://us#er:pass@proxy.example:8080',
    'http://user:p@ss/word@proxy.example:8080',
    'http://proxy.example:8080/extra',
    'http://proxy.example:8080?x=1',
    'http://proxy.example:8080#frag',
    'socks5://proxy.example:1080/extra'
  ]) {
    const error = t.throws(() => parseProxy(input), { instanceOf: Error })
    t.is(error.code, 'INVALID_PROXY')
  }
})

test('got integration', async t => {
  let count = 0

  const proxy = new ProxyChain.Server({
    host: '127.0.0.1',
    port: 0,
    prepareRequestFunction: ({ username, password }) => {
      ++count
      return {
        requestAuthentication:
          username !== PROXY_USERNAME || password !== PROXY_PASSWORD
      }
    }
  })

  await proxy.listen()
  t.teardown(() => proxy.close())

  const proxyUrl = await getProxyUrl(proxy)

  const { gotScraping } = await import('got-scraping')

  await got('http://example.com', {
    agent: await gotScraping.getAgents(proxyUrl.toString(), false)
  })

  t.is(count, 1)
})
