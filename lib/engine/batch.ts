export type BatchResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Order-preserving concurrent map with failure isolation: one bad item
 * yields an error entry, never a rejected batch.
 */
export async function runBatch<I, O>(
  items: readonly I[],
  fn: (item: I, index: number) => Promise<O>,
  opts: { concurrency: number }
): Promise<BatchResult<O>[]> {
  const results = new Array<BatchResult<O>>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(opts.concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = { ok: true, value: await fn(items[i], i) };
        } catch (err) {
          results[i] = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
    }
  );
  await Promise.all(workers);
  return results;
}
