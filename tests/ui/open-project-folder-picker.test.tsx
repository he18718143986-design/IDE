/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OpenProjectEntry } from "../../src/components/layout/OpenProjectEntry";
import { ProjectWelcomePage } from "../../src/components/layout/ProjectWelcomePage";

const fetchMock = vi.fn();

function stubMacNavigator() {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    get: () => "MacIntel",
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    get: () =>
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });
}

function stubLinuxNavigator() {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    get: () => "Linux x86_64",
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    get: () => "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
  });
}

describe("TASK-DS.1 OpenProjectEntry folder picker UI (DS1-P3)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.clear();
    sessionStorage.setItem("stagent.sessionToken", "a".repeat(64));
    sessionStorage.setItem("stagent.baseUrl", "http://127.0.0.1:3005");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("darwin：显示「选择文件夹」，与最近列表/粘贴路径共存", async () => {
    stubMacNavigator();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              path: "/Users/tina/Desktop/1020",
              name: "1020",
              lastOpenedAt: "2026-11-07T00:00:00.000Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <OpenProjectEntry
        repoName="1020"
        repoPath="/Users/tina/Desktop/1020"
        variant="page"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("recent-projects-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId("pick-folder-open")).toBeInTheDocument();
    expect(screen.getByTestId("pick-folder-button")).toBeInTheDocument();
    expect(screen.getByTestId("paste-path-input")).toBeInTheDocument();
    expect(screen.getByTestId("paste-path-submit")).toBeInTheDocument();
    // 仍无浏览器 file input 冒充系统选夹
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("非 darwin：不展示假选夹入口", async () => {
    stubLinuxNavigator();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <OpenProjectEntry repoName="x" repoPath="/tmp/x" variant="page" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("paste-path-open")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("pick-folder-open")).toBeNull();
    expect(screen.queryByTestId("pick-folder-button")).toBeNull();
    expect(screen.getByTestId("paste-path-input")).toBeInTheDocument();
  });

  it("点击选夹成功后走 openWorkspaceByPath（#token= launchUrl）", async () => {
    stubMacNavigator();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ path: "/Users/tina/Desktop/picked" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            path: "/Users/tina/Desktop/picked",
            port: 3005,
            reused: false,
            sameOrigin: true,
            uiUrl: "http://127.0.0.1:3005/",
            launchUrl: "http://127.0.0.1:3005/#token=" + "b".repeat(64),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    render(
      <OpenProjectEntry
        repoName="1020"
        repoPath="/Users/tina/Desktop/1020"
        variant="page"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pick-folder-button")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("pick-folder-button"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalled();
    });
    const launchUrl = String(assign.mock.calls[0]![0]);
    expect(launchUrl).toMatch(/#token=/);
    expect(launchUrl).not.toMatch(/[?&]token=/);

    // pick-folder → recent-projects/open
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    const pickCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/desktop/pick-folder"),
    );
    const openCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/recent-projects/open"),
    );
    expect(pickCall).toBeTruthy();
    expect(openCall).toBeTruthy();
  });

  it("欢迎页经 OpenProjectEntry 露出选夹（≠ 宣称 D.1e 完成）", async () => {
    stubMacNavigator();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <ProjectWelcomePage
        repoName="1020"
        repoPath="/Users/tina/Desktop/1020"
        baseBranch="main"
        onOpenSupervisor={() => {}}
      />,
    );
    expect(screen.getByTestId("project-welcome-page")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("pick-folder-button")).toBeInTheDocument();
    });
    expect(screen.getByTestId("paste-path-open")).toBeInTheDocument();
  });
});
