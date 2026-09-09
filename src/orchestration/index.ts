import { randomUUID } from "node:crypto";
import type { CollectedListingResult, CollectionPipelineDependencies, PipelineRuntime } from "./types.js";

const defaultRuntime: PipelineRuntime = {
  now: () => new Date().toISOString(),
  createEvaluationId: () => randomUUID(),
};

export async function* collectNormalizeAndEvaluate(
  dependencies: CollectionPipelineDependencies,
  runId: string,
  runtime: PipelineRuntime = defaultRuntime,
): AsyncIterable<CollectedListingResult> {
  for await (const raw of dependencies.source.collect(runId)) {
    const normalized = dependencies.normalizer.normalize(raw);
    dependencies.logger.info({
      runId,
      listingId: normalized.sourceListingId,
      stage: "normalization",
      event: "listing_normalized",
      status: normalized.parsingIssues.length === 0 ? "success" : "has_parsing_issues",
    });
    const evaluation = await dependencies.ruleEngine.evaluate({
      listing: normalized,
      config: dependencies.buyBox.config,
      rulesVersion: dependencies.buyBox.rulesVersion,
      evaluatedAt: runtime.now(),
      evaluationId: runtime.createEvaluationId(),
    });
    dependencies.logger.info({
      runId,
      listingId: normalized.sourceListingId,
      stage: "evaluation",
      event: "listing_evaluated",
      status: evaluation.finalStatus,
    });
    yield { raw, normalized, evaluation };
  }
}

export type * from "./types.js";
