import "server-only";

// TEMPORARY render profiler — remove once the 1.5s navigation gap is found.
// Logs to stdout, which Vercel captures as runtime logs. Zero behaviour change.
export function perfMark(surface: string) {
  const t0 = performance.now();
  let last = t0;
  return {
    step(label: string) {
      const now = performance.now();
      console.log(
        `[perf] ${surface} | ${label} | +${Math.round(now - last)}ms | total ${Math.round(now - t0)}ms`,
      );
      last = now;
    },
    done() {
      console.log(`[perf] ${surface} | DONE | total ${Math.round(performance.now() - t0)}ms`);
    },
  };
}
