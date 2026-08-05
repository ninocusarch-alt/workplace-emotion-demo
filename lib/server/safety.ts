const HIGH_RISK_PATTERNS = [
  /自杀|轻生|结束生命|不想活|活不下去|伤害自己|割腕|跳楼|服药自尽/,
  /杀了|杀人|伤害别人|报复.*伤害|同归于尽/,
  /马上.*死|现在.*死|已经.*准备|遗书/,
];

export const SAFETY_REPLY =
  "我很在意你此刻的安全。请先离开可能伤害自己或他人的物品和环境，去到有人陪伴的地方，并立即联系一位你信任的人。如果危险迫在眉睫，请联系当地急救或报警服务。此刻不需要一个人扛着。";

export function isHighRisk(content: string): boolean {
  return HIGH_RISK_PATTERNS.some((pattern) => pattern.test(content));
}
