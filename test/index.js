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

const assertInvalidProxies = (t, inputs) => {
  for (const input of inputs) {
    const error = t.throws(() => parseProxy(input), { instanceOf: Error })
    t.is(error.code, 'INVALID_PROXY')
  }
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

  // username/password stay WHATWG-encoded; auth exposes the decoded form.
  t.is(parsedProxy.username, 'foo%3Dbar&hello%3Dworld')
  t.is(parsedProxy.password, 'p%40ssw%3D1+$$')
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

  t.is(parsedProxy.username, 'user%3Aname')
  t.is(parsedProxy.password, 'pass%40word%2Fpath')
  t.is(parsedProxy.auth, 'user:name:pass@word/path')
  t.is(
    parsedProxy.toString(),
    'http://user%3Aname:pass%40word%2Fpath@proxy.example:8080'
  )

  const roundTrip = parseProxy(parsedProxy.toString())
  t.is(roundTrip.username, 'user%3Aname')
  t.is(roundTrip.password, 'pass%40word%2Fpath')
  t.is(roundTrip.auth, 'user:name:pass@word/path')
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

test('auth is empty when credentials are omitted', t => {
  const parsedProxy = parseProxy('http://proxy.example:8080')
  t.is(parsedProxy.auth, '')
  t.is(parsedProxy.username, '')
  t.is(parsedProxy.password, '')
})

test('reject malformed percent-escapes in credentials', t => {
  assertInvalidProxies(t, [
    'http://user%zz@proxy.example:8080',
    'http://user:%zz@proxy.example:8080',
    'http://a%GG:b@proxy.example:8080'
  ])
})

test('reject control characters in credentials', t => {
  assertInvalidProxies(t, [
    'http://user%0d%0aInjected:%20yes@proxy.example:8080',
    'http://user:%0apass@proxy.example:8080',
    'http://user%00:pass@proxy.example:8080'
  ])
})

test('username/password match WHATWG encoding for URL consumers', t => {
  // got-scraping and similar call decodeURIComponent(url.username). Returning
  // already-decoded values double-decodes (`%253A` → `%3A` → `:`) or throws
  // URIError on passwords like `100%pure`.
  const parsedProxy = parseProxy(
    'http://user%253Aname:100%25pure@proxy.example:8080'
  )

  t.is(parsedProxy.username, 'user%253Aname')
  t.is(parsedProxy.password, '100%25pure')
  t.is(parsedProxy.auth, 'user%3Aname:100%pure')

  t.is(decodeURIComponent(parsedProxy.username), 'user%3Aname')
  t.is(decodeURIComponent(parsedProxy.password), '100%pure')
})

test('credentials stay in sync when href or host is mutated', t => {
  const parsedProxy = parseProxy('http://alice:TopSecret@trusted.proxy:8443')

  parsedProxy.hostname = 'other.proxy'
  t.is(parsedProxy.username, 'alice')
  t.is(parsedProxy.password, 'TopSecret')
  t.is(parsedProxy.toString(), 'http://alice:TopSecret@other.proxy:8443')

  parsedProxy.href = 'http://bob:OtherSecret@third.proxy:9443'
  t.is(parsedProxy.username, 'bob')
  t.is(parsedProxy.password, 'OtherSecret')
  t.is(parsedProxy.auth, 'bob:OtherSecret')
  t.is(parsedProxy.toString(), 'http://bob:OtherSecret@third.proxy:9443')
  t.is(parsedProxy.href, 'http://bob:OtherSecret@third.proxy:9443/')

  parsedProxy.href = 'http://noproxy.example:8080'
  t.is(parsedProxy.username, '')
  t.is(parsedProxy.password, '')
  t.is(parsedProxy.auth, '')
  t.is(parsedProxy.toString(), 'http://noproxy.example:8080')
})

test('plain objects with __parsed__ do not bypass validation', t => {
  const spoofed = {
    __parsed__: true,
    hostname: 'evil.proxy',
    auth: 'leaked:creds',
    toString: () => 'not-a-proxy'
  }

  const error = t.throws(() => parseProxy(spoofed), { instanceOf: Error })
  t.is(error.code, 'INVALID_PROXY')

  // A lying toString() must not return the attacker object with spoofed fields.
  const lying = {
    __parsed__: true,
    hostname: 'looks-safe.example',
    toString: () => 'http://evil.proxy:8080'
  }
  const parsed = parseProxy(lying)
  t.true(parsed instanceof ProxyURL)
  t.not(parsed, lying)
  t.is(parsed.hostname, 'evil.proxy')
})

test('reject schemeless host:port that WHATWG treats as a custom scheme', t => {
  assertInvalidProxies(t, [
    'proxy.example:8080',
    'myproxy:3128',
    'localhost:8080'
  ])
})

test('reject http:port integer-IPv4 misparse', t => {
  assertInvalidProxies(t, ['http:8080'])
})

test('reject proxy URIs with an empty host', t => {
  assertInvalidProxies(t, ['socks5://', 'http://', 'https://'])
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
  assertInvalidProxies(t, [
    'http://2130706433:8080',
    'https://0x7f000001:8080',
    'http://127.1:8080',
    'http://00127.0.0.1:8080',
    'http://user:pass@0300.0250.0001.0001:8080'
  ])
})

test('accept canonical dotted-decimal IPv4 hosts', t => {
  const parsedProxy = parseProxy('http://127.0.0.1:8080')
  t.is(parsedProxy.hostname, '127.0.0.1')
  t.is(parsedProxy.toString(), 'http://127.0.0.1:8080')
})

test('accept percent-encoded dots in canonical IPv4 hosts', t => {
  const parsedProxy = parseProxy('http://127%2E0%2E0%2E1:8080')
  t.is(parsedProxy.hostname, '127.0.0.1')
  t.is(parsedProxy.toString(), 'http://127.0.0.1:8080')
})

test('accept String object proxy URIs', t => {
  const parsedProxy = parseProxy(Object('http://proxy.example:8080'))
  t.is(parsedProxy.hostname, 'proxy.example')
  t.is(parsedProxy.toString(), 'http://proxy.example:8080')
})

test('reject path/query/hash that swallow credentials or host', t => {
  assertInvalidProxies(t, [
    'http://us/er:pass@proxy.example:8080',
    'http://us?er:pass@proxy.example:8080',
    'http://us#er:pass@proxy.example:8080',
    'http://user:p@ss/word@proxy.example:8080',
    'http://proxy.example:8080/extra',
    'http://proxy.example:8080?x=1',
    'http://proxy.example:8080#frag',
    'socks5://proxy.example:1080/extra'
  ])
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
