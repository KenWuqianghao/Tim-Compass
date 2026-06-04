import assert from "node:assert/strict";
import { test } from "node:test";
import { isArrived } from "../lib/arrival.ts";

test("arrival does not trigger at 70 meters", () => {
  assert.equal(isArrived(70, 10), false);
});

test("arrival triggers close to the target with reasonable GPS accuracy", () => {
  assert.equal(isArrived(20, 25), true);
});

test("arrival waits when GPS accuracy is too poor", () => {
  assert.equal(isArrived(20, 80), false);
});
