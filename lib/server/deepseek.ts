import {
  getRuntimeEnv,
  type MemoryCategory,
  type MemoryRecord,
  type MessageRecord,
  type Mode,
} from "./database";

type ChatPhase = "emotion" | "worry" | "need" | "action" | "reflect";

export type Reflection = {
  event: string;
  emotion: string;
  worry: string;
  need: string;
  action: string;
};

export type AssistantPayload = {
  reply: string;
  suggestions: string[];
  phase: ChatPhase;
  reflection?: Reflection;
};

type ExtractedMemory = {
  category: MemoryCategory;
  content: string;
  confidence: number;
};

export type MemoryExtraction = {
  title: string;
  summary: string;
  memories: ExtractedMemory[];
};

const PHASE_GUIDANCE: Record<ChatPhase, string> = {
  emotion: "帮助用户给当前感受命名并确认强度，不急着给建议。",
  worry: "帮助用户从情绪背后找到真正担心的结果。",
  need: "帮助用户识别此刻需要的信息、理解、休息或边界。",
  action: "帮助用户找到十分钟内可开始、由本人控制的最小行动。",
  reflect: "总结本次事件、情绪、担忧、需要和最小行动，生成复盘卡。",
};

const MODE_GUIDANCE: Record<Mode, string> = {
  listen: "语气以倾听和接纳为主，建议更少，允许用户慢一点。",
  clarify: "帮助用户区分事实、解释、感受和担忧，一次只问一个问题。",
  action: "在充分确认感受后，尽快收敛为可控的小行动。",
};

function memoryBlock(memories: MemoryRecord[]): string {
  if (!memories.length) return "没有可用的长期记忆。";
  return memories
    .map((memory, index) => `${index + 1}. [${memory.category}] ${memory.content}`)
    .join("\n");
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("MODEL_INVALID_JSON");
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validateReflection(value: unknown): Reflection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const reflection = {
    event: text(record.event, 160),
    emotion: text(record.emotion, 100),
    worry: text(record.worry, 160),
    need: text(record.need, 120),
    action: text(record.action, 120),
  };
  return Object.values(reflection).every(Boolean) ? reflection : undefined;
}

async function requestJson(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  userId: string,
  maxTokens: number,
  useJsonMode = true,
): Promise<unknown> {
  const runtime = getRuntimeEnv();
  if (!runtime.DEEPSEEK_API_KEY) throw new Error("MODEL_NOT_CONFIGURED");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const requestBody: Record<string, unknown> = {
      model: runtime.DEEPSEEK_MODEL || "deepseek-v4-flash",
      messages,
      thinking: { type: "disabled" },
      temperature: 0.45,
      max_tokens: maxTokens,
      user_id: userId,
    };
    if (useJsonMode) requestBody.response_format = { type: "json_object" };

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtime.DEEPSEEK_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
    const payload = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string | null; reasoning_content?: string | null };
      }>;
    };
    const choice = payload.choices?.[0];
    const content = choice?.message?.content?.trim();
    if (!content) {
      console.error("[deepseek-empty]", {
        finishReason: choice?.finish_reason,
        hasReasoning: Boolean(choice?.message?.reasoning_content),
      });
      throw new Error("MODEL_EMPTY_RESPONSE");
    }
    return safeJsonParse(content);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("MODEL_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createAssistantReply(input: {
  mode: Mode;
  phase: ChatPhase;
  messages: MessageRecord[];
  memories: MemoryRecord[];
  userId: string;
}): Promise<AssistantPayload> {
  const system = `你是“缓一缓”，一个面向职场人士的中文情绪整理助手，不是心理医生。

产品方法：先确认感受，再区分事实、解释、担忧、需要和行动。每次只推进一个问题。${MODE_GUIDANCE[input.mode]}
当前阶段：${input.phase}。${PHASE_GUIDANCE[input.phase]}

长期记忆仅供试探性参考。不得把记忆当作本次事实；若引用，必须使用“你之前提到过……这次也有关吗？”一类可确认表达。不得编造历史。
${memoryBlock(input.memories)}

边界：不作心理诊断，不替用户做职业决定，不鼓励冲动辞职，不评价同事或领导的人格。若内容暗示自伤、伤人或紧急危险，停止普通对话并建议联系可信任的人与当地紧急服务。

只输出一个 JSON 对象，不要 Markdown：
{
  "reply": "自然、简洁的中文回复，先共情再只问一个问题",
  "suggestions": ["2到4个用户可直接点击的短回答"],
  "phase": "${input.phase}",
  "reflection": ${input.phase === "reflect" ? '{"event":"...","emotion":"...","worry":"...","need":"...","action":"..."}' : "null"}
}`;

  const recentMessages = input.messages.slice(-14).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  let raw: unknown;
  try {
    raw = await requestJson(
      [{ role: "system", content: system }, ...recentMessages],
      input.userId,
      900,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      ["MODEL_EMPTY_RESPONSE", "MODEL_INVALID_JSON"].includes(error.message)
    ) {
      raw = await requestJson(
        [
          { role: "system", content: system },
          ...recentMessages,
          { role: "user", content: "请严格按照上面的字段输出一个 JSON 对象。" },
        ],
        input.userId,
        900,
        false,
      );
    } else {
      throw error;
    }
  }

  if (!raw || typeof raw !== "object") throw new Error("MODEL_INVALID_JSON");
  const record = raw as Record<string, unknown>;
  const reply = text(record.reply, 1200);
  if (!reply) throw new Error("MODEL_INVALID_JSON");
  const suggestions = Array.isArray(record.suggestions)
    ? record.suggestions.map((item) => text(item, 48)).filter(Boolean).slice(0, 4)
    : [];
  const reflection = validateReflection(record.reflection);
  if (input.phase === "reflect" && !reflection) {
    throw new Error("MODEL_INVALID_JSON");
  }
  return { reply, suggestions, phase: input.phase, reflection };
}

const ALLOWED_MEMORY_CATEGORIES = new Set<MemoryCategory>([
  "stress_source",
  "preference",
  "goal",
  "coping_strategy",
  "unresolved_issue",
]);

function sanitizeMemory(content: string): string | null {
  const cleaned = content.replace(/\s+/g, " ").trim().slice(0, 160);
  if (cleaned.length < 4) return null;
  if (/\b[\w.+-]+@[\w.-]+\.\w+\b/.test(cleaned)) return null;
  if (/(?:\+?86[- ]?)?1[3-9]\d{9}/.test(cleaned)) return null;
  return cleaned;
}

export function normalizeMemory(content: string): string {
  return content.toLowerCase().replace(/[\s，。！？、,.!?；;：:（）()“”'"-]/g, "");
}

export async function extractConversationMemory(input: {
  messages: MessageRecord[];
  existingMemories: MemoryRecord[];
  userId: string;
}): Promise<MemoryExtraction> {
  const transcript = input.messages
    .slice(-20)
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`)
    .join("\n");
  const system = `你是职场情绪产品的信息整理模块。根据对话生成简体中文 JSON，不要输出 Markdown。

只提取对未来对话确实有帮助的稳定信息或反复主题。禁止保存姓名、公司名、联系方式、地址、账号等身份信息；禁止把助手的推测当作用户事实；一次性情绪强度不进入长期记忆。

记忆类别只能是：stress_source、preference、goal、coping_strategy、unresolved_issue。
confidence 只能为 1、2、3；只有用户明确表达时才可为 3。

输出格式：
{"title":"12字以内会话标题","summary":"60字以内会话摘要","memories":[{"category":"goal","content":"一条可独立理解的记忆","confidence":2}]}

现有记忆（避免重复）：
${memoryBlock(input.existingMemories)}

本次对话：
${transcript}`;
  const extractionMessages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: "请整理为 JSON。" },
  ];
  let raw: unknown;
  try {
    raw = await requestJson(extractionMessages, input.userId, 700);
  } catch (error) {
    if (
      error instanceof Error &&
      ["MODEL_EMPTY_RESPONSE", "MODEL_INVALID_JSON"].includes(error.message)
    ) {
      raw = await requestJson(
        [
          ...extractionMessages,
          { role: "user", content: "不要解释，只输出可解析的 JSON 对象。" },
        ],
        input.userId,
        700,
        false,
      );
    } else {
      throw error;
    }
  }
  if (!raw || typeof raw !== "object") throw new Error("MODEL_INVALID_JSON");
  const record = raw as Record<string, unknown>;
  const title = text(record.title, 24) || "一次职场情绪整理";
  const summary = text(record.summary, 120) || "已完成一次职场情绪整理。";
  const memories = Array.isArray(record.memories)
    ? record.memories
        .map((item): ExtractedMemory | null => {
          if (!item || typeof item !== "object") return null;
          const memory = item as Record<string, unknown>;
          const category = memory.category as MemoryCategory;
          const content = sanitizeMemory(text(memory.content, 160));
          if (!ALLOWED_MEMORY_CATEGORIES.has(category) || !content) return null;
          const confidence = Math.max(1, Math.min(3, Number(memory.confidence) || 1));
          return { category, content, confidence };
        })
        .filter((item): item is ExtractedMemory => Boolean(item))
        .slice(0, 6)
    : [];
  return { title, summary, memories };
}

export function chooseRelevantMemories(
  memories: MemoryRecord[],
  userInput: string,
): MemoryRecord[] {
  const compactInput = normalizeMemory(userInput);
  return memories
    .map((memory, index) => {
      const fragments = memory.content.split(/[，。；、\s]/).filter((part) => part.length >= 2);
      const matches = fragments.filter((part) => compactInput.includes(normalizeMemory(part))).length;
      return { memory, score: matches * 10 - index };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ memory }) => memory);
}
