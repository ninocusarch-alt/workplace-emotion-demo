import {
  createConversation,
  getDatabase,
  type Mode,
} from "@/lib/server/database";
import { errorResponse, toPublicMessage } from "@/lib/server/http";
import { getIdentity, jsonWithIdentity } from "@/lib/server/identity";

const OPENINGS: Record<Mode, string> = {
  listen:
    "我在。这里不用马上得出结论，也不用把话组织得很完整。今天工作里发生了什么，让你最想找个人说说？",
  clarify:
    "可以，我们慢慢把它理清楚。我会一次只问一个问题。今天哪件事最消耗你的情绪？",
  action:
    "好，我们先不追求一次解决全部问题，只找一个能让明天轻松一点的小动作。现在最卡住你的是什么？",
};

const MODES = new Set<Mode>(["listen", "clarify", "action"]);

export async function POST(request: Request) {
  let identity;
  try {
    identity = await getIdentity(request);
    const body = (await request.json()) as { mode?: Mode };
    if (!body.mode || !MODES.has(body.mode)) {
      return jsonWithIdentity(
        identity,
        { error: { code: "INVALID_MODE", message: "请选择一种对话方式。" } },
        { status: 400 },
      );
    }
    const database = await getDatabase();
    const { conversation, openingMessage } = await createConversation(
      database,
      identity.user.id,
      body.mode,
      OPENINGS[body.mode],
    );
    return jsonWithIdentity(
      identity,
      {
        conversation: {
          id: conversation.id,
          mode: conversation.mode,
          title: conversation.title,
          summary: conversation.summary,
          status: conversation.status,
          createdAt: conversation.created_at,
          updatedAt: conversation.updated_at,
        },
        messages: [toPublicMessage(openingMessage)],
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, identity);
  }
}
