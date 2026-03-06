import { cosineSimilarity } from "./embedding";
import { listTaskSnapshots, readAllTaskVectors, type VectorRecord } from "../task_agent/util/sqlite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorSearchQuery {
  /** Source task ID (excluded from results) */
  sourceTaskId: string;
  /** Query vectors keyed by field name */
  queryVectors: {
    targetActivity?: number[];
    targetVibe?: number[];
    rawDescription?: number[];
  };
  /** Number of results to return */
  topK: number;
  /**
   * Weight per field for final score aggregation.
   * Defaults: targetActivity=0.35, targetVibe=0.35, rawDescription=0.30
   */
  weights?: {
    targetActivity?: number;
    targetVibe?: number;
    rawDescription?: number;
  };
  /**
   * If provided, only search within these task IDs (L0 pre-filtered whitelist).
   * If omitted, falls back to status-based filtering from task_index.
   */
  candidateTaskIds?: string[];
  /** Only search tasks in these statuses (used when candidateTaskIds is not set). Default: ["Searching"] */
  statusFilter?: string[];
}

export interface VectorSearchResult {
  taskId: string;
  /** Weighted aggregate score */
  score: number;
  /** Per-field scores for traceability */
  fieldScores: {
    targetActivity: number | null;
    targetVibe: number | null;
    rawDescription: number | null;
  };
}

// ---------------------------------------------------------------------------
// Default weights
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS = {
  targetActivity: 0.35,
  targetVibe: 0.35,
  rawDescription: 0.30
} as const;

// ---------------------------------------------------------------------------
// Core vector search (brute-force cosine similarity over SQLite vectors)
// ---------------------------------------------------------------------------

/**
 * L1 semantic search: brute-force cosine similarity over all candidate task vectors.
 *
 * Strategy:
 * 1. Query task_index for candidate task_ids matching status filter
 * 2. For each candidate, load its per-field vectors from per-task vector table
 * 3. Compute weighted cosine similarity across available fields
 * 4. Return top-K sorted by aggregate score
 *
 * Performance: O(N * D) where N = candidate count, D = vector dimensions.
 * For N < 10,000 and D = 1024, this completes in single-digit milliseconds.
 */
export function searchByVector(query: VectorSearchQuery): VectorSearchResult[] {
  const weights = {
    targetActivity: query.weights?.targetActivity ?? DEFAULT_WEIGHTS.targetActivity,
    targetVibe: query.weights?.targetVibe ?? DEFAULT_WEIGHTS.targetVibe,
    rawDescription: query.weights?.rawDescription ?? DEFAULT_WEIGHTS.rawDescription
  };

  // Step 1: Determine candidate task_ids
  let candidateIds: string[];
  if (query.candidateTaskIds && query.candidateTaskIds.length > 0) {
    // Use L0 pre-filtered whitelist
    candidateIds = query.candidateTaskIds.filter((id) => id !== query.sourceTaskId);
  } else {
    // Fallback: status-based filtering from global index
    const statusFilter = new Set(query.statusFilter ?? ["Searching"]);
    const allSnapshots = listTaskSnapshots();
    candidateIds = allSnapshots
      .filter((s) => s.task_id !== query.sourceTaskId && statusFilter.has(s.status))
      .map((s) => s.task_id);
  }

  if (candidateIds.length === 0) return [];

  // Step 2+3: Load vectors and compute scores
  const results: VectorSearchResult[] = [];

  for (const candidateId of candidateIds) {
    const vectors = readAllTaskVectors(candidateId);
    if (vectors.length === 0) continue;

    const vecMap = new Map<string, VectorRecord>();
    for (const v of vectors) {
      vecMap.set(v.field, v);
    }

    const fieldScores = {
      targetActivity: computeFieldScore(query.queryVectors.targetActivity, vecMap.get("targetActivity")),
      targetVibe: computeFieldScore(query.queryVectors.targetVibe, vecMap.get("targetVibe")),
      rawDescription: computeFieldScore(query.queryVectors.rawDescription, vecMap.get("rawDescription"))
    };

    // Weighted average over available field pairs
    let totalWeight = 0;
    let totalScore = 0;

    if (fieldScores.targetActivity !== null) {
      totalScore += fieldScores.targetActivity * weights.targetActivity;
      totalWeight += weights.targetActivity;
    }
    if (fieldScores.targetVibe !== null) {
      totalScore += fieldScores.targetVibe * weights.targetVibe;
      totalWeight += weights.targetVibe;
    }
    if (fieldScores.rawDescription !== null) {
      totalScore += fieldScores.rawDescription * weights.rawDescription;
      totalWeight += weights.rawDescription;
    }

    // Skip candidates with no computable score
    if (totalWeight === 0) continue;

    const score = totalScore / totalWeight;
    results.push({ taskId: candidateId, score, fieldScores });
  }

  // Step 4: Sort and take top-K
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, query.topK);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeFieldScore(queryVec: number[] | undefined, candidateRec: VectorRecord | undefined): number | null {
  if (!queryVec || !candidateRec) return null;
  return cosineSimilarity(queryVec, candidateRec.vector);
}

