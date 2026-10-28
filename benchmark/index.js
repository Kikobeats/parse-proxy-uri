'use strict'

const { writeFileSync } = require('fs')
const { join } = require('path')
const { setFlagsFromString } = require('v8')
const { runInNewContext } = require('vm')

const parseProxy = require('..')

const RUNS = 7
const ASCII_ROUNDS = 12000
const UNICODE_ROUNDS = 5000
const INVALID_ROUNDS = 3000
const MUTATION_ROUNDS = 15000

const ASCII_PROXIES = [
  'http://username:password@foo:1337',
  'https://username:password@foo:1337',
  'socks5://username:password@foo:1337',
  'socks5://foo%3Dbar&hello%3Dworld:p%40ssw%3D1+$$@foo:1337',
  'http://user%3Aname:pass%40word%2Fpath@proxy.example:8080',
  'http://proxy.example:8080',
  'http://alice:secret@127.0.0.1:3128',
  'http://alice:secret@[::1]:3128',
  'http://alice:secret@trusted.example:8080\r\n',
  'socks5://user:pass@proxy%FF.example:1080'
]

const UNICODE_PROXIES = [
  'http://alice:secret@münchen.example:8080',
  'socks5://alice:secret@straße.example:1080',
  'https://alice:secret@пример.испытание:8443',
  'http://alice:secret@例え.テスト:8080'
]

const INVALID_PROXIES = [
  'proxy.example:8080',
  'http://user%zz@proxy.example:8080',
  'http://user%0d%0aInjected:%20yes@proxy.example:8080',
  'http://alice:secret@trusted.example\n@evil.com:8080',
  'http://alice:secret@trusted﻿.evil.com:8080',
  'http://alice:secret@trusted%EF%BB%BF.evil.com:8080',
  'http://alice:secret@trusted.example:8080/path',
  'http://alice:secret@trusted.example:8080?query=1'
]

const TRUSTED = 'http://alice:TopSecret@trusted.proxy:8443'

const MUTATIONS = [
  ['hostname', 'other.proxy', 'other.proxy'],
  ['port', '9443', '9443'],
  ['host', 'third.proxy:7443', 'third.proxy:7443'],
  ['protocol', 'socks5', 'socks5:'],
  ['password', 'p@ss%word', 'p%40ss%25word']
]

const MUTATED = 'socks5://alice:p%40ss%25word@third.proxy:7443'

const TOTAL_WRITES = MUTATION_ROUNDS * MUTATIONS.length

const parseAll = (proxies, rounds) => {
  let parsed = 0
  for (let round = 0; round < rounds; round++) {
    for (const proxy of proxies) {
      if (parseProxy(proxy).hostname) parsed++
    }
  }
  return parsed
}

const asciiCase = {
  name: 'parse ascii proxies',
  extra: `${ASCII_ROUNDS} rounds over ${ASCII_PROXIES.length} uris`,
  timed: () => parseAll(ASCII_PROXIES, ASCII_ROUNDS),
  verify: parsed => parsed === ASCII_ROUNDS * ASCII_PROXIES.length
}

const unicodeCase = {
  name: 'parse unicode-host proxies',
  extra: `${UNICODE_ROUNDS} rounds over ${UNICODE_PROXIES.length} uris`,
  timed: () => parseAll(UNICODE_PROXIES, UNICODE_ROUNDS),
  verify: parsed => parsed === UNICODE_ROUNDS * UNICODE_PROXIES.length
}

const invalidCase = {
  name: 'reject invalid proxies',
  extra: `${INVALID_ROUNDS} rounds over ${INVALID_PROXIES.length} uris`,
  timed: () => {
    let rejected = 0
    for (let round = 0; round < INVALID_ROUNDS; round++) {
      for (const proxy of INVALID_PROXIES) {
        try {
          parseProxy(proxy)
        } catch (error) {
          if (error.code === 'INVALID_PROXY') rejected++
        }
      }
    }
    return rejected
  },
  verify: rejected => rejected === INVALID_ROUNDS * INVALID_PROXIES.length
}

const mutationCase = {
  name: 'mutate host, port and credentials',
  extra: `${MUTATION_ROUNDS} proxies x ${MUTATIONS.length} guarded writes`,
  timed: () => {
    let applied = 0
    let mutated = 0
    for (let round = 0; round < MUTATION_ROUNDS; round++) {
      const proxy = parseProxy(TRUSTED)
      for (const [key, value, expected] of MUTATIONS) {
        proxy[key] = value
        if (proxy[key] === expected) applied++
      }
      if (proxy.toString() === MUTATED) mutated++
    }
    return { applied, mutated }
  },
  verify: ({ applied, mutated }) =>
    applied === TOTAL_WRITES && mutated === MUTATION_ROUNDS
}

const CASES = [asciiCase, unicodeCase, invalidCase, mutationCase]

const median = values => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

setFlagsFromString('--expose-gc')
const collectGarbage = runInNewContext('gc')

const now = () => process.hrtime.bigint()

const elapsed = started => Number(now() - started) / 1e6

const fmt = value => value.toFixed(1)

const report = slot => {
  const med = slot.walls.length ? median(slot.walls) : Number.NaN
  const min = slot.walls.length ? Math.min(...slot.walls) : Number.NaN
  const max = slot.walls.length ? Math.max(...slot.walls) : Number.NaN
  const extra = `${slot.entry.extra}, errors ${slot.errors}, runs ${RUNS}`
  console.log(
    `${slot.entry.name}  median ${fmt(med)}ms  range ${fmt(min)}-${fmt(
      max
    )}  ${extra}`
  )
  return {
    name: slot.entry.name,
    unit: 'ms',
    value: Number(med.toFixed(1)),
    range: `${fmt(min)}-${fmt(max)}`,
    extra
  }
}

const takeSample = (slot, run) => {
  try {
    collectGarbage()
    const started = now()
    const outcome = slot.entry.timed()
    const wall = elapsed(started)
    if (!slot.entry.verify(outcome)) {
      console.error(`${slot.entry.name} run ${run} produced unexpected output`)
      slot.errors++
      return
    }
    slot.walls.push(wall)
  } catch (error) {
    console.error(error)
    slot.errors++
  }
}

const main = () => {
  const slots = CASES.map(entry => ({ entry, walls: [], errors: 0 }))
  for (const slot of slots) {
    try {
      slot.entry.timed()
    } catch (error) {
      console.error(error)
      slot.errors++
    }
  }
  for (let run = 0; run < RUNS; run++) {
    for (const slot of slots) takeSample(slot, run)
  }
  const results = slots.map(report)
  writeFileSync(
    join(__dirname, '..', 'benchmark-output.json'),
    JSON.stringify(results, null, 2) + '\n'
  )
  const errors = slots.reduce((total, slot) => total + slot.errors, 0)
  if (errors > 0 || results.some(result => !Number.isFinite(result.value))) {
    process.exitCode = 1
  }
}

main()
