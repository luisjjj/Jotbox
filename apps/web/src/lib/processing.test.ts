import { describe, expect, it } from "vitest";
import { ProcessingTimeout, withProcessingTimeout } from "./processing";

describe("withProcessingTimeout", () => {
  it("returns a result that beats the deadline", async () => {
    await expect(withProcessingTimeout(Promise.resolve("notes"), 50)).resolves.toBe("notes");
  });

  it("rejects with a retryable message when the pipeline never settles", async () => {
    await expect(withProcessingTimeout(new Promise<string>(() => {}), 10)).rejects.toBeInstanceOf(
      ProcessingTimeout,
    );
  });

  it("ignores a late result after the deadline", async () => {
    let finish: (value: string) => void = () => {};
    const slow = new Promise<string>((resolve) => {
      finish = resolve;
    });
    await expect(withProcessingTimeout(slow, 10)).rejects.toBeInstanceOf(ProcessingTimeout);
    finish("late notes");
    await Promise.resolve();
  });
});
