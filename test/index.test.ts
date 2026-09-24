import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/index.js";

test("POC starts with a TypeScript test harness", () => {
  assert.equal(typeof main, "function");
});
