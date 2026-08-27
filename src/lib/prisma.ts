import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import { applyTenantToPrismaArgs } from '../utils/tenant';

dotenv.config();

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function isDelegate(value: any) {
  return value && typeof value === 'object' && ['findMany', 'findFirst', 'create', 'update'].some((method) => typeof value[method] === 'function');
}

function withTenantProxy<T extends object>(client: T): T {
  const delegateCache = new Map<PropertyKey, any>();
  return new Proxy(client as any, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === '$transaction' && typeof value === 'function') {
        return (input: any, ...rest: any[]) => {
          if (typeof input === 'function') {
            return value.call(target, (tx: any) => input(withTenantProxy(tx)), ...rest);
          }
          return value.call(target, input, ...rest);
        };
      }
      if (typeof value === 'function') return value.bind(target);
      if (!isDelegate(value)) return value;
      if (delegateCache.has(prop)) return delegateCache.get(prop);
      const delegate = new Proxy(value, {
        get(delegateTarget, operation) {
          const delegateValue = Reflect.get(delegateTarget, operation);
          if (typeof delegateValue !== 'function') return delegateValue;
          return (args?: any, ...rest: any[]) => {
            const nextArgs = applyTenantToPrismaArgs(String(prop), String(operation), args || {});
            return delegateValue.call(delegateTarget, nextArgs, ...rest);
          };
        },
      });
      delegateCache.set(prop, delegate);
      return delegate;
    },
  }) as T;
}

function createPrismaClient() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX || 5),
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: false,
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    transactionOptions: {
      maxWait: 30000,
      timeout: 90000,
    },
  });
  return withTenantProxy(client);
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
