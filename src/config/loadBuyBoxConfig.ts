import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { ZodError } from "zod";
import { buyBoxConfigSchema, type BuyBoxConfig } from "./buyBoxSchema.js";

export interface LoadedBuyBoxConfig {
  config: BuyBoxConfig;
  rulesVersion: string;
  sourcePath: string;
}

export class BuyBoxConfigurationError extends Error {
  public readonly issues: readonly string[];

  public constructor(message: string, issues: readonly string[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = "BuyBoxConfigurationError";
    this.issues = issues;
  }
}

export async function loadBuyBoxConfig(path = process.env.BUYBOX_CONFIG_PATH ?? "config/buybox.yaml"): Promise<LoadedBuyBoxConfig> {
  const sourcePath = resolve(path);
  let source: string;

  try {
    source = await readFile(sourcePath, "utf8");
  } catch (error) {
    throw new BuyBoxConfigurationError(`Unable to read buy-box configuration at ${sourcePath}.`, [], { cause: error });
  }

  try {
    const config = buyBoxConfigSchema.parse(parse(source));
    const digest = createHash("sha256").update(source, "utf8").digest("hex");
    return {
      config,
      rulesVersion: `${String(config.version)}-${digest.slice(0, 12)}`,
      sourcePath,
    };
  } catch (error) {
    const issues = error instanceof ZodError
      ? error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      : [error instanceof Error ? error.message : "Unknown YAML parsing error"];
    throw new BuyBoxConfigurationError(`Invalid buy-box configuration at ${sourcePath}.`, issues, { cause: error });
  }
}
