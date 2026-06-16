// 一键发版脚本：同步版本号 → 生成 CHANGELOG → 提交打标签 → 推送（触发 CI 构建+发布）。
//
// 用法：pnpm release <版本号>，如 pnpm release 0.2.0
//
// 它会：
//   1. 校验版本号格式、工作区干净；
//   2. 把 package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml 三处版本同步成新号；
//   3. 用 git-cliff 把未发布提交归到新版本，更新 CHANGELOG.md（失败则跳过，CI 仍会生成发行说明）；
//   4. git commit "chore: release vX.Y.Z" + 打标签；
//   5. 推送 master 与标签到 github（触发 GitHub Actions 构建 zip 并发布 Release），并尽力同步到 gitee。
import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
const tag = `v${version}`;

// 在仓库根目录跑 git（数组参数，安全）。
const git = (args, opts = {}) =>
  execFileSync("git", args, { cwd: root, encoding: "utf-8", ...opts });

// 1) 校验。
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("✗ 用法：pnpm release <版本号>，如 pnpm release 0.2.0");
  process.exit(1);
}
if (git(["status", "--porcelain"]).trim()) {
  console.error("✗ 工作区有未提交改动，请先提交或暂存，再发版。");
  process.exit(1);
}
// 标签不能重复。
const tags = git(["tag", "--list"]).split(/\r?\n/);
if (tags.includes(tag)) {
  console.error(`✗ 标签 ${tag} 已存在。`);
  process.exit(1);
}

// 2) 同步三处版本号（正则只替换首个版本字段）。
function bump(file, regex) {
  const p = join(root, file);
  let c = readFileSync(p, "utf-8");
  if (!regex.test(c)) {
    console.error(`✗ ${file} 未找到版本字段`);
    process.exit(1);
  }
  c = c.replace(regex, (m) => m.replace(/\d+\.\d+\.\d+(-[\w.]+)?/, version));
  writeFileSync(p, c);
  console.log(`✓ ${file} → ${version}`);
}
bump("package.json", /"version":\s*"[^"]*"/);
bump("src-tauri/tauri.conf.json", /"version":\s*"[^"]*"/);
bump("src-tauri/Cargo.toml", /version\s*=\s*"[^"]*"/);

// 3) 增量更新 CHANGELOG：仅当已有更早的版本标签时，才把「上个标签之后的新提交」
//    插到 CHANGELOG.md 顶部（--unreleased --prepend，保留已有手写历史段，绝不覆盖）。
//    首个版本（无任何前序标签）跳过——约定首版 CHANGELOG 由人工撰写。
const priorTags = git(["tag", "--list", "v*"])
  .split(/\r?\n/)
  .filter((t) => t && t !== tag);
if (priorTags.length === 0) {
  console.log("→ 首个版本：保留手写 CHANGELOG.md，不自动生成。");
} else {
  console.log("→ 增量更新 CHANGELOG.md（仅新提交，保留历史）...");
  try {
    execSync(`npx -y git-cliff --tag ${tag} --unreleased --prepend CHANGELOG.md`, {
      cwd: root,
      stdio: "inherit",
    });
  } catch {
    console.warn("⚠ git-cliff 生成失败，跳过本地 CHANGELOG（CI 仍会生成 Release 说明）。");
  }
}

// 4) 提交并打标签。
git(["add", "-A"]);
git(["commit", "-m", `chore: release ${tag}`], { stdio: "inherit" });
git(["tag", tag], { stdio: "inherit" });
console.log(`✓ 已提交并打标签 ${tag}`);

// 5) 推送：github 触发 CI；gitee 尽力同步。
console.log("→ 推送到 github（触发 CI 构建 + 发布 Release）...");
git(["push", "github", "master"], { stdio: "inherit" });
git(["push", "github", tag], { stdio: "inherit" });
try {
  git(["push", "origin", "master"], { stdio: "inherit" });
  git(["push", "origin", tag], { stdio: "inherit" });
} catch {
  console.warn("⚠ 推送 gitee 失败（不影响 GitHub 发布），可稍后手动 git push origin master --tags。");
}

console.log(`\n✅ 发版完成 ${tag}！去 GitHub 的 Actions 看构建，完成后 Releases 页面会有 zip + 分类日志。`);
