import { describe, expect, it } from "vitest";
import { createComputerUseRuntime, CUA_DRIVER_SUPPORTED_PLATFORMS } from "../index.js";
import { callBrokerMethod } from "../broker.js";

// relay-official：本包默认装配 MIT @trycua 驱动，不是官方开源仓的 fail-closed placeholder。
// 官方用例「默认执行入口必报不可用」在本线不成立，也不该成立——默认模式是否真能跑起来
// 取决于本机是否装得上 @trycua 原生驱动，那是部署属性，单元测试不断言它。
// 保留并改写仍然成立的不变式：
//  1. 显式 `driver:"disabled"` 维持 placeholder 语义（fail-closed 可退回）；
//  2. broker 面（官方 Helper 进程协议）继续 fail-closed——本线不实现 Helper；
//  3. 驱动支持的平台三元组覆盖三大桌面平台。

describe("Computer Use runtime availability", () => {
  it('driver:"disabled" 明确报告不可用，且不触发真实 broker 准备', async () => {
    let prepared = false;
    const runtime = createComputerUseRuntime({
      driver: "disabled",
      ensureBrokerAvailable: async () => {
        prepared = true;
      },
    });
    await expect(
      runtime.execute({
        toolName: "computer_use",
        arguments: {},
        context: { sessionId: "example", runtimeScope: "main", workspaceKey: "example" },
      }),
    ).resolves.toMatchObject({ isError: true });
    expect(prepared).toBe(false);
    await runtime.dispose();
  });

  it("broker 方法拒绝执行真实系统能力（本线无 Helper，继续 fail-closed）", async () => {
    await expect(
      callBrokerMethod({ method: "example", socketPath: "unused" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("驱动平台覆盖 win32 / darwin / linux", () => {
    const platforms = CUA_DRIVER_SUPPORTED_PLATFORMS.map((triple) => triple.split("-")[0]);
    expect(platforms).toContain("win32");
    expect(platforms).toContain("darwin");
    expect(platforms).toContain("linux");
  });
});
