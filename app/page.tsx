"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Mode = "listen" | "clarify" | "action";
type View = "landing" | "chat" | "summary" | "safety";
type Reflection = {
  event: string;
  emotion: string;
  worry: string;
  need: string;
  action: string;
};
type MessageMetadata = {
  phase?: string;
  suggestions?: string[];
  reflection?: Reflection | null;
  safety?: boolean;
  memoryUsed?: boolean;
};
type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  metadata?: MessageMetadata | null;
  createdAt: string;
};
type Conversation = {
  id: string;
  mode: Mode;
  title: string;
  summary: string;
  status: "active" | "completed";
  lastMessage?: string;
  createdAt: string;
  updatedAt: string;
};

const modeCopy: Record<Mode, { label: string; description: string; icon: string }> = {
  listen: {
    label: "我想先说说",
    description: "不急着解决，先把堵在心里的话说出来",
    icon: "○",
  },
  clarify: {
    label: "帮我理一理",
    description: "一起分开事实、情绪和真正担心的事",
    icon: "◎",
  },
  action: {
    label: "想想怎么办",
    description: "把混乱的问题变成一个可执行的小行动",
    icon: "→",
  },
};

const defaultSuggestions: Record<Mode, string[]> = {
  listen: ["今天被临时加活了", "汇报后一直很内耗", "和同事沟通不顺"],
  clarify: ["事情很多，不知道从哪说", "我分不清是生气还是委屈", "我一直担心做不好"],
  action: ["想和领导确认优先级", "想准备一次沟通", "想让今晚先停下来"],
};

class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init?.body
      ? { "content-type": "application/json", ...init.headers }
      : init?.headers,
  });
  const payload = (await response.json()) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new ApiError(
      payload.error?.message || "服务暂时不可用，请稍后再试。",
      payload.error?.code || "UNKNOWN_ERROR",
      response.status,
    );
  }
  return payload;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function Home() {
  const [view, setView] = useState<View>("landing");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [hasMemory, setHasMemory] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState(false);
  const [error, setError] = useState("");
  const [retryContent, setRetryContent] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function bootstrap() {
      try {
        const data = await api<{ conversations: Conversation[]; hasMemory: boolean }>(
          "/api/bootstrap",
        );
        setConversations(data.conversations);
        setHasMemory(data.hasMemory);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "历史记录暂时无法读取。");
      } finally {
        setIsBooting(false);
      }
    }
    void bootstrap();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const currentReflection = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const reflection = messages[index].metadata?.reflection;
      if (reflection) return reflection;
    }
    return null;
  }, [messages]);

  const suggestions = useMemo(() => {
    const latest = [...messages]
      .reverse()
      .find((message) => message.role === "assistant" && message.metadata?.suggestions?.length);
    return latest?.metadata?.suggestions?.slice(0, 4) ||
      (activeConversation ? defaultSuggestions[activeConversation.mode] : []);
  }, [messages, activeConversation]);

  function goHome() {
    setView("landing");
    setActiveConversation(null);
    setMessages([]);
    setInput("");
    setError("");
    setRetryContent("");
    setMemoryNotice(false);
  }

  async function startConversation(mode: Mode) {
    setError("");
    try {
      const data = await api<{ conversation: Conversation; messages: ChatMessage[] }>(
        "/api/conversations",
        { method: "POST", body: JSON.stringify({ mode }) },
      );
      setActiveConversation(data.conversation);
      setMessages(data.messages);
      setConversations((current) => [data.conversation, ...current]);
      setView("chat");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "暂时无法开始对话。");
    }
  }

  async function openConversation(conversation: Conversation) {
    setError("");
    setIsHistoryOpen(false);
    try {
      const data = await api<{ conversation: Conversation; messages: ChatMessage[] }>(
        `/api/conversations/${conversation.id}`,
      );
      setActiveConversation(data.conversation);
      setMessages(data.messages);
      setView("chat");
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "这次对话暂时无法读取。");
    }
  }

  async function send(value?: string, retry = false) {
    if (!activeConversation || isSending) return;
    const content = (value ?? input).trim();
    if (!content) return;

    setError("");
    setRetryContent("");
    setInput("");
    setIsSending(true);
    if (!retry) {
      setMessages((current) => [
        ...current,
        {
          id: `local-${Date.now()}`,
          role: "user",
          content,
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    try {
      const data = await api<{
        message: ChatMessage;
        safety: boolean;
        memoryUsed?: boolean;
        shouldSyncMemory?: boolean;
      }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          conversationId: activeConversation.id,
          content,
          retry,
        }),
      });
      setMessages((current) => [...current, data.message]);
      setMemoryNotice(Boolean(data.memoryUsed));
      setConversations((current) => {
        const updated = current.map((item) =>
          item.id === activeConversation.id
            ? { ...item, updatedAt: new Date().toISOString(), lastMessage: data.message.content }
            : item,
        );
        return updated.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
      });
      if (data.safety) setView("safety");
      if (data.shouldSyncMemory) void syncMemory(activeConversation.id);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "刚才没有回复成功。");
      setRetryContent(content);
    } finally {
      setIsSending(false);
    }
  }

  async function syncMemory(conversationId: string) {
    try {
      const result = await api<{
        ok: boolean;
        title?: string;
        summary?: string;
        memoryCount?: number;
      }>(`/api/conversations/${conversationId}/memory`, { method: "POST" });
      if (!result.title) return;
      setHasMemory((result.memoryCount ?? 0) > 0 || hasMemory);
      setConversations((current) =>
        current.map((item) =>
          item.id === conversationId
            ? { ...item, title: result.title!, summary: result.summary || "", status: "completed" }
            : item,
        ),
      );
      setActiveConversation((current) =>
        current?.id === conversationId
          ? { ...current, title: result.title!, summary: result.summary || "", status: "completed" }
          : current,
      );
    } catch {
      // Memory extraction is best-effort and must not interrupt the main conversation.
    }
  }

  async function removeConversation(conversation: Conversation) {
    if (!window.confirm(`确定删除“${conversation.title}”及其相关记忆吗？此操作无法撤销。`)) {
      return;
    }
    try {
      await api<{ ok: boolean }>(`/api/conversations/${conversation.id}`, {
        method: "DELETE",
      });
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (activeConversation?.id === conversation.id) goHome();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败，请稍后再试。");
    }
  }

  async function clearAllData() {
    if (!window.confirm("确定清空全部历史对话和长期记忆吗？此操作无法撤销。")) return;
    try {
      await api<{ ok: boolean }>("/api/data", { method: "DELETE" });
      setConversations([]);
      setHasMemory(false);
      setIsHistoryOpen(false);
      goHome();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "暂时无法清空数据。");
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={goHome} aria-label="返回首页">
          <span className="brand-mark">缓</span>
          <span>
            <strong>缓一缓</strong>
            <small>职场情绪整理站</small>
          </span>
        </button>
        <div className="topbar-actions">
          <span className="privacy-pill"><i />同一浏览器匿名保存，可随时删除</span>
          <button className="history-button" onClick={() => setIsHistoryOpen(true)}>
            历史记录 {conversations.length > 0 && <b>{conversations.length}</b>}
          </button>
        </div>
      </header>

      {isHistoryOpen && (
        <button className="drawer-backdrop" aria-label="关闭历史记录" onClick={() => setIsHistoryOpen(false)} />
      )}
      <aside className={`history-drawer ${isHistoryOpen ? "open" : ""}`} aria-label="历史记录">
        <div className="drawer-header">
          <div><small>YOUR HISTORY</small><h2>过去的对话</h2></div>
          <button onClick={() => setIsHistoryOpen(false)} aria-label="关闭">×</button>
        </div>
        <p className="drawer-intro">
          {hasMemory ? "AI 会在新对话中谨慎参考与你相关的过往记录。" : "完成几轮对话后，AI 会提炼可复用的长期记忆。"}
        </p>
        <div className="history-list">
          {conversations.length === 0 && <div className="empty-history">还没有历史对话<br /><small>从一次具体的职场事件开始吧</small></div>}
          {conversations.map((conversation) => (
            <article key={conversation.id} className={activeConversation?.id === conversation.id ? "active" : ""}>
              <button className="history-main" onClick={() => void openConversation(conversation)}>
                <span>{modeCopy[conversation.mode].label}</span>
                <strong>{conversation.title}</strong>
                <p>{conversation.summary || conversation.lastMessage || "刚刚开始这次整理"}</p>
                <time>{formatDate(conversation.updatedAt)}</time>
              </button>
              <button className="history-delete" onClick={() => void removeConversation(conversation)} aria-label={`删除${conversation.title}`}>删除</button>
            </article>
          ))}
        </div>
        {conversations.length > 0 && <button className="clear-data" onClick={() => void clearAllData()}>清空全部历史与记忆</button>}
      </aside>

      <section className="product-layout">
        <aside className="workplace-panel" aria-label="职场环境插画">
          <div className="window-scene">
            <span className="building b1" /><span className="building b2" /><span className="building b3" /><span className="sun" />
          </div>
          <div className="panel-copy">
            <p className="eyebrow">下班前，给情绪一个座位</p>
            <h1>工作很满，<br />你也值得被听见。</h1>
            <p>让 DeepSeek 陪你把今天的情绪从脑海里放到桌面上，并记住真正重要的部分。</p>
            <div className="scene-tags"><span>汇报焦虑</span><span>沟通受挫</span><span>临时加活</span><span>职业倦怠</span></div>
          </div>
          <div className="ai-badge"><i />DEEPSEEK AI · 长期记忆</div>
          <div className="desk-scene" aria-hidden="true">
            <div className="plant"><i /><i /><i /><b /></div>
            <div className="monitor"><div><span>今天辛苦了</span><em /></div><b /></div>
            <div className="mug"><span /></div><div className="desk" />
          </div>
        </aside>

        <section className="experience-panel">
          {isBooting && <div className="boot-state"><i /><p>正在找回你的对话记录…</p></div>}

          {!isBooting && view === "landing" && (
            <div className="landing-card content-enter">
              <div className="status-line"><span className="status-dot" />DeepSeek 已准备好倾听</div>
              <h2>此刻，你更希望怎样聊？</h2>
              <p className="intro">没有标准答案，选择最接近你现在状态的方式。</p>
              {conversations[0] && (
                <button className="continue-card" onClick={() => void openConversation(conversations[0])}>
                  <span>继续上次对话</span><strong>{conversations[0].title}</strong><small>{formatDate(conversations[0].updatedAt)} · {modeCopy[conversations[0].mode].label}</small>
                </button>
              )}
              <div className="mode-list">
                {(Object.keys(modeCopy) as Mode[]).map((key) => (
                  <button key={key} className="mode-card" onClick={() => void startConversation(key)}>
                    <span className="mode-icon">{modeCopy[key].icon}</span>
                    <span className="mode-text"><strong>{modeCopy[key].label}</strong><small>{modeCopy[key].description}</small></span>
                    <span className="mode-arrow">→</span>
                  </button>
                ))}
              </div>
              {error && <div className="global-error">{error}</div>}
              <div className="boundary-note"><strong>产品边界与隐私</strong><p>用于日常情绪表达与自我梳理，不提供心理诊断。对话匿名保存在数据库中，你可以随时删除。</p></div>
            </div>
          )}

          {!isBooting && view === "chat" && activeConversation && (
            <div className="chat-card content-enter">
              <div className="chat-header">
                <button onClick={goHome} aria-label="返回首页">←</button>
                <div><strong>{activeConversation.title}</strong><small>{modeCopy[activeConversation.mode].label} · 自动保存</small></div>
                <span className={memoryNotice ? "memory-active" : ""}>{memoryNotice ? "已参考过往记录" : "匿名对话"}</span>
              </div>
              <div className="progress-track"><i className="ai-progress" /></div>
              <div className="messages" aria-live="polite">
                <div className="day-divider"><span>今天 · 一次只聊一件事</span></div>
                {messages.map((message) => (
                  <div key={message.id} className={`message-row ${message.role}`}>
                    {message.role === "assistant" && <span className="avatar">缓</span>}
                    <div className="bubble">{message.content}</div>
                  </div>
                ))}
                {isSending && <div className="message-row assistant"><span className="avatar">缓</span><div className="bubble typing"><i /><i /><i /></div></div>}
                <div ref={chatEndRef} />
              </div>
              {error && (
                <div className="chat-error"><span>{error}</span>{retryContent && <button onClick={() => void send(retryContent, true)}>重试</button>}</div>
              )}
              {currentReflection && !isSending && <button className="reflection-cta" onClick={() => setView("summary")}>查看本次职场情绪复盘卡 →</button>}
              {!isSending && !currentReflection && (
                <div className="quick-prompts">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>)}</div>
              )}
              <form className="composer" onSubmit={onSubmit}>
                <textarea value={input} maxLength={1200} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="也可以用自己的话说…" rows={2} aria-label="输入你的回答" />
                <button type="submit" disabled={!input.trim() || isSending} aria-label="发送">↑</button>
              </form>
            </div>
          )}

          {!isBooting && view === "summary" && currentReflection && (
            <div className="summary-wrap content-enter">
              <div className="summary-top"><button onClick={() => setView("chat")}>← 返回对话</button><small>{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date())}</small></div>
              <div className="summary-card">
                <p className="summary-kicker">AI WORKDAY CHECK-IN</p>
                <h2>今天，我先照顾好自己。</h2>
                <dl>
                  <div><dt>发生了什么</dt><dd>{currentReflection.event}</dd></div>
                  <div><dt>我的感受</dt><dd>{currentReflection.emotion}</dd></div>
                  <div><dt>真正担心</dt><dd>{currentReflection.worry}</dd></div>
                  <div><dt>此刻需要</dt><dd>{currentReflection.need}</dd></div>
                </dl>
                <div className="action-box"><span>明天的最小行动</span><strong>{currentReflection.action}</strong></div>
                <p className="summary-foot">完成这一步就够了，不必今晚解决所有问题。</p>
              </div>
              <div className="summary-actions"><button className="primary" onClick={() => window.print()}>保存这张卡</button><button className="secondary" onClick={goHome}>整理另一件事</button></div>
            </div>
          )}

          {!isBooting && view === "safety" && (
            <div className="safety-card content-enter">
              <span className="safety-icon">!</span><p className="eyebrow">先确保你此刻的安全</p>
              <h2>这已经不是一个人硬撑的时刻。</h2>
              <p>请先离开可能伤害自己或他人的物品和环境，立即联系一位你信任的人陪在身边。如果危险迫在眉睫，请联系当地急救或报警服务。</p>
              <div className="safety-steps"><span>① 去到有人在的地方</span><span>② 联系可信任的人</span><span>③ 寻求专业紧急帮助</span></div>
              <button className="primary" onClick={() => setView("chat")}>返回这次对话</button>
            </div>
          )}
        </section>
      </section>

      <footer><span>缓一缓 · DeepSeek 职场情绪整理</span><span>倾听不是软弱，是重新获得行动力的开始。</span></footer>
    </main>
  );
}
