import { createClient, RedisClientType } from 'redis';

type Entry = { value: string; expiresAt: number };
const memory = new Map<string, Entry>();
const memoryLimit = Math.max(100, Number(process.env.CACHE_MEMORY_MAX_ITEMS || 2000));
let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;
let memoryEpoch = 1;

async function redis(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL || process.env.CACHE_ENABLED === 'false') return null;
  if (client?.isReady) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      const next = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1500), reconnectStrategy: retries => retries > 3 ? false : Math.min(retries * 100, 500) } });
      next.on('error', error => console.error('Redis cache:', error.message));
      await next.connect(); client = next as RedisClientType; return client;
    } catch (error: any) { console.error('Redis unavailable; using bounded memory cache:', error.message); return null; }
    finally { connecting = null; }
  })();
  return connecting;
}

export async function cacheEpoch(): Promise<string> { const r = await redis(); if (!r) return String(memoryEpoch); return String((await r.get('nishit:api:epoch')) || '1'); }
export async function cacheGet(key: string): Promise<string | null> { const r = await redis(); if (r) return await r.get(key) as string | null; const row = memory.get(key); if (!row || row.expiresAt <= Date.now()) { memory.delete(key); return null; } return row.value; }
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const r = await redis(); if (r) { await r.set(key, value, { EX: ttlSeconds }); return; }
  if (memory.size >= memoryLimit) memory.delete(memory.keys().next().value as string);
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}
export async function invalidateApiCache() { const r = await redis(); if (r) await r.incr('nishit:api:epoch'); else { memoryEpoch++; memory.clear(); } }
export function cacheBackend() { return client?.isReady ? 'redis' : process.env.REDIS_URL ? 'connecting/fallback' : 'memory'; }
