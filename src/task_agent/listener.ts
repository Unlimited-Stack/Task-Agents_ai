import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { dispatchInboundHandshake } from "./dispatcher";
import {
  HandshakeInboundEnvelopeSchema,
  type HandshakeInboundEnvelope,
  type HandshakeOutboundEnvelope
} from "./util/schema";

let serverInstance: Server | null = null;

/**
 * Passive flow gateway.
 * Phase 4: HTTP inbound pipeline with safeParse -> dispatcher -> protocol response.
 */
export async function startListener(): Promise<void> {
  if (serverInstance) {
    return;
  }

  serverInstance = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || req.url !== "/handshake") {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const payload = await readJsonBody(req);
    const response = await handleInboundHandshake(payload);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = response.action === "ERROR" ? 400 : 200;
    res.end(JSON.stringify(response));
  });

  await new Promise<void>((resolve) => {
    serverInstance?.listen(8080, "0.0.0.0", () => resolve());
  });
}

/** 停止 HTTP listener（用于退出运行时或从挂起模式返回）。 */
export async function stopListener(): Promise<void> {
  if (!serverInstance) {
    return;
  }

  const instance = serverInstance;
  serverInstance = null;

  await new Promise<void>((resolve, reject) => {
    instance.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/** 当前 listener 是否已启动（仅表示本进程内 serverInstance 是否存在）。 */
export function isListenerRunning(): boolean {
  return serverInstance !== null;
}

export async function handleInboundHandshake(payload: unknown): Promise<HandshakeOutboundEnvelope> {
  const parsed = HandshakeInboundEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    return buildSchemaErrorResponse(payload);
  }

  const envelope: HandshakeInboundEnvelope = parsed.data;
  return dispatchInboundHandshake(envelope);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (body.length === 0) {
    return {};
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return {};
  }
}

function buildSchemaErrorResponse(payload: unknown): HandshakeOutboundEnvelope {
  const inReplyTo =
    typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).message_id === "string"
      ? ((payload as Record<string, unknown>).message_id as string)
      : "unknown";

  const taskId =
    typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).task_id === "string"
      ? ((payload as Record<string, unknown>).task_id as string)
      : "unknown";

  return {
    protocol_version: "1.0",
    message_id: randomUUID(),
    in_reply_to: inReplyTo,
    task_id: taskId,
    action: "ERROR",
    error: {
      code: "E_SCHEMA_INVALID",
      message: "Inbound handshake schema validation failed"
    },
    timestamp: new Date().toISOString()
  };
}
