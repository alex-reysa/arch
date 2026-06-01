import { normalizeJobCount } from "./run-modes.js";

export interface RunWithConcurrencyOptions<T, R> {
  readonly jobs?: number | undefined;
  /** Items with the same lock key will not run concurrently. */
  readonly lockKey?: (item: T, index: number) => string | undefined;
  readonly run: (item: T, index: number) => Promise<R>;
}

/**
 * Small deterministic worker pool. It preserves the input order of returned
 * results even when work completes out of order, and it can serialize items
 * that share an external resource such as a live-provider account or DB URL.
 */
export function runWithConcurrency<T, R>(
  items: readonly T[],
  opts: RunWithConcurrencyOptions<T, R>,
): Promise<R[]> {
  const jobs = normalizeJobCount(opts.jobs);
  if (items.length === 0) return Promise.resolve([]);

  const pending = items.map((_, i) => i);
  const results = new Array<R>(items.length);
  const activeKeys = new Set<string>();
  let running = 0;
  let completed = 0;
  let rejected = false;

  return new Promise<R[]>((resolve, reject) => {
    const schedule = () => {
      if (rejected) return;
      while (running < jobs && pending.length > 0) {
        const pendingOffset = pending.findIndex((idx) => {
          const key = opts.lockKey?.(items[idx]!, idx);
          return key === undefined || !activeKeys.has(key);
        });
        if (pendingOffset === -1) break;

        const index = pending.splice(pendingOffset, 1)[0]!;
        const item = items[index]!;
        const key = opts.lockKey?.(item, index);
        if (key !== undefined) activeKeys.add(key);
        running++;

        opts
          .run(item, index)
          .then((result) => {
            results[index] = result;
            completed++;
          })
          .catch((err) => {
            rejected = true;
            reject(err);
          })
          .finally(() => {
            running--;
            if (key !== undefined) activeKeys.delete(key);
            if (rejected) return;
            if (completed === items.length) resolve(results);
            else schedule();
          });
      }
    };

    schedule();
  });
}
