# parse-proxy-uri

![Last version](https://img.shields.io/github/tag/Kikobeats/parse-proxy-uri.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/parse-proxy-uri.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/parse-proxy-uri)
[![NPM Status](https://img.shields.io/npm/dm/parse-proxy-uri.svg?style=flat-square)](https://www.npmjs.org/package/parse-proxy-uri)

> Lightweight module for parsing a proxy URI.

## Install

```bash
$ npm install parse-proxy-uri --save
```

## Usage

```js
const parseProxy = require('parse-proxy-uri')

const proxy = parseProxy('http://alice:TopSecret@proxy.example:8080')

proxy.auth // => 'alice:TopSecret'
proxy.host // => 'proxy.example:8080'
proxy.protocol // => 'http:'
proxy.toString() // => 'http://alice:TopSecret@proxy.example:8080'
```

The returned value is a `URL` subclass, so `username` and `password` keep their
WHATWG percent-encoded form and `auth` gives you the decoded pair.

An invalid input throws a `ParseProxyError` (a `TypeError`) with
`code: 'INVALID_PROXY'`.

### Mutation

Every setter re-validates, so a parsed proxy can never become something that
`parseProxy` would have rejected. A rejected assignment throws and leaves the
proxy untouched.

`username` and `password` take raw values and encode them for you:

```js
const parseProxy = require('parse-proxy-uri')

const proxy = parseProxy('http://proxy.example:8080')

proxy.password = 'p@ss/word'
proxy.password // => 'p%40ss%2Fword'
proxy.auth // => ':p@ss/word'
```

`href` takes a whole proxy URI, held to the same rules as `parseProxy` itself.

**parse-proxy-uri** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/parse-proxy-uri/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Kiko Beats](https://kikobeats.com) with help from [contributors](https://github.com/Kikobeats/parse-proxy-uri/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/Kikobeats) · X [@Kikobeats](https://x.com/Kikobeats)
