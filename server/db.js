import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') })

function connectionString() {
  return process.env.DATABASE_URL?.trim() || ''
}

export function hasDatabase() {
  return Boolean(connectionString())
}

let _sql = null

export function useSql() {
  const url = connectionString()
  if (!url) {
    throw new Error(
      'Задайте DATABASE_URL (Supabase → Database → Connect → Session pooler, порт 5432).',
    )
  }
  if (_sql) return _sql
  const isLocal = /localhost|127\.0\.0\.1/.test(url) && !url.includes('supabase')
  _sql = postgres(url, {
    prepare: false,
    ssl: isLocal ? false : 'require',
    max: 4,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 25,
    onnotice: () => {},
  })
  return _sql
}

export async function ensureSchema() {
  const sql = useSql()
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql')
  await sql.unsafe(fs.readFileSync(file, 'utf8'))
}

export async function pingDb() {
  if (!hasDatabase()) return { database: 'file' }
  await useSql()`select 1 as ok`
  return { database: 'up' }
}
