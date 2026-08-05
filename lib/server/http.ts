import type { Identity } from "./identity";
import { jsonWithIdentity } from "./identity";

export function publicError(error: unknown): {
  code: string;
  message: string;
  status: number;
} {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  if (code === "DATABASE_UNAVAILABLE") {
    return { code, message: "历史记录服务暂时不可用，请稍后再试。", status: 503 };
  }
  if (code === "MODEL_NOT_CONFIGURED") {
    return { code, message: "AI 服务尚未配置，请添加 DeepSeek API Key。", status: 503 };
  }
  if (code === "MODEL_TIMEOUT") {
    return { code, message: "这次思考时间有点久，请重试刚才的消息。", status: 504 };
  }
  if (code.startsWith("MODEL_")) {
    return { code, message: "刚才没有回复成功，请重试一次。", status: 503 };
  }
  return { code: "UNKNOWN_ERROR", message: "服务暂时开了个小差，请稍后再试。", status: 500 };
}

export function errorResponse(error: unknown, identity?: Identity): Response {
  const result = publicError(error);
  if (identity) {
    return jsonWithIdentity(identity, { error: result }, { status: result.status });
  }
  return Response.json({ error: result }, { status: result.status });
}

export function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function toPublicMessage(message: {
  id: string;
  role: string;
  content: string;
  metadata_json: string | null;
  created_at: string;
}) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    metadata: parseMetadata(message.metadata_json),
    createdAt: message.created_at,
  };
}
