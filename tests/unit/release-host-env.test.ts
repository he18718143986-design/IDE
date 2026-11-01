
import { describe, expect, it } from "vitest";
import { hostEnvAllowlist } from "../../daemon/release/step-runner";

describe("TASK-L.15 hostEnvAllowlist", () => {
  it("不把任意 process.env 键带进结果，只保留白名单 + extra", () => {
    const marker = `STAGENT_TEST_SECRET_${Date.now()}`;
    process.env[marker] = "should-not-leak";
    try {
      const env = hostEnvAllowlist({ FOO: "bar" });
      expect(env.FOO).toBe("bar");
      expect(env[marker]).toBeUndefined();
      // PATH 通常存在
      if (typeof process.env.PATH === "string") {
        expect(env.PATH).toBe(process.env.PATH);
      }
    } finally {
      delete process.env[marker];
    }
  });
});
