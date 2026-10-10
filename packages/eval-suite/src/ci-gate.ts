import type { BenchmarkAggregateMetrics } from './metrics/scoring.js';
import type { SensitivityReport } from './mutations/sensitivity.js';

export interface CiGateThresholds {
  minDispositionAccuracy?: number;
  minRequirementAccuracy?: number;
  minGroundingPrecision?: number;
  minMissingEvidenceRecall?: number;
  minCounterfactualSensitivity?: number;
  maxCostPerCaseUsd?: number;
  maxCostPerSafeResolution?: number;
}

export interface CiGateResult {
  passed: boolean;
  failures: string[];
}

export class CiEvalGate {
  public static verifyGate(
    metrics: BenchmarkAggregateMetrics,
    sensitivity?: SensitivityReport,
    thresholds?: CiGateThresholds
  ): CiGateResult {
    const minAcc = thresholds?.minDispositionAccuracy ?? 0.95;
    const minReqAcc = thresholds?.minRequirementAccuracy ?? 0.90;
    const minGrounding = thresholds?.minGroundingPrecision ?? 0.95;
    const minRecall = thresholds?.minMissingEvidenceRecall ?? 0.85;
    const minSensitivity = thresholds?.minCounterfactualSensitivity ?? 0.90;
    const maxCost = thresholds?.maxCostPerCaseUsd ?? 0.05;

    const failures: string[] = [];

    // 1. Empty coverage failure
    if (metrics.totalCases === 0) {
      failures.push('Evaluation dataset is empty: totalCases must be greater than zero.');
    }

    // 2. Finite numeric metrics check
    const numericValues = [
      metrics.dispositionAccuracy,
      metrics.meanRequirementAccuracy,
      metrics.meanGroundingPrecision,
      metrics.missingEvidenceRecall,
      metrics.totalCostUsd,
      metrics.meanCostPerCase,
    ];
    if (numericValues.some(v => !Number.isFinite(v) || Number.isNaN(v))) {
      failures.push('Invalid evaluation metrics: one or more aggregate scores are non-finite or NaN.');
    }

    // 3. Zero-tolerance for ungrounded citations / hallucinations
    if (metrics.totalUnsupportedCitations > 0) {
      failures.push(
        `Grounding Safety Gate Failed: ${metrics.totalUnsupportedCitations} unsupported or hallucinated citations were generated.`
      );
    }

    // 4. Performance thresholds
    if (metrics.dispositionAccuracy < minAcc) {
      failures.push(
        `Disposition Accuracy ${(metrics.dispositionAccuracy * 100).toFixed(1)}% is below threshold ${(minAcc * 100).toFixed(1)}%`
      );
    }

    if (metrics.meanRequirementAccuracy < minReqAcc) {
      failures.push(
        `Requirement Accuracy ${(metrics.meanRequirementAccuracy * 100).toFixed(1)}% is below threshold ${(minReqAcc * 100).toFixed(1)}%`
      );
    }

    if (metrics.meanGroundingPrecision < minGrounding) {
      failures.push(
        `Grounding Precision ${(metrics.meanGroundingPrecision * 100).toFixed(1)}% is below threshold ${(minGrounding * 100).toFixed(1)}%`
      );
    }

    if (metrics.missingEvidenceRecall < minRecall) {
      failures.push(
        `Missing Evidence Recall ${(metrics.missingEvidenceRecall * 100).toFixed(1)}% is below threshold ${(minRecall * 100).toFixed(1)}%`
      );
    }

    if (sensitivity && sensitivity.counterfactualSensitivity < minSensitivity) {
      failures.push(
        `Counterfactual Sensitivity ${(sensitivity.counterfactualSensitivity * 100).toFixed(1)}% is below threshold ${(minSensitivity * 100).toFixed(1)}%`
      );
    }

    if (metrics.meanCostPerCase > maxCost) {
      failures.push(
        `Mean Cost Per Case $${metrics.meanCostPerCase.toFixed(4)} exceeds maximum threshold $${maxCost.toFixed(4)}`
      );
    }

    if (thresholds?.maxCostPerSafeResolution != null && metrics.costPerSafeResolution != null) {
      if (metrics.costPerSafeResolution > thresholds.maxCostPerSafeResolution) {
        failures.push(
          `Cost per Safe Resolution $${metrics.costPerSafeResolution.toFixed(4)} exceeds maximum threshold $${thresholds.maxCostPerSafeResolution.toFixed(4)}`
        );
      }
    }

    return {
      passed: failures.length === 0,
      failures,
    };
  }
}
