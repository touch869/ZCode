#!/usr/bin/env node

import process from "node:process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareWindowsCuaHelperAssets,
  resolveWindowsCuaHelperSourceRoot,
} from "./windows-cua-helper-assets.mjs";
import { getTargetPlatform } from "./target-platform.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopPackageRoot = resolve(scriptDir, "..");
const servicesPackageRoot = resolve(desktopPackageRoot, "..", "services");
const targetPlatform = getTargetPlatform();

if (targetPlatform.os !== "win32") {
  console.log("[prepare-windows-cua-helper] skip unsupported platform");
  process.exit(0);
}

const desktopPackage = JSON.parse(
  await readFile(resolve(desktopPackageRoot, "package.json"), "utf8"),
);
const sourceRoot = await resolveWindowsCuaHelperSourceRoot({
  runtimePackageDir: process.env.ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR,
  devRoot: process.env.ZCODE_CUA_DEV_ROOT,
  servicesPackageRoot,
});
// relay-official：本线 producer 不发布官方 Windows Helper 运行时契约（Computer Use 由
// 进程内 @trycua 驱动提供）。无契约时跳过 Helper 暂存，而不是把它当 producer 回归报错。
const producerManifest = JSON.parse(
  await readFile(resolve(sourceRoot, "package.json"), "utf8"),
);
if (producerManifest.zcodeCuaRuntime === undefined) {
  console.log(
    "[prepare-windows-cua-helper] producer ships no zcodeCuaRuntime contract — " +
      "Computer Use runs via the in-process open driver, skip Helper staging",
  );
  process.exit(0);
}

const result = await prepareWindowsCuaHelperAssets({
  sourceRoot,
  outputRoot: resolve(desktopPackageRoot, "bundled-tools"),
  targetPlatform,
  electronVersion: desktopPackage.devDependencies.electron,
});

console.log(
  `[prepare-windows-cua-helper] staged ${result.manifest.packageVersion} ${result.manifest.platform}/${result.manifest.arch} PE=0x${result.peMachine.toString(16)} -> ${result.outputDir}`,
);
