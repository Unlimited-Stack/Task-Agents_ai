export interface EmbeddingRecord {
  indexId: string;
  sourceTaskId: string;
}

export async function upsertEmbeddingIndex(_record: EmbeddingRecord): Promise<void> {
  // Intentionally empty in phase 1.
}
