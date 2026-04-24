import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
};

const isSupabase = process.env.DB_PROVIDER === 'supabase';

// Supabase pooler (PgBouncer, transaction mode) works best with fewer connections.
// Direct connections (DB_PROVIDER=postgres) can use a larger pool.
const pool =
  globalForPrisma.pool ||
  new Pool({
    connectionString: isSupabase
      ? (process.env.DATABASE_URL_SUPABASE ?? process.env.DATABASE_URL)
      : process.env.DATABASE_URL,
    max: Math.max(1, parseInt(process.env.DB_POOL_MAX, 10) || (isSupabase ? 10 : 30)),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 300000,
  });

// pgBouncer:true disables prepared statements, required for Supabase's transaction-mode pooler.
const adapter = new PrismaPg(pool, isSupabase ? { pgBouncer: true } : undefined);

export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pool = pool;
}
