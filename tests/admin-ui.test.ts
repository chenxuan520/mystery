import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const adminSource = fs
  .readFileSync(path.join(process.cwd(), "src/web/static/admin.js"), "utf8")
  .replace(/loadAdminBootstrap\(\);\s*$/s, "");

function createRuntime() {
  const appNode = { innerHTML: "" };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    window: {
      Swal: {
        fire: async () => ({ isConfirmed: true }),
      },
      confirm: () => true,
    },
    document: {
      querySelector(selector: string) {
        return selector === "#app" ? appNode : null;
      },
      querySelectorAll() {
        return [];
      },
      createElement() {
        return { click() {}, remove() {}, rel: "", href: "" };
      },
      body: { appendChild() {}, removeChild() {} },
    },
    fetch: async () => ({ ok: true, text: async () => "{}" }),
  };

  vm.createContext(context);
  vm.runInContext(adminSource, context);

  return {
    appNode,
    async run<T = unknown>(expression: string) {
      return (await vm.runInContext(expression, context)) as T;
    },
  };
}

describe("admin dashboard failure rendering", () => {
  it("会在后台顶部显示上一轮生成失败", async () => {
    const runtime = createRuntime();

    await runtime.run(`
      state.mode = "dashboard";
      state.bootstrap = {
        models: {
          options: [],
          selection: {},
          current: { play: { model: "p" }, generator: { model: "g" }, reviewer: { model: "r" } },
        },
        templates: [],
        archives: [],
        latestGenerationJob: {
          id: "job_failed",
          status: "failed",
          error: "模型输出被截断。",
          progress: { message: "模型输出被截断。" },
        },
        activeGenerationJob: null,
      };
      state.generationJob = null;
      state.error = null;
      renderDashboard();
    `);

    expect(runtime.appNode.innerHTML).toContain("上一轮生成失败");
    expect(runtime.appNode.innerHTML).toContain("模型输出被截断。");
  });

  it("失败中的当前任务也会被当成失败提示，而不是继续显示进行中", async () => {
    const runtime = createRuntime();

    await runtime.run(`
      state.mode = "dashboard";
      state.bootstrap = {
        models: {
          options: [],
          selection: {},
          current: { play: { model: "p" }, generator: { model: "g" }, reviewer: { model: "r" } },
        },
        templates: [],
        archives: [],
        latestGenerationJob: null,
        activeGenerationJob: null,
      };
      state.generationJob = {
        id: "job_failed_live",
        status: "failed",
        error: "案件生成失败。",
        progress: { message: "案件生成失败。" },
      };
      state.error = "案件生成失败。";
      renderDashboard();
    `);

    expect(runtime.appNode.innerHTML).toContain("上一轮生成失败");
    expect(runtime.appNode.innerHTML).toContain("案件生成失败。");
    expect(runtime.appNode.innerHTML).not.toContain("当前生成任务");
  });

  it("会显示最近一次已落库的失败记录", async () => {
    const runtime = createRuntime();

    await runtime.run(`
      state.mode = "dashboard";
      state.bootstrap = {
        models: {
          options: [],
          selection: {},
          current: { play: { model: "p" }, generator: { model: "g" }, reviewer: { model: "r" } },
        },
        templates: [],
        archives: [],
        latestGenerationJob: null,
        latestGenerationFailure: {
          id: "job_failure_record",
          status: "failed",
          error: "模型输出被截断。",
          progress: { message: "模型输出被截断。" },
          templateType: "poison",
          generatorPresetId: "deepseek-v4-pro",
        },
        activeGenerationJob: null,
      };
      state.generationJob = null;
      state.error = null;
      renderDashboard();
    `);

    expect(runtime.appNode.innerHTML).toContain("最近一次失败记录（已落库）");
    expect(runtime.appNode.innerHTML).toContain("模型输出被截断。");
    expect(runtime.appNode.innerHTML).toContain("poison / deepseek-v4-pro");
  });
});
