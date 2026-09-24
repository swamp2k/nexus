export async function hasPcWatchAccess(db: D1Database, userId: string, role?: string): Promise<boolean> {
  if (role === 'admin') return true;
  if (role === undefined) {
    const row = await db.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string }>();
    if (row?.role === 'admin') return true;
  }
  const grant = await db.prepare('SELECT user_id FROM pcwatch_access WHERE user_id = ?').bind(userId).first();
  return grant !== null;
}
