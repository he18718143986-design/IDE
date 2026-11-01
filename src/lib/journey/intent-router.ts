/**
 * 非技术旅程意图分流（TASK-S.6 / TASK-L.16）。
 *
 * 纯规则、确定性、零模型：同一句话恒得同一结论，便于单测与白话解释。
 * 产品路由 + 默认闲聊透传：
 * - LIVE_INCIDENT（E 类）：线上 / 生产 / LIVE 目标名 → 回流「线上」卡
 * - DISPUTE：质疑 / 抱怨做错了 → 调质疑自查
 * - REAL_PLAYTEST：打开真机预览 → 挂中栏/外链（TASK-S.6b）
 * - FAST_PATH：字号/文案/颜色等小事 → 免强制整套 Demo
 * - MAJOR_DRAFT：新功能 / 大改 → 出或更新草案
 * - CHAT：其余 → 交给右侧 Worker 会话
 *
 * 保护域关键词命中时，即使表面像「小改」也升格为 MAJOR_DRAFT，
 * 避免绕过登录/支付等保护清单。
 */

export const JOURNEY_INTENT_KINDS = [
  "LIVE_INCIDENT",
  "DISPUTE",
  "FAST_PATH",
  "MAJOR_DRAFT",
  "REAL_PLAYTEST",
  "CHAT",
] as const;

export type JourneyIntentKind = (typeof JOURNEY_INTENT_KINDS)[number];

export interface JourneyIntentResult {
  kind: JourneyIntentKind;
  /** 0–1，规则命中强度；仅供展示，不作门禁 */
  confidence: number;
  /** 白话理由（可直接塞进聊天卡） */
  reasons: string[];
  /** Fast Path 时为 true：产品层免强制整套 Demo */
  skip_demo: boolean;
}

/** TASK-L.16：E 类分流可选上下文 */
export interface JourneyIntentContext {
  /** 当前 LIVE 目标白话名 / target_id；消息命中则走 E */
  liveTargetNames?: string[];
  /** 有施工中合同时禁止 E（supervisor §16.5 条件） */
  hasInProgressContract?: boolean;
}

const LIVE_INCIDENT_PATTERNS: RegExp[] = [
  /线上/,
  /上线后/,
  /生产环境/,
  /生产上/,
  /生产里/,
  /\bproduction\b/i,
  /\bprod\b/i,
];

const DISPUTE_PATTERNS: RegExp[] = [
  /做错[了啦]/,
  /做错/,
  /不对[啊呀嘛]?$/,
  /这里不对/,
  /这里有问题/,
  /有问题/,
  /质疑/,
  /帮我查/,
  /查一下/,
  /自查/,
  /漏[做了]/,
  /没做/,
  /少做/,
  /bug/i,
  /坏[了掉]/,
  /抱怨/,
  /怎么还/,
  /不是这样/,
];

const REAL_PLAYTEST_PATTERNS: RegExp[] = [
  /真机/,
  /真实页面/,
  /真实预览/,
  /真实环境/,
  /打开真.*预览/,
  /打开真.*页面/,
  /启动真机/,
  /真预览/,
  /real\s*playtest/i,
  /playtest/i,
];

const FAST_PATH_PATTERNS: RegExp[] = [
  /字号/,
  /字体/,
  /字大/,
  /字小/,
  /调大/,
  /调小/,
  /改[一一下下]*文案/,
  /改[一一下下]*标题/,
  /改[一一下下]*颜色/,
  /换个颜色/,
  /换颜色/,
  /改颜色/,
  /微调/,
  /小改/,
  /改个字/,
  /改几个字/,
  /标题大一点/,
  /标题小一点/,
  /间距/,
  /行高/,
  /padding/i,
  /margin/i,
];

const MAJOR_PATTERNS: RegExp[] = [
  /我想做/,
  /我要做/,
  /帮我做/,
  /帮我建/,
  /帮我实现/,
  /新增/,
  /加个功能/,
  /加一个/,
  /做一个/,
  /实现一个/,
  /新模块/,
  /新页面/,
  /新功能/,
  /完整/,
  /整套/,
  /从零/,
  /重构/,
  /大改/,
];

/** 命中则禁止 Fast Path，升格大事 */
const PROTECTED_DOMAIN_PATTERNS: RegExp[] = [
  /登录/,
  /登陆/,
  /注册/,
  /密码/,
  /支付/,
  /付款/,
  /订单/,
  /鉴权/,
  /权限/,
  /token/i,
  /\.env/i,
  /密钥/,
  /秘钥/,
  /银行卡/,
  /信用卡/,
];

function matched(patterns: RegExp[], text: string): string[] {
  const hits: string[] = [];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) hits.push(m[0]);
  }
  return hits;
}

function matchedLiveTargets(text: string, names: string[] | undefined): string[] {
  if (!names || names.length === 0) return [];
  const hits: string[] = [];
  const lower = text.toLowerCase();
  for (const name of names) {
    const n = name.trim();
    if (!n) continue;
    if (text.includes(n) || lower.includes(n.toLowerCase())) {
      hits.push(n);
    }
  }
  return hits;
}

/**
 * 对用户右侧输入做白话分流。
 * 优先级：线上问题(E) > 质疑 > 真机试玩 > 保护域升格 > Fast Path > 大事草案 > 闲聊。
 */
export function classifyJourneyIntent(
  raw: string,
  ctx: JourneyIntentContext = {},
): JourneyIntentResult {
  const text = raw.trim();
  if (text.length === 0) {
    return {
      kind: "CHAT",
      confidence: 0,
      reasons: ["空消息，不分流"],
      skip_demo: false,
    };
  }

  // TASK-L.16 E 类：线上问题（无施工中合同）
  if (!ctx.hasInProgressContract) {
    const onlineHits = matched(LIVE_INCIDENT_PATTERNS, text);
    const targetHits = matchedLiveTargets(text, ctx.liveTargetNames);
    if (onlineHits.length > 0 || targetHits.length > 0) {
      const bits = [
        ...onlineHits.slice(0, 2),
        ...targetHits.slice(0, 2),
      ];
      return {
        kind: "LIVE_INCIDENT",
        confidence: Math.min(0.95, 0.7 + bits.length * 0.08),
        reasons: [
          `听起来像线上/生产问题（命中：${bits.join("、") || "LIVE 目标"}）`,
          "走线上回流：请到发布页看「线上」卡，点「让 AI 看看」生成带现场信息的修复合同。",
        ],
        skip_demo: true,
      };
    }
  }

  const disputeHits = matched(DISPUTE_PATTERNS, text);
  if (disputeHits.length > 0) {
    return {
      kind: "DISPUTE",
      confidence: Math.min(0.95, 0.55 + disputeHits.length * 0.12),
      reasons: [
        `听起来像在说「做错了 / 要查一下」（命中：${disputeHits.slice(0, 3).join("、")}）`,
        "走质疑自查：对照需求、规范和代码，用白话告诉你是施工漏了还是新需求。",
      ],
      skip_demo: false,
    };
  }

  const playtestHits = matched(REAL_PLAYTEST_PATTERNS, text);
  if (playtestHits.length > 0) {
    return {
      kind: "REAL_PLAYTEST",
      confidence: Math.min(0.95, 0.7 + playtestHits.length * 0.1),
      reasons: [
        `你想打开真实页面试玩（命中：${playtestHits.slice(0, 3).join("、")}）`,
        "走真机预览：中栏挂真实 URL，也可在浏览器新标签打开。",
      ],
      skip_demo: true,
    };
  }

  const protectedHits = matched(PROTECTED_DOMAIN_PATTERNS, text);
  const fastHits = matched(FAST_PATH_PATTERNS, text);
  if (fastHits.length > 0 && protectedHits.length > 0) {
    return {
      kind: "MAJOR_DRAFT",
      confidence: 0.85,
      reasons: [
        `表面像小事（${fastHits.slice(0, 2).join("、")}），但提到了保护相关（${protectedHits.slice(0, 2).join("、")}）`,
        "不能走 Fast Path，升格为标准草案/审批，避免改到登录支付等锁住的地方。",
      ],
      skip_demo: false,
    };
  }

  if (fastHits.length > 0) {
    return {
      kind: "FAST_PATH",
      confidence: Math.min(0.95, 0.6 + fastHits.length * 0.1),
      reasons: [
        `判定为局部小事（命中：${fastHits.slice(0, 3).join("、")}）`,
        "走 Fast Path：不必再强制整套「出文档 → 静态 Demo → 点实施 → 看整张拓扑」。",
      ],
      skip_demo: true,
    };
  }

  const majorHits = matched(MAJOR_PATTERNS, text);
  if (majorHits.length > 0 || text.length >= 24) {
    const reasons =
      majorHits.length > 0
        ? [
            `听起来像新功能或较大改动（命中：${majorHits.slice(0, 3).join("、")}）`,
            "走出/更新草案，并刷新左侧需求说明。",
          ]
        : ["这句话比较具体，按大事处理：先出草案，让你确认范围再开工。"];
    return {
      kind: "MAJOR_DRAFT",
      confidence: majorHits.length > 0 ? 0.8 : 0.55,
      reasons,
      skip_demo: false,
    };
  }

  return {
    kind: "CHAT",
    confidence: 0.4,
    reasons: ["暂未识别为质疑 / 小事 / 大事，先交给当前 AI 助手继续聊。"],
    skip_demo: false,
  };
}
