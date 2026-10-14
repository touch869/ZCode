import type {
  ComputerUseRuntime,
  ComputerUseRuntimeOptions,
} from "./index.js";

/** @trycua/cua-driver 提供原生驱动 build 的平台集合。 */
export declare const CUA_DRIVER_SUPPORTED_PLATFORMS: ReadonlyArray<NodeJS.Platform>;

/** 进程内开源驱动运行时。options.loadDriver 仅供回归测试注入假驱动。 */
export declare function createCuaDriverRuntime(
  options?: ComputerUseRuntimeOptions & {
    loadDriver?: (platform?: NodeJS.Platform) => Promise<unknown>;
  },
): ComputerUseRuntime;
