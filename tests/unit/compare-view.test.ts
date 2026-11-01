/**
 * TASK-L.17b：对比视图「双栏渲染完整」。
 *
 * 注意：本目录（tests/unit）在 vitest 的 node project 下运行，无 jsdom。
 * 因此用 react-dom/server 的 SSR 渲染成 HTML 字符串断言结构 —— 既能证明
 * 双栏真实渲染，又不依赖 DOM 环境。CompareView 为纯展示组件，无 effect/state。
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CompareView,
  type CompareViewProps,
} from "../../src/components/project/CompareView";
import { REAL_PLAYTEST_IFRAME_SANDBOX } from "../../src/lib/ipc/real-preview-origin";

const PREVIEW_URL = "http://127.0.0.1:4200/";

function render(props: CompareViewProps): string {
  return renderToStaticMarkup(React.createElement(CompareView, props));
}

function fullProps(): CompareViewProps {
  return {
    contractId: "ctr-playtest-1",
    references: ["https://ref.example.com"],
    snapshots: [
      {
        reference_url: "https://ref.example.com",
        html_snapshot: "<html><body>ref</body></html>",
        dom_summary: "h1: 登录 · button: 提交",
        screenshot_url: "data:image/png;base64,AAAA",
      },
    ],
    previewUrl: PREVIEW_URL,
    previewStatus: "RUNNING",
  };
}

describe("TASK-L.17b CompareView 双栏渲染", () => {
  it("双栏完整：左参考站快照 + 右 iframe 直连 LIVE + 外链直达", () => {
    const html = render(fullProps());
    expect(html).toContain('data-testid="compare-view"');
    expect(html).toContain('data-testid="compare-view-left"');
    expect(html).toContain('data-testid="compare-view-right"');
    // 左栏三类成果
    expect(html).toContain('data-testid="compare-view-html-snapshot"');
    expect(html).toContain('data-testid="compare-view-dom-summary"');
    expect(html).toContain('data-testid="compare-view-screenshot"');
    expect(html).toContain("https://ref.example.com");
    expect(html).toContain("h1: 登录");
    // 右栏 iframe 直连 + sandbox
    expect(html).toContain('data-testid="compare-view-iframe"');
    expect(html).toContain(PREVIEW_URL);
    expect(html).toContain(REAL_PLAYTEST_IFRAME_SANDBOX);
    // 外链直达
    expect(html).toContain('data-testid="compare-view-open-external"');
    expect(html).toContain("在浏览器打开");
  });

  it("不引入 studio 层 RealPlaytestPane 布局依赖", () => {
    const html = render(fullProps());
    expect(html).not.toContain("real-playtest-pane");
    expect(html).not.toContain("real-playtest-gates");
  });

  it("只供人眼对照，无机器比对（REJ-009）", () => {
    const html = render(fullProps());
    expect(html).toContain("仅供人眼对照");
    expect(html).toContain("不做自动比对");
    expect(html).not.toMatch(/像素比对|DOM 量化|相似度\s*\d|diff 分数/);
  });

  it("无抓取成果时左栏给白话空态，无预览时右栏不渲染 iframe", () => {
    const html = render({
      contractId: "ctr-playtest-1",
      references: ["https://ref.example.com"],
      previewStatus: "STOPPED",
    });
    expect(html).toContain('data-testid="compare-view-left-empty"');
    expect(html).toContain("https://ref.example.com");
    expect(html).toContain('data-testid="compare-view-right-empty"');
    expect(html).not.toContain('data-testid="compare-view-iframe"');
    expect(html).not.toContain('data-testid="compare-view-open-external"');
  });

  it("preview ERROR 时渲染错误提示", () => {
    const html = render({
      previewUrl: PREVIEW_URL,
      previewStatus: "ERROR",
      errorMessage: "端口被占用",
    });
    expect(html).toContain('data-testid="compare-view-error"');
    expect(html).toContain("端口被占用");
  });
});
