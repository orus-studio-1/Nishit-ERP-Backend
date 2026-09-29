/**
 * Acquires a row-level exclusive lock (SELECT ... FOR UPDATE) on a specific
 * row inside a Prisma interactive transaction.
 *
 * This prevents concurrent transactions from reading and mutating the same
 * financial document simultaneously (e.g. double-posting a journal entry).
 *
 * NOTE: Requires PostgreSQL.
 */
export async function withRowLock(tx: any, table: string, id: string): Promise<void> {
  await tx.$queryRawUnsafe(
    `SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`,
    id,
  );
}
