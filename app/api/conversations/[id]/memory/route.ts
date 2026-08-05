import {
  getConversation,
  getConversationMessages,
  getDatabase,
  listMemories,
  updateConversationSummary,
  upsertMemories,
} from "@/lib/server/database";
import {
  extractConversationMemory,
  normalizeMemory,
} from "@/lib/server/deepseek";
import { errorResponse } from "@/lib/server/http";
import { getIdentity, jsonWithIdentity } from "@/lib/server/identity";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  let identity;
  try {
    identity = await getIdentity(request);
    const { id } = await context.params;
    const database = await getDatabase();
    const conversation = await getConversation(database, identity.user.id, id);
    if (!conversation) {
      return jsonWithIdentity(
        identity,
        { error: { code: "NOT_FOUND", message: "没有找到这次对话。" } },
        { status: 404 },
      );
    }
    const messages = await getConversationMessages(database, id, 40);
    if (messages.filter((message) => message.role === "user").length < 3) {
      return jsonWithIdentity(identity, { ok: true, skipped: true });
    }
    const existingMemories = await listMemories(database, identity.user.id, 30);
    const extraction = await extractConversationMemory({
      messages,
      existingMemories,
      userId: identity.user.id,
    });
    await updateConversationSummary(
      database,
      id,
      extraction.title,
      extraction.summary,
    );
    await upsertMemories(
      database,
      identity.user.id,
      id,
      extraction.memories.map((memory) => ({
        ...memory,
        normalizedContent: normalizeMemory(memory.content),
      })),
    );
    return jsonWithIdentity(identity, {
      ok: true,
      title: extraction.title,
      summary: extraction.summary,
      memoryCount: extraction.memories.length,
    });
  } catch (error) {
    return errorResponse(error, identity);
  }
}
