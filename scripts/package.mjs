// 打包脚本：把 release exe 与 resources/ 收集到一个文件夹，压成绿色版 zip。
//
// 设计上 resources/ 必须与 exe 同级、可被用户替换，所以不能塞进 exe；
// 这里在 tauri build 之后，把两者收集到 dist-package/duoduo/ 再压成
// dist-package/duoduo-<版本>-windows.zip。解压即用，换猫只改 resources/。
//
// 用法：pnpm run pack（见 package.json 的 "pack" 脚本，会先 app:build 再跑本脚本）。
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  readFileSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exePath = join(root, "src-tauri", "target", "release", "duoduo.exe");
const resourcesDir = join(root, "resources");

// 读版本号（用于 zip 文件名）。
const version = JSON.parse(
  readFileSync(join(root, "package.json"), "utf-8"),
).version;

// 前置检查。
if (!existsSync(exePath)) {
  console.error(`✗ 找不到 exe：${exePath}\n  请先运行 pnpm app:build（或 pnpm run pack 会自动构建）。`);
  process.exit(1);
}
if (!existsSync(resourcesDir)) {
  console.error(`✗ 找不到 resources/：${resourcesDir}`);
  process.exit(1);
}

// 准备输出目录：dist-package/duoduo/（每次清空重建）。
const outRoot = join(root, "dist-package");
const stageDir = join(outRoot, "duoduo");
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// 收集 exe 与 resources。
cpSync(exePath, join(stageDir, "duoduo.exe"));
cpSync(resourcesDir, join(stageDir, "resources"), { recursive: true });
console.log(`✓ 已收集：duoduo.exe + resources/ → ${stageDir}`);

// 压成 zip（Windows 自带 PowerShell 的 Compress-Archive）。
const zipPath = join(outRoot, `duoduo-${version}-windows.zip`);
rmSync(zipPath, { force: true });
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${stageDir}' -DestinationPath '${zipPath}' -Force`,
  ],
  { stdio: "inherit" },
);

console.log(`\n✅ 打包完成：${zipPath}`);
console.log(`   解压后得到 duoduo/，内含 duoduo.exe 与 resources/，双击 exe 即用。`);
