import type { accounts } from './db/schema.ts'

export function portalDestination(
  account: Pick<typeof accounts.$inferSelect, 'role' | 'status'>,
  adminSignInEnabled: boolean,
) {
  if (account.status !== 'active') return
  if (account.role === 'customer') return '/customer'
  if (account.role === 'admin' && adminSignInEnabled) return '/admin'
}
