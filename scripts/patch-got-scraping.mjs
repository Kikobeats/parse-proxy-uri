'use strict'

import * as fs from 'fs/promises'

const LAST_LINE = 'gotScraping.getAgents = getAgents;'

const modulePath = new URL(await import.meta.resolve('got-scraping')).pathname
const fileContent = await fs.readFile(modulePath, 'utf8')
const lastLine = fileContent.trim().split('\n').pop()

if (lastLine !== LAST_LINE) {
  await fs.appendFile(modulePath, `\n${LAST_LINE}`)
}
