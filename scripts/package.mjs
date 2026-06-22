// 打包脚本：把 release exe 与 resources/ 收集到一个文件夹，压成绿色版 zip。
//
// 设计上 resources/ 必须与 exe 同级、可被用户替换，所以不能塞进 exe；
// 这里在 tauri build 之后，把两者收集到 dist-package/duoduo/ 再压成
// dist-package/duoduo-<版本>-windows.zip。解压即用，换猫只改 resources/。
//
// 用法：pnpm app:build 会自动在 tauri build 之后串联运行本脚本；
// 也可单独跑 pnpm pack:only（已 build 过、只想重新压 zip 时）。
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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

// 1) 整合 zip（新手一站式）：dist-package/duoduo-<版本>-full.zip
const fullZip = join(outRoot, `duoduo-${version}-full.zip`);
rmSync(fullZip, { force: true });
execFileSync("powershell", [
  "-NoProfile", "-Command",
  `Compress-Archive -Path '${stageDir}' -DestinationPath '${fullZip}' -Force`,
], { stdio: "inherit" });

// 2) 裸 exe（热更新目标）：dist-package/duoduo.exe
const bareExe = join(outRoot, "duoduo.exe");
rmSync(bareExe, { force: true });
cpSync(join(stageDir, "duoduo.exe"), bareExe);

// 3) 资源 zip：dist-package/duoduo-resources.zip
const resZip = join(outRoot, "duoduo-resources.zip");
rmSync(resZip, { force: true });
execFileSync("powershell", [
  "-NoProfile", "-Command",
  `Compress-Archive -Path '${join(stageDir, "resources")}' -DestinationPath '${resZip}' -Force`,
], { stdio: "inherit" });

// 4) version.json（含裸 exe 的 sha256 + 大小）。notes 取 CHANGELOG 顶部版本段（缺失则空）。
const exeBytes = readFileSync(bareExe);
const sha256 = createHash("sha256").update(exeBytes).digest("hex");
const size = statSync(bareExe).size;
let notes = "";
try {
  const cl = readFileSync(join(root, "CHANGELOG.md"), "utf-8");
  // 取第一个 "## [" 段到下一个 "## [" 之间的内容作为更新说明。
  const segs = cl.split(/^## \[/m);
  if (segs[1]) notes = "## [" + segs[1].split(/^## \[/m)[0].trim();
} catch { /* 无 CHANGELOG 时留空 */ }

const manifest = {
  version,
  notes,
  pubDate: new Date().toISOString().slice(0, 10),
  exe: { name: "duoduo.exe", size, sha256 },
};
const manifestPath = join(outRoot, "version.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`\n✅ 产物：`);
console.log(`   ${fullZip}`);
console.log(`   ${bareExe}`);
console.log(`   ${resZip}`);
console.log(`   ${manifestPath}（sha256=${sha256.slice(0, 12)}…）`);
