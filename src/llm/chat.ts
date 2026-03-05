export interface ChatRequest {
  model: string;
  prompt: string;
  timeoutMs: number;
}

export interface ChatResponse {
  rawText: string;
}

/**
 * LLM gateway.
 * Phase 1: no external provider integration yet.
 */
export async function chatWithModel(_request: ChatRequest): Promise<ChatResponse> {
  return { rawText: "" };
}
