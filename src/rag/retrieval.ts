export interface RetrievalQuery {
  targetActivity: string;
  targetVibe: string;
  topK: number;
}

export interface RetrievalCandidate {
  taskId: string;
  targetActivity: string;
  targetVibe: string;
}

export interface RetrievalResult {
  taskId: string;
  score: number;
}

export async function retrieveBySemanticSimilarity(
  query: RetrievalQuery,
  candidates: RetrievalCandidate[]
): Promise<RetrievalResult[]> {
  const queryTokens = tokenize(`${query.targetActivity} ${query.targetVibe}`);
  const results = candidates.map((candidate) => {
    const candidateTokens = tokenize(`${candidate.targetActivity} ${candidate.targetVibe}`);
    const score = jaccardSimilarity(queryTokens, candidateTokens);
    return { taskId: candidate.taskId, score };
  });

  return results.sort((a, b) => b.score - a.score).slice(0, query.topK);
}

function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase().trim();
  const parts = normalized.split(/[\s,.;:!?()[\]{}<>"'`~@#$%^&*+=_|\\/\\-]+/).filter((part) => part.length > 0);
  return new Set(parts);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  const intersectionSize = [...a].filter((token) => b.has(token)).length;
  const unionSize = new Set([...a, ...b]).size;
  if (unionSize === 0) {
    return 0;
  }
  return intersectionSize / unionSize;
}
