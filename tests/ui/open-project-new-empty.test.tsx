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

describe("TASK-DS.2 OpenProjectEntry new empty project UI (DS2-P3)", () => {
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

  it("darwin：显示「新建空项目」，与最近/粘贴/选择文件夹共存", async () => {
    stubMacNavigator();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              path: "/Users/tina/Desktop/1020",
              name: "1020",
              lastOpenedAt: "2026-11-08T00:00:00.000Z",
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
    expect(screen.getByTestId("create-empty-project-open")).toBeInTheDocument();
    expect(screen.getByTestId("create-empty-project-name")).toBeInTheDocument();
    expect(
      screen.getByTestId("create-empty-project-button"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("pick-folder-open")).toBeInTheDocument();
    expect(screen.getByTestId("pick-folder-button")).toBeInTheDocument();
    expect(screen.getByTestId("paste-path-input")).toBeInTheDocument();
    expect(screen.getByTestId("paste-path-submit")).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("非 darwin：不展示假新建空项目入口", async () => {
    stubLinuxNavigator();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<OpenProjectEntry repoName="x" repoPath="/tmp/x" variant="page" />);

    await waitFor(() => {
      expect(screen.getByTestId("paste-path-open")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("create-empty-project-open")).toBeNull();
    expect(screen.queryByTestId("create-empty-project-button")).toBeNull();
    expect(screen.queryByTestId("pick-folder-open")).toBeNull();
    expect(screen.getByTestId("paste-path-input")).toBeInTheDocument();
  });

  it("新建：名 → pick-folder → create-empty-project → open（#token=）", async () => {
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
        new Response(JSON.stringify({ path: "/Users/tina/Desktop/parent" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ path: "/Users/tina/Desktop/parent/new-app" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            path: "/Users/tina/Desktop/parent/new-app",
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
      expect(
        screen.getByTestId("create-empty-project-button"),
      ).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("create-empty-project-name"), {
      target: { value: "new-app" },
    });
    fireEvent.click(screen.getByTestId("create-empty-project-button"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalled();
    });
    const launchUrl = String(assign.mock.calls[0]![0]);
    expect(launchUrl).toMatch(/#token=/);
    expect(launchUrl).not.toMatch(/[?&]token=/);

    const pickCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/desktop/pick-folder"),
    );
    const createCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/desktop/create-empty-project"),
    );
    const openCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/recent-projects/open"),
    );
    expect(pickCall).toBeTruthy();
    expect(createCall).toBeTruthy();
    expect(openCall).toBeTruthy();
    const createBody = JSON.parse(String(createCall![1]?.body ?? "{}")) as {
      parentPath?: string;
      name?: string;
    };
    expect(createBody.parentPath).toBe("/Users/tina/Desktop/parent");
    expect(createBody.name).toBe("new-app");
  });

  it("选夹取消：不调用 create-empty-project", async () => {
    stubMacNavigator();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ cancelled: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    render(
      <OpenProjectEntry
        repoName="1020"
        repoPath="/Users/tina/Desktop/1020"
        variant="page"
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("create-empty-project-button"),
      ).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("create-empty-project-name"), {
      target: { value: "cancelled-app" },
    });
    fireEvent.click(screen.getByTestId("create-empty-project-button"));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).includes("/api/desktop/pick-folder"),
        ),
      ).toBe(true);
    });
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes("/api/desktop/create-empty-project"),
      ),
    ).toBe(false);
  });

  it("欢迎页经 OpenProjectEntry 露出新建空项目（≠ 宣称 D.1e 完成）", async () => {
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
      expect(
        screen.getByTestId("create-empty-project-button"),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("pick-folder-button")).toBeInTheDocument();
    expect(screen.getByTestId("paste-path-open")).toBeInTheDocument();
  });
});
