import { supervise } from "../src/supervisor";

describe("supervise", () => {
  const mutation = { id: "mutation-1", description: "change" };

  it("accepts a mutation when verification passes", async () => {
    const decision = await supervise(mutation, async () => ({ status: "PASS" }));

    expect(decision).toEqual({ type: "ACCEPT", mutation });
  });

  it("rejects a mutation and returns feedback when verification fails", async () => {
    const decision = await supervise(mutation, async () => ({
      status: "FAIL",
      feedback: "tests failed",
    }));

    expect(decision).toEqual({
      type: "REJECT",
      mutation,
      feedback: "tests failed",
    });
  });
});
