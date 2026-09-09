import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BuyBoxConfigurationError, loadBuyBoxConfig } from "../../src/config/index.js";

describe("loadBuyBoxConfig", () => {
  it("loads the repository configuration and gives its exact contents a stable version", async () => {
    const first = await loadBuyBoxConfig("config/buybox.yaml");
    const second = await loadBuyBoxConfig("config/buybox.yaml");

    expect(first.config.name).toBe("creative-listing-str-screening");
    expect(first.config.filters.financing.down_payment).toEqual({ operator: "less_than", amount: 40_000 });
    expect(first.config.filters.financing.monthly_payment.amount).toBe(3_600);
    expect(first.rulesVersion).toMatch(/^1\.2-[a-f0-9]{12}$/);
    expect(second.rulesVersion).toBe(first.rulesVersion);
  });

  it("rejects unknown keys instead of silently reinterpreting configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "buybox-test-"));
    const path = join(directory, "invalid.yaml");
    await writeFile(path, "version: 1\nname: test\nunexpected: true\n", "utf8");

    try {
      await loadBuyBoxConfig(path);
      expect.fail("Expected invalid configuration to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(BuyBoxConfigurationError);
      if (error instanceof BuyBoxConfigurationError) {
        expect(error.issues.some((issue) => issue.includes("Unrecognized"))).toBe(true);
      }
    }
  });

  it("fails clearly for malformed YAML", async () => {
    const directory = await mkdtemp(join(tmpdir(), "buybox-test-"));
    const path = join(directory, "malformed.yaml");
    await writeFile(path, "filters: [unterminated", "utf8");

    await expect(loadBuyBoxConfig(path)).rejects.toBeInstanceOf(BuyBoxConfigurationError);
  });
});
