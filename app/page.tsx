"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Mode = "listen" | "clarify" | "action";
type View = "landing" | "chat" | "summary" | "safety";
type Message = { role: "assistant" | "user"; content: string };

const modeCopy: Record<Mode, { label: string; description: string; icon: string }> = {
  listen: {
    label: "我想先说说",
    description: "不急着解决，先把堵在心里的话说出来",
    icon: "◌",
  },
  clarify: {
    label: "帮我理一理",
    description: "一起分开事实、情绪和真正担心的事",
    icon: "⌁",
  },
  action: {
    label: "想想怎么办",
    description: "把混乱的问题变成一个可执行的小行动",
    icon: "↗",
  },
};

const prompts = [
  ["临时加活", "被否定了", "同事沟通不畅", "开会很焦虑"],
  ["焦虑 8/10", "委屈 7/10", "愤怒 6/10", "疲惫 9/10"],
  ["担心做不好", "怕影响评价", "不知道怎么沟通", "努力没被看见"],
  ["需要明确优先级", "需要被认可", "需要一点休息", "需要沟通边界"],
  ["列出明天三件事", "约一次10分钟沟通", "先休息半小时", "把问题写下来"],
];

const opening: Record<Mode, string> = {
  listen:
    "我在。这里不是绩效复盘，也不需要马上得出结论。今天工作里发生了哪件事，让你最想找个人说说？",
  clarify:
    "可以，我们慢慢把它理清楚。我会一次只问一个问题。今天哪件事最消耗你的情绪？",
  action:
    "好，我们先不追求一次解决全部问题，只找一个能让明天轻松一点的小动作。现在最卡住你的是什么事？",
};

const replies = [
  (value: string) =>
    `听起来，“${value}”是今天最让你消耗的一刻。先不评价对错，如果给此刻的感受起个名字，它更接近焦虑、委屈、愤怒，还是疲惫？也可以用你自己的词，并标一个 0–10 的强度。`,
  (value: string) =>
    `我记下了：${value}。这份感受背后通常会连着一个担心。如果事情没有改善，你最担心出现什么结果？`,
  (value: string) =>
    `原来真正压着你的，是“${value}”。这并不代表它一定会发生，但它值得被认真看见。此刻你更需要什么：明确的信息、被理解、休息一下，还是建立边界？`,
  (value: string) =>
    `“${value}”是一个很具体的需要。最后我们不做宏大计划：如果只选一件十分钟左右能开始的小事，你愿意先做什么？`,
  () => "好的，我把刚才的内容整理成一张职场情绪复盘卡。你可以检查、修改，也可以只留给自己。",
];

const riskKeywords = ["自杀", "不想活", "结束生命", "伤害自己", "杀人", "伤害别人"];

export default function Home() {
  const [view, setView] = useState<View>("landing");
  const [mode, setMode] = useState<Mode>("clarify");
  const [messages, setMessages] = useState<Message[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [step, setStep] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const progress = Math.min(((step + 1) / 5) * 100, 100);
  const summary = useMemo(
    () => ({
      event: answers[0] || "今天的一次职场事件",
      emotion: answers[1] || "有些复杂的情绪",
      worry: answers[2] || "对结果的不确定",
      need: answers[3] || "更清晰的信息与支持",
      action: answers[4] || "给自己十分钟整理下一步",
    }),
    [answers],
  );

  function start(selectedMode: Mode) {
    setMode(selectedMode);
    setMessages([{ role: "assistant", content: opening[selectedMode] }]);
    setAnswers([]);
    setStep(0);
    setInput("");
    setView("chat");
  }

  function reset() {
    setView("landing");
    setMessages([]);
    setAnswers([]);
    setStep(0);
    setInput("");
    setIsThinking(false);
  }

  function send(value?: string) {
    const message = (value ?? input).trim();
    if (!message || isThinking) return;

    if (riskKeywords.some((keyword) => message.includes(keyword))) {
      setMessages((current) => [...current, { role: "user", content: message }]);
      setInput("");
      setView("safety");
      return;
    }

    const currentStep = Math.min(step, replies.length - 1);
    const nextAnswers = [...answers];
    nextAnswers[currentStep] = message;
    setAnswers(nextAnswers);
    setMessages((current) => [...current, { role: "user", content: message }]);
    setInput("");
    setIsThinking(true);

    window.setTimeout(() => {
      const reply = replies[currentStep](message);
      setMessages((current) => [...current, { role: "assistant", content: reply }]);
      setIsThinking(false);
      if (currentStep === 4) {
        window.setTimeout(() => setView("summary"), 850);
      } else {
        setStep(currentStep + 1);
      }
    }, 520);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={reset} aria-label="返回首页">
          <span className="brand-mark">缓</span>
          <span>
            <strong>缓一缓</strong>
            <small>职场情绪整理站</small>
          </span>
        </button>
        <div className="privacy-pill"><span />对话仅保留在本次体验中</div>
      </header>

      <section className="product-layout">
        <aside className="workplace-panel" aria-label="职场环境插画">
          <div className="window-scene">
            <span className="building b1" />
            <span className="building b2" />
            <span className="building b3" />
            <span className="sun" />
          </div>
          <div className="panel-copy">
            <p className="eyebrow">下班前，给情绪一个座位</p>
            <h1>工作很满，<br />你也值得被听见。</h1>
            <p>一次五分钟的对话，把今天的情绪从脑海里放到桌面上。</p>
            <div className="scene-tags">
              <span>汇报焦虑</span><span>沟通受挫</span><span>临时加活</span><span>职业倦怠</span>
            </div>
          </div>
          <div className="desk-scene" aria-hidden="true">
            <div className="plant"><i /><i /><i /><b /></div>
            <div className="monitor"><div><span>今天辛苦了</span><em /></div><b /></div>
            <div className="mug"><span /></div>
            <div className="desk" />
          </div>
        </aside>

        <section className="experience-panel">
          {view === "landing" && (
            <div className="landing-card content-enter">
              <div className="status-line"><span className="status-dot" />可以慢一点回答</div>
              <h2>此刻，你更希望怎样聊？</h2>
              <p className="intro">没有标准答案，选择最接近你现在状态的方式。</p>
              <div className="mode-list">
                {(Object.keys(modeCopy) as Mode[]).map((key) => (
                  <button key={key} className="mode-card" onClick={() => start(key)}>
                    <span className="mode-icon">{modeCopy[key].icon}</span>
                    <span className="mode-text"><strong>{modeCopy[key].label}</strong><small>{modeCopy[key].description}</small></span>
                    <span className="mode-arrow">→</span>
                  </button>
                ))}
              </div>
              <div className="boundary-note">
                <strong>产品边界</strong>
                <p>用于日常情绪表达与自我梳理，不提供心理诊断，也不能替代专业支持。</p>
              </div>
            </div>
          )}

          {view === "chat" && (
            <div className="chat-card content-enter">
              <div className="chat-header">
                <button onClick={reset} aria-label="返回选择模式">←</button>
                <div><strong>{modeCopy[mode].label}</strong><small>第 {Math.min(step + 1, 5)} / 5 步</small></div>
                <span>约 3 分钟</span>
              </div>
              <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
              <div className="messages" aria-live="polite">
                <div className="day-divider"><span>今天 · 一次只聊一件事</span></div>
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`message-row ${message.role}`}>
                    {message.role === "assistant" && <span className="avatar">缓</span>}
                    <div className="bubble">{message.content}</div>
                  </div>
                ))}
                {isThinking && (
                  <div className="message-row assistant"><span className="avatar">缓</span><div className="bubble typing"><i /><i /><i /></div></div>
                )}
                <div ref={chatEndRef} />
              </div>
              {!isThinking && (
                <div className="quick-prompts">
                  {prompts[Math.min(step, 4)].map((prompt) => <button key={prompt} onClick={() => send(prompt)}>{prompt}</button>)}
                </div>
              )}
              <form className="composer" onSubmit={onSubmit}>
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  placeholder="也可以用自己的话说……"
                  rows={2}
                  aria-label="输入你的回答"
                />
                <button type="submit" disabled={!input.trim() || isThinking} aria-label="发送">↑</button>
              </form>
            </div>
          )}

          {view === "summary" && (
            <div className="summary-wrap content-enter">
              <div className="summary-top"><span>今日复盘</span><small>{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date())}</small></div>
              <div className="summary-card">
                <p className="summary-kicker">WORKDAY CHECK-IN</p>
                <h2>今天，我先照顾好自己。</h2>
                <dl>
                  <div><dt>发生了什么</dt><dd>{summary.event}</dd></div>
                  <div><dt>我的感受</dt><dd>{summary.emotion}</dd></div>
                  <div><dt>真正担心</dt><dd>{summary.worry}</dd></div>
                  <div><dt>此刻需要</dt><dd>{summary.need}</dd></div>
                </dl>
                <div className="action-box"><span>明天的最小行动</span><strong>{summary.action}</strong></div>
                <p className="summary-foot">完成这一步就够了，不必今晚解决所有问题。</p>
              </div>
              <div className="summary-actions">
                <button className="primary" onClick={() => window.print()}>保存这张卡</button>
                <button className="secondary" onClick={reset}>再整理一件事</button>
              </div>
            </div>
          )}

          {view === "safety" && (
            <div className="safety-card content-enter">
              <span className="safety-icon">!</span>
              <p className="eyebrow">先确保你此刻的安全</p>
              <h2>这已经不是一个人硬撑的时刻。</h2>
              <p>请先离开可能伤害自己或他人的物品和环境，并立即联系一位你信任的人陪在身边。如果危险迫在眉睫，请联系当地急救或报警服务。</p>
              <div className="safety-steps"><span>① 去到有人在的地方</span><span>② 联系可信任的人</span><span>③ 寻求专业紧急帮助</span></div>
              <button className="primary" onClick={reset}>返回首页</button>
            </div>
          )}
        </section>
      </section>

      <footer>
        <span>缓一缓 · 职场情绪整理 Demo</span>
        <span>倾听不是软弱，是重新获得行动力的开始。</span>
      </footer>
    </main>
  );
}
