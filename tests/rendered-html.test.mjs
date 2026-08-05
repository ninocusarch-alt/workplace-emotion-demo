import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the finished workplace AI product shell", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /缓一缓｜DeepSeek 职场情绪整理/);
  assert.match(page, /正在找回你的对话记录/);
  assert.match(page, /历史记录/);
  assert.match(page, /清空全部历史与记忆/);
  assert.doesNotMatch(page, /Your site is taking shape|codex-preview/);
});

test("keeps model secrets on the server and enables D1", async () => {
  const [page, deepseek, hosting, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/deepseek.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_massive_senator_kelly.sql", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /DEEPSEEK_API_KEY|api\.deepseek\.com/);
  assert.match(deepseek, /DEEPSEEK_API_KEY/);
  assert.match(deepseek, /deepseek-v4-flash/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(migration, /CREATE TABLE `conversations`/);
  assert.match(migration, /CREATE TABLE `memories`/);
  assert.match(migration, /CREATE UNIQUE INDEX `idx_memories_user_normalized`/);
});

test("implements explicit safety routing before the model call", async () => {
  const [chatRoute, safety] = await Promise.all([
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/safety.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(
    chatRoute.indexOf("isHighRisk(content)") <
      chatRoute.indexOf("const assistant = await createAssistantReply"),
  );
  assert.match(safety, /自杀|轻生/);
  assert.match(safety, /当地急救或报警服务/);
});
