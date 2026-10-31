import { ensureSchema, hasDatabase } from './db.js'
import { importJsonFile } from './store.js'

if (!hasDatabase()) {
  console.error('Задайте DATABASE_URL в server/.env')
  process.exit(1)
}

await ensureSchema()
const result = await importJsonFile({ force: process.argv.includes('--force') })
console.log(result)
if (result.skipped) process.exit(result.reason === 'not-empty' ? 0 : 1)
process.exit(0)
