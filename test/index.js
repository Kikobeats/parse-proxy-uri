'use strict'

const test = require('ava')

const parseProxy = require('..')

test('invalid', t => {
  t.is(parseProxy(), undefined)
  t.is(parseProxy(null), undefined)
  t.is(parseProxy(''), undefined)
})

test('valid', t => {
  const str = 'http://username:password@foo:1337'
  const parsedProxy = parseProxy(str)

  t.is(parsedProxy.username, 'username')
  t.is(parsedProxy.password, 'password')
  t.is(parsedProxy.hostname, 'foo')
  t.is(parsedProxy.protocol, 'http:')
  t.is(parsedProxy.port, '1337')
  t.is(parsedProxy.auth, 'username:password')
  t.is(parsedProxy.toString(), str)
})

test('throw a qualified error', t => {
  const error = t.throws(() => {
    parseProxy('foo')
  })

  t.is(error.message, "INVALID_PROXY, The value `foo` can't be parsed as proxy")
  t.is(error.code, 'INVALID_PROXY')
})
