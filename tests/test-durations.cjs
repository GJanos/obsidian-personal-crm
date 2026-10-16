/** Durations in words: fuzzy for gaps and lateness, exact for a cadence someone chose. */
const assert = require("assert");
const harness = require("./build.cjs");
const D = require(harness.bundleModule("src/dates.ts"));

let passed = 0, failed = 0;
const check = (n, f) => { try { f(); console.log(`  ✓ ${n}`); passed++; }
  catch (e) { console.error(`  ✗ ${n}\n     ${e.message}`); failed++; } };

console.log("A cadence reads as what was set");
check("45 days stays 45 days, not \"2mo\"", () => assert.strictEqual(D.formatCadence(45), "45d"));
check("whole weeks, months and years by their unit", () =>
  assert.deepStrictEqual([14, 21, 30, 60, 90, 180, 365, 730].map(D.formatCadence),
    ["2w", "3w", "1mo", "2mo", "3mo", "6mo", "1y", "2y"]));
check("anything else in days", () =>
  assert.deepStrictEqual([1, 10, 40, 100].map(D.formatCadence), ["1d", "10d", "40d", "100d"]));

console.log("\nA duration rounds, but not past half a unit");
check("45 days is about 6 weeks", () => assert.strictEqual(D.formatDuration(45), "6w"));
check("weeks run up to two months", () =>
  assert.deepStrictEqual([14, 29, 30, 59].map(D.formatDuration), ["2w", "4w", "4w", "8w"]));
check("then months, then years", () =>
  assert.deepStrictEqual([60, 90, 400, 800].map(D.formatDuration), ["2mo", "3mo", "13mo", "2.2y"]));
check("short ones in days", () =>
  assert.deepStrictEqual([0, 1, 13].map(D.formatDuration), ["0d", "1d", "13d"]));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
