import { getDatabase, listConversations, listMemories } from "@/lib/server/database";
import { errorResponse } from "@/lib/server/http";
import { getIdentity, jsonWithIdentity } from "@/lib/server/identity";

export async function GET(request: Request) {
  let identity;
  try {
    identity = await getIdentity(request);
    const database = await getDatabase();
    const [conversations, memories] = await Promise.all([
      listConversations(database, identity.user.id),
      listMemories(database, identity.user.id, 1),
    ]);
    return jsonWithIdentity(identity, {
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        mode: conversation.mode,
        title: conversation.title,
        summary: conversation.summary,
        status: conversation.status,
        lastMessage: conversation.last_message ?? "",
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      })),
      hasMemory: memories.length > 0,
    });
  } catch (error) {
    return errorResponse(error, identity);
  }
}
