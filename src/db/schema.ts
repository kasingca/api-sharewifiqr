import { char, index, int, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'

export const accounts = mysqlTable('accounts', {
  id: char('id', { length: 36 }).primaryKey(),
  publicId: char('public_id', { length: 32 }).notNull().unique(),
  identityKey: char('identity_key', { length: 64 }).notNull(),
  issuer: varchar('issuer', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  email: varchar('email', { length: 320 }).notNull(),
  firstName: varchar('first_name', { length: 150 }).notNull(),
  lastName: varchar('last_name', { length: 150 }).notNull(),
  role: mysqlEnum('role', ['customer', 'admin']).notNull().default('customer'),
  status: mysqlEnum('status', ['active', 'paused']).notNull().default('active'),
  plan: mysqlEnum('plan', ['free', 'plus', 'business']).notNull().default('free'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, table => [uniqueIndex('accounts_identity_key_unique').on(table.identityKey)])

export const sessions = mysqlTable('sessions', {
  digest: char('digest', { length: 64 }).primaryKey(),
  accountId: char('account_id', { length: 36 }).notNull().references(() => accounts.id),
  csrfToken: char('csrf_token', { length: 43 }).notNull(),
  createdAt: int('created_at').notNull(),
  expiresAt: int('expires_at').notNull(),
  idleUntil: int('idle_until').notNull(),
}, table => [index('sessions_account_idx').on(table.accountId), index('sessions_expiry_idx').on(table.expiresAt)])

export const loginAttempts = mysqlTable('login_attempts', {
  digest: char('digest', { length: 64 }).primaryKey(),
  state: char('state', { length: 43 }).notNull(),
  nonce: char('nonce', { length: 43 }).notNull(),
  verifier: char('verifier', { length: 43 }).notNull(),
  expiresAt: int('expires_at').notNull(),
}, table => [index('login_attempts_expiry_idx').on(table.expiresAt)])

export const paymentProviders = ['stripe', 'paypal'] as const

export const paymentMethods = mysqlTable('payment_methods', {
  accountId: char('account_id', { length: 36 }).primaryKey().references(() => accounts.id),
  provider: mysqlEnum('provider', paymentProviders).notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
})
