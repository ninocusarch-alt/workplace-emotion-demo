import {
  deleteConversation,
  getConversation,
  getConversationMessages,
  getDatabase,
} from "@/lib/server/database";
import { errorResponse, toPublicMessage } from "@/lib/server/http";
import { getIdentity, jsonWithIdentity } from "@/lib/server/identity";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
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
    const messages = await getConversationMessages(database, id);
    return jsonWithIdentity(identity, {
      conversation: {
        id: conversation.id,
        mode: conversation.mode,
        title: conversation.title,
        summary: conversation.summary,
        status: conversation.status,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      },
      messages: messages.map(toPublicMessage),
    });
  } catch (error) {
    return errorResponse(error, identity);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
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
    await deleteConversation(database, identity.user.id, id);
    return jsonWithIdentity(identity, { ok: true });
  } catch (error) {
    return errorResponse(error, identity);
  }
}
