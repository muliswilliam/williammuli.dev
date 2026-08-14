type Bucket = { count: number; resetAt: number };

const IP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const IP_MAX = 8; // max requests per IP per window

const GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const GLOBAL_MAX = 300; // backstop across all visitors, in case of a distributed bot swarm

const ipBuckets = new Map<string, Bucket>();
let globalBucket: Bucket = { count: 0, resetAt: Date.now() + GLOBAL_WINDOW_MS };
let checksSinceSweep = 0;

function sweepExpired(now: number) {
  for (const [ip, bucket] of ipBuckets) {
    if (now > bucket.resetAt) ipBuckets.delete(ip);
  }
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();

  checksSinceSweep += 1;
  if (checksSinceSweep >= 200) {
    checksSinceSweep = 0;
    sweepExpired(now);
  }

  if (now > globalBucket.resetAt) {
    globalBucket = { count: 0, resetAt: now + GLOBAL_WINDOW_MS };
  }
  if (globalBucket.count >= GLOBAL_MAX) {
    return { allowed: false, retryAfterSeconds: Math.ceil((globalBucket.resetAt - now) / 1000) };
  }

  let bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + IP_WINDOW_MS };
    ipBuckets.set(ip, bucket);
  }
  if (bucket.count >= IP_MAX) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  globalBucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
