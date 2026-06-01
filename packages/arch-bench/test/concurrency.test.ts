import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "../src/runner/concurrency.js";

describe("runWithConcurrency", () => {
  it("caps global concurrency and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;
    const completionOrder: number[] = [];

    const out = await runWithConcurrency([1, 2, 3, 4], {
      jobs: 2,
      run: async (n) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 30 - n));
        completionOrder.push(n);
        active--;
        return n * 10;
      },
    });

    expect(maxActive).toBe(2);
    expect(completionOrder).not.toEqual([1, 2, 3, 4]);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("serializes items that share a lock key while allowing different keys", async () => {
    const byKey = new Map<string, number>();
    let sameKeyMax = 0;
    let globalMax = 0;
    let globalActive = 0;

    await runWithConcurrency(
      [
        { key: "grok", value: 1 },
        { key: "composer", value: 2 },
        { key: "grok", value: 3 },
      ],
      {
        jobs: 3,
        lockKey: (item) => item.key,
        run: async (item) => {
          globalActive++;
          globalMax = Math.max(globalMax, globalActive);
          const activeForKey = (byKey.get(item.key) ?? 0) + 1;
          byKey.set(item.key, activeForKey);
          sameKeyMax = Math.max(sameKeyMax, activeForKey);
          await new Promise((resolve) => setTimeout(resolve, 20));
          byKey.set(item.key, (byKey.get(item.key) ?? 1) - 1);
          globalActive--;
          return item.value;
        },
      },
    );

    expect(globalMax).toBe(2);
    expect(sameKeyMax).toBe(1);
  });

  it("rejects invalid job counts", async () => {
    expect(() =>
      runWithConcurrency([1], {
        jobs: 0,
        run: async (n) => n,
      }),
    ).toThrow(/positive integer/);
  });
});
