import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [uniqueIndex("idx_users_token_hash").on(table.tokenHash)],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["listen", "clarify", "action"] }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status", { enum: ["active", "completed"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_conversations_user_updated").on(table.userId, table.updatedAt),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_messages_conversation_created").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category", {
      enum: [
        "stress_source",
        "preference",
        "goal",
        "coping_strategy",
        "unresolved_issue",
      ],
    }).notNull(),
    content: text("content").notNull(),
    normalizedContent: text("normalized_content").notNull(),
    confidence: integer("confidence").notNull().default(1),
    sourceConversationId: text("source_conversation_id").references(
      () => conversations.id,
      { onDelete: "cascade" },
    ),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_memories_user_category_updated").on(
      table.userId,
      table.category,
      table.updatedAt,
    ),
    uniqueIndex("idx_memories_user_normalized").on(
      table.userId,
      table.normalizedContent,
    ),
  ],
);
