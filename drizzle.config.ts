import { defineConfig } from 'drizzle-kit'

const url = process.env.TIDB_MIGRATION_URL ? new URL(process.env.TIDB_MIGRATION_URL) : undefined

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: url ? {
    host: url.hostname,
    port: Number(url.port || 4000),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl: { rejectUnauthorized: true },
  } : undefined,
})
