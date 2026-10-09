import assert from "node:assert/strict";
import test from "node:test";
import { formatAmount } from "./format";

test("formats whole cents as dollars with two decimals", () => {
  assert.equal(formatAmount(123456789), "1,234,567.89 USDC");
  assert.equal(formatAmount(1000), "10.00 USDC");
  assert.equal(formatAmount(5), "0.05 USDC");
  assert.equal(formatAmount(0), "0.00 USDC");
  assert.equal(formatAmount(1.5), "Price unavailable");
  assert.equal(formatAmount(null), "Price unavailable");
});
