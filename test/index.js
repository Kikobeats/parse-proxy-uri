'use strict'

const ProxyChain = require('proxy-chain')
const test = require('ava')
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
  t.is(parsedProxy.toString(), str)

  t.true(parsedProxy instanceof URL)
  t.true(parsedProxy instanceof ProxyURL)
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

  await got('https://example.com', {
    agent: await gotScraping.getAgents(proxyUrl.toString(), false)
  })

  t.is(count, 1)
})
