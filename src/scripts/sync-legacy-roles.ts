/**
 * Brings the legacy User.role column in line with each user's Access Control roles, for users
 * whose access was set before the two were kept in sync (e.g. promoted to Admin but still
 * stored as EMPLOYEE, which made older checks answer "Insufficient permissions").
 *
 * Usage:
 *   npx tsx src/scripts/sync-legacy-roles.ts --dry-run   # list what would change
 *   npx tsx src/scripts/sync-legacy-roles.ts             # apply
 */
import prisma from '../lib/prisma';
import { legacyRoleForAccessRoles } from '../utils/accessControl';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, accessRoles: { select: { role: { select: { name: true, title: true, isSuperAdmin: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  const changes = users
    .filter((u) => u.accessRoles.length > 0)
    .map((u) => ({ u, next: legacyRoleForAccessRoles(u.accessRoles.map((r) => r.role)) }))
    .filter(({ u, next }) => u.role !== next);

  console.log(`${changes.length} user(s) to update${dryRun ? ' (dry run, nothing written)' : ''}`);
  for (const { u, next } of changes) {
    const masked = u.email.replace(/^(.{2}).*(@.*)$/, '$1***$2');
    console.log(`  ${masked}: ${u.role} -> ${next}  (access roles: ${u.accessRoles.map((r) => r.role.title || r.role.name).join(', ')})`);
    if (!dryRun) await prisma.user.update({ where: { id: u.id }, data: { role: next } });
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
