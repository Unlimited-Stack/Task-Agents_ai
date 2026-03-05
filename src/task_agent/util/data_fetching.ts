export interface ExternalSourceRequest {
  provider: string;
  query: string;
}

export async function fetchExternalData(_request: ExternalSourceRequest): Promise<unknown> {
  return null;
}
