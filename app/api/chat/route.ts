import {
  countRecentUserMessages,
  getConversation,
  getConversationMessages,
  getDatabase,
  insertMessage,
  listMemories,
  updateConversationActivity,
} from "@/lib/server/database";
import {
  chooseRelevantMemories,
  createAssistantReply,
} from "@/lib/server/deepseek";
import { errorResponse, toPublicMessage } from "@/lib/server/http";
import { getIdentity, jsonWithIdentity } from "@/lib/server/identity";
import { isHighRisk, SAFETY_REPLY } from "@/lib/server/safety";

function makeTitle(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > 16 ? `${clean.slice(0, 16)}…` : clean;
}

function phaseForUserTurn(turn: number) {
  if (turn <= 1) return "emotion" as const;
  if (turn === 2) return "worry" as const;
  if (turn === 3) return "need" as const;
  if (turn === 4) return "action" as const;
  return "reflect" as const;
}

export async function POST(request: Request) {
  let identity;
  try {
    identity = await getIdentity(request);
    const body = (await request.json()) as {
      conversationId?: string;
      content?: string;
      retry?: boolean;
    };
    const content = body.content?.trim() ?? "";
    if (!body.conversationId || !content || content.length > 1200) {
      return jsonWithIdentity(
        identity,
        { error: { code: "INVALID_INPUT", message: "请输入 1–1200 字的内容。" } },
        { status: 400 },
      );
    }

    const database = await getDatabase();
    const conversation = await getConversation(
      database,
      identity.user.id,
      body.conversationId,
    );
    if (!conversation) {
      return jsonWithIdentity(
        identity,
        { error: { code: "NOT_FOUND", message: "没有找到这次对话。" } },
        { status: 404 },
      );
    }

    let messages = await getConversationMessages(database, conversation.id, 40);
    const existingUserMessages = messages.filter((message) => message.role === "user");
    const lastMessage = messages.at(-1);
    const canReuse =
      body.retry && lastMessage?.role === "user" && lastMessage.content === content;

    if (!canReuse) {
      if ((await countRecentUserMessages(database, identity.user.id)) >= 12) {
        return jsonWithIdentity(
          identity,
          { error: { code: "RATE_LIMIT", message: "发送得有点快，稍等一分钟再继续。" } },
          { status: 429 },
        );
      }
      const userMessage = await insertMessage(
        database,
        conversation.id,
        "user",
        content,
      );
      messages = [...messages, userMessage];
      await updateConversationActivity(
        database,
        conversation.id,
        existingUserMessages.length === 0 ? makeTitle(content) : undefined,
      );
    }

    if (isHighRisk(content)) {
      const safetyMessage = await insertMessage(
        database,
        conversation.id,
        "assistant",
        SAFETY_REPLY,
        { safety: true, phase: "safety", suggestions: [] },
      );
      await updateConversationActivity(database, conversation.id);
      return jsonWithIdentity(identity, {
        message: toPublicMessage(safetyMessage),
        safety: true,
      });
    }

    const userTurn = existingUserMessages.length + (canReuse ? 0 : 1);
    const allMemories = await listMemories(database, identity.user.id, 30);
    const relevantMemories = chooseRelevantMemories(allMemories, content);
    const assistant = await createAssistantReply({
      mode: conversation.mode,
      phase: phaseForUserTurn(Math.max(1, userTurn)),
      messages,
      memories: relevantMemories,
      userId: identity.user.id,
    });
    const assistantMessage = await insertMessage(
      database,
      conversation.id,
      "assistant",
      assistant.reply,
      {
        phase: assistant.phase,
        suggestions: assistant.suggestions,
        reflection: assistant.reflection ?? null,
        memoryUsed: relevantMemories.length > 0,
      },
    );
    await updateConversationActivity(database, conversation.id);

    return jsonWithIdentity(identity, {
      message: toPublicMessage(assistantMessage),
      safety: false,
      memoryUsed: relevantMemories.length > 0,
      shouldSyncMemory: userTurn >= 3 && userTurn % 2 === 1,
    });
  } catch (error) {
    return errorResponse(error, identity);
  }
}
