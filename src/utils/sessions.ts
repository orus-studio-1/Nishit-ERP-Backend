import prisma from '../lib/prisma';
import { invalidateApiCache } from '../services/platform/cache.service';

/** Reasons that mean "an administrator signed this user out", as opposed to normal token rotation. */
export const ADMIN_REVOKE_REASONS = ['ACCESS_CHANGED', 'PASSWORD_RESET', 'DEACTIVATED'] as const;
export type AdminRevokeReason = typeof ADMIN_REVOKE_REASONS[number];

/**
 * Signs a user out of every device: bumps tokenVersion (so current access tokens stop working)
 * and revokes every refresh session (so the browser cannot silently get a new access token).
 * Pass the transaction client when called inside one; call `afterSessionsRevoked()` once the
 * transaction has committed so cached sessions are dropped immediately.
 */
export async function revokeAllUserSessions(userId: string, reason: AdminRevokeReason | 'LOGOUT_ALL' | 'PASSWORD_CHANGED', client: any = prisma) {
  await client.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  await client.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
}

/** The auth middleware caches each session for 30s; drop that cache so the sign-out applies on the next request. */
export async function afterSessionsRevoked() {
  await invalidateApiCache();
}
