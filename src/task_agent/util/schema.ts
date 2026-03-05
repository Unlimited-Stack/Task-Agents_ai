import { z } from "zod";

export const TASK_STATUS_VALUES = [
  "Drafting",
  "Searching",
  "Negotiating",
  "Waiting_Human",
  "Revising",
  "Closed",
  "Failed",
  "Timeout",
  "Cancelled"
] as const;

export const INTERACTION_TYPE_VALUES = ["online", "offline", "any"] as const;

export const HANDSHAKE_ACTION_VALUES = [
  "PROPOSE",
  "COUNTER_PROPOSE",
  "ACCEPT",
  "REJECT",
  "CANCEL",
  "ERROR"
] as const;

export const TaskStatusSchema = z.enum(TASK_STATUS_VALUES);
export const InteractionTypeSchema = z.enum(INTERACTION_TYPE_VALUES);
export const HandshakeActionSchema = z.enum(HANDSHAKE_ACTION_VALUES);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type InteractionType = z.infer<typeof InteractionTypeSchema>;
export type HandshakeAction = z.infer<typeof HandshakeActionSchema>;

export const TaskFrontmatterSchema = z.object({
  task_id: z.string().min(1),
  status: TaskStatusSchema,
  interaction_type: InteractionTypeSchema,
  must_match_tags: z.array(z.string()),
  deal_breakers: z.array(z.string()),
  current_partner_id: z.string().nullable(),
  entered_status_at: z.string().datetime(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  version: z.number().int().nonnegative(),
  pending_sync: z.boolean()
});

export const TaskBodySchema = z.object({
  rawDescription: z.string().min(1),
  targetActivity: z.string().min(1),
  targetVibe: z.string().min(1)
});

export const TaskDocumentSchema = z.object({
  frontmatter: TaskFrontmatterSchema,
  body: TaskBodySchema
});

export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;
export type TaskBody = z.infer<typeof TaskBodySchema>;
export type TaskDocument = z.infer<typeof TaskDocumentSchema>;

export const HandshakePayloadSchema = z.object({
  interaction_type: InteractionTypeSchema,
  must_match_tags: z.array(z.string()),
  deal_breakers: z.array(z.string()),
  target_activity: z.string().min(1),
  target_vibe: z.string().min(1)
});

export const HandshakeInboundEnvelopeSchema = z.object({
  protocol_version: z.string().min(1),
  message_id: z.string().min(1),
  sender_agent_id: z.string().min(1),
  receiver_agent_id: z.string().min(1),
  task_id: z.string().min(1),
  action: HandshakeActionSchema,
  round: z.number().int().nonnegative(),
  payload: HandshakePayloadSchema,
  timestamp: z.string().datetime(),
  signature: z.string().min(1)
});

export const HandshakeOutboundEnvelopeSchema = z.object({
  protocol_version: z.string().min(1),
  message_id: z.string().min(1),
  in_reply_to: z.string().min(1),
  task_id: z.string().min(1),
  action: HandshakeActionSchema,
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1)
    })
    .nullable(),
  timestamp: z.string().datetime()
});

export type HandshakeInboundEnvelope = z.infer<typeof HandshakeInboundEnvelopeSchema>;
export type HandshakeOutboundEnvelope = z.infer<typeof HandshakeOutboundEnvelopeSchema>;

export const ErrorCodeSchema = z.enum([
  "E_SCHEMA_INVALID",
  "E_PROTOCOL_VERSION_UNSUPPORTED",
  "E_IDEMPOTENCY_CONFLICT",
  "E_VERSION_CONFLICT",
  "E_DEP_UNAVAILABLE",
  "E_INTERNAL"
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const L0CandidateSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1)
});

export const L1CandidateSchema = z.object({
  taskId: z.string().min(1),
  score: z.number()
});

export type L0Candidate = z.infer<typeof L0CandidateSchema>;
export type L1Candidate = z.infer<typeof L1CandidateSchema>;

export function parseTaskDocument(input: unknown): TaskDocument {
  return TaskDocumentSchema.parse(input);
}

export function parseHandshakeInboundEnvelope(input: unknown): HandshakeInboundEnvelope {
  return HandshakeInboundEnvelopeSchema.parse(input);
}

export function parseHandshakeOutboundEnvelope(input: unknown): HandshakeOutboundEnvelope {
  return HandshakeOutboundEnvelopeSchema.parse(input);
}
