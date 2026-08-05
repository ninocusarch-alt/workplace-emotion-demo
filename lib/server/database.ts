import { env } from "cloudflare:workers";

export type Mode = "listen" | "clarify" | "action";
export type ConversationStatus = "active" | "completed";
export type MessageRole = "user" | "assistant";
export type MemoryCategory =
  | "stress_source"
  | "preference"
  | "goal"
  | "coping_strategy"
  | "unresolved_issue";

export type UserRecord = {
  id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
};

export type ConversationRecord = {
  id: string;
  user_id: string;
  mode: Mode;
  title: string;
  summary: string;
  status: ConversationStatus;
  created_at: string;
  updated_at: string;
  last_message?: string | null;
};

export type MessageRecord = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  metadata_json: string | null;
  created_at: string;
};

export type MemoryRecord = {
  id: string;
  user_id: string;
  category: MemoryCategory;
  content: string;
  normalized_content: string;
  confidence: number;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
};

type RuntimeEnv = {
  DB?: D1Database;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
};

let schemaPromise: Promise<void> | null = null;

export function getRuntimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export async function getDatabase(): Promise<D1Database> {
  const database = getRuntimeEnv().DB;
  if (!database) {
    throw new Error("DATABASE_UNAVAILABLE");
  }
  schemaPromise ??= initializeSchema(database);
  await schemaPromise;
  return database;
}

async function initializeSchema(database: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_token_hash ON users (token_hash)",
    `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('listen', 'clarify', 'action')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations (user_id, updated_at)",
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages (conversation_id, created_at)",
    `CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN ('stress_source', 'preference', 'goal', 'coping_strategy', 'unresolved_issue')),
      content TEXT NOT NULL,
      normalized_content TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 1,
      source_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_memories_user_category_updated ON memories (user_id, category, updated_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_normalized ON memories (user_id, normalized_content)",
  ];

  await database.batch(statements.map((statement) => database.prepare(statement)));
  await database.prepare("PRAGMA optimize").run();
}

export async function findUserByTokenHash(
  database: D1Database,
  tokenHash: string,
): Promise<UserRecord | null> {
  return database
    .prepare("SELECT * FROM users WHERE token_hash = ? LIMIT 1")
    .bind(tokenHash)
    .first<UserRecord>();
}

export async function createUser(
  database: D1Database,
  tokenHash: string,
): Promise<UserRecord> {
  const now = new Date().toISOString();
  const user: UserRecord = {
    id: crypto.randomUUID(),
    token_hash: tokenHash,
    created_at: now,
    last_seen_at: now,
  };
  await database
    .prepare(
      "INSERT INTO users (id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
    )
    .bind(user.id, user.token_hash, user.created_at, user.last_seen_at)
    .run();
  return user;
}

export async function touchUser(database: D1Database, userId: string) {
  await database
    .prepare("UPDATE users SET last_seen_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), userId)
    .run();
}

export async function listConversations(
  database: D1Database,
  userId: string,
): Promise<ConversationRecord[]> {
  const result = await database
    .prepare(
      `SELECT c.*,
        (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
       FROM conversations c
       WHERE c.user_id = ?
       ORDER BY c.updated_at DESC
       LIMIT 50`,
    )
    .bind(userId)
    .all<ConversationRecord>();
  return result.results;
}

export async function createConversation(
  database: D1Database,
  userId: string,
  mode: Mode,
  opening: string,
): Promise<{ conversation: ConversationRecord; openingMessage: MessageRecord }> {
  const now = new Date().toISOString();
  const conversation: ConversationRecord = {
    id: crypto.randomUUID(),
    user_id: userId,
    mode,
    title: mode === "listen" ? "新的职场倾诉" : mode === "action" ? "新的行动梳理" : "新的情绪梳理",
    summary: "",
    status: "active",
    created_at: now,
    updated_at: now,
  };
  const openingMessage: MessageRecord = {
    id: crypto.randomUUID(),
    conversation_id: conversation.id,
    role: "assistant",
    content: opening,
    metadata_json: JSON.stringify({ phase: "event", suggestions: [] }),
    created_at: now,
  };

  await database.batch([
    database
      .prepare(
        `INSERT INTO conversations
          (id, user_id, mode, title, summary, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        conversation.id,
        conversation.user_id,
        conversation.mode,
        conversation.title,
        conversation.summary,
        conversation.status,
        conversation.created_at,
        conversation.updated_at,
      ),
    database
      .prepare(
        `INSERT INTO messages
          (id, conversation_id, role, content, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        openingMessage.id,
        openingMessage.conversation_id,
        openingMessage.role,
        openingMessage.content,
        openingMessage.metadata_json,
        openingMessage.created_at,
      ),
  ]);
  return { conversation, openingMessage };
}

export async function getConversation(
  database: D1Database,
  userId: string,
  conversationId: string,
): Promise<ConversationRecord | null> {
  return database
    .prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(conversationId, userId)
    .first<ConversationRecord>();
}

export async function getConversationMessages(
  database: D1Database,
  conversationId: string,
  limit = 100,
): Promise<MessageRecord[]> {
  const result = await database
    .prepare(
      `SELECT * FROM (
        SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
       ) ORDER BY created_at ASC`,
    )
    .bind(conversationId, limit)
    .all<MessageRecord>();
  return result.results;
}

export async function insertMessage(
  database: D1Database,
  conversationId: string,
  role: MessageRole,
  content: string,
  metadata: unknown = null,
): Promise<MessageRecord> {
  const message: MessageRecord = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    role,
    content,
    metadata_json: metadata ? JSON.stringify(metadata) : null,
    created_at: new Date().toISOString(),
  };
  await database
    .prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      message.id,
      message.conversation_id,
      message.role,
      message.content,
      message.metadata_json,
      message.created_at,
    )
    .run();
  return message;
}

export async function updateConversationActivity(
  database: D1Database,
  conversationId: string,
  title?: string,
) {
  const now = new Date().toISOString();
  if (title) {
    await database
      .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
      .bind(title, now, conversationId)
      .run();
    return;
  }
  await database
    .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .bind(now, conversationId)
    .run();
}

export async function updateConversationSummary(
  database: D1Database,
  conversationId: string,
  title: string,
  summary: string,
) {
  await database
    .prepare(
      "UPDATE conversations SET title = ?, summary = ?, status = 'completed', updated_at = ? WHERE id = ?",
    )
    .bind(title, summary, new Date().toISOString(), conversationId)
    .run();
}

export async function deleteConversation(
  database: D1Database,
  userId: string,
  conversationId: string,
) {
  await database
    .prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
    .bind(conversationId, userId)
    .run();
}

export async function clearUser(database: D1Database, userId: string) {
  await database.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
}

export async function countRecentUserMessages(
  database: D1Database,
  userId: string,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM messages m
       INNER JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user' AND m.created_at >= ?`,
    )
    .bind(userId, new Date(Date.now() - 60_000).toISOString())
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function listMemories(
  database: D1Database,
  userId: string,
  limit = 30,
): Promise<MemoryRecord[]> {
  const result = await database
    .prepare(
      "SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
    )
    .bind(userId, limit)
    .all<MemoryRecord>();
  return result.results;
}

export async function upsertMemories(
  database: D1Database,
  userId: string,
  conversationId: string,
  items: Array<{
    category: MemoryCategory;
    content: string;
    normalizedContent: string;
    confidence: number;
  }>,
) {
  const now = new Date().toISOString();
  if (items.length) {
    await database.batch(
      items.map((item) =>
        database
          .prepare(
            `INSERT INTO memories
              (id, user_id, category, content, normalized_content, confidence, source_conversation_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, normalized_content) DO UPDATE SET
               category = excluded.category,
               content = excluded.content,
               confidence = MAX(memories.confidence, excluded.confidence),
               source_conversation_id = excluded.source_conversation_id,
               updated_at = excluded.updated_at`,
          )
          .bind(
            crypto.randomUUID(),
            userId,
            item.category,
            item.content,
            item.normalizedContent,
            item.confidence,
            conversationId,
            now,
            now,
          ),
      ),
    );
  }

  const overflow = await database
    .prepare(
      "SELECT id FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT -1 OFFSET 30",
    )
    .bind(userId)
    .all<{ id: string }>();
  if (overflow.results.length) {
    await database.batch(
      overflow.results.map(({ id }) =>
        database.prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").bind(id, userId),
      ),
    );
  }
}
