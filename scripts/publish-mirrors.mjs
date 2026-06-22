// 半自动镜像发布：把 dist-package/ 的 duoduo.exe + version.json 同步到
//   1) Gitee Release（需 GITEE_TOKEN）；
//   2) Gitee 仓库 master 的 version.json（供 raw 链接，更新器查版本用）；
//   3) 自建服务器（scp，需 DUODUO_SERVER_SCP 指向目标目录）。
//
// 用法：先 pnpm app:build（产出 dist-package/），再 GITEE_TOKEN=xxx \
//   DUODUO_SERVER_SCP=user@host:/var/www/duoduo pnpm publish:mirrors
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist-package");
const exe = join(dist, "duoduo.exe");
const manifest = join(dist, "version.json");

for (const f of [exe, manifest]) {
  if (!existsSync(f)) {
    console.error(`✗ 缺产物：${f}\n  先运行 pnpm app:build。`);
    process.exit(1);
  }
}
const { version } = JSON.parse(readFileSync(manifest, "utf-8"));
const tag = `v${version}`;
const OWNER = "wuguanwen28";
const REPO = "duoduo";

// —— 1) Gitee Release：创建 release（若不存在）并上传 exe + version.json ——
const giteeToken = process.env.GITEE_TOKEN;
if (giteeToken) {
  console.log("→ 同步 Gitee Release...");
  // 创建 release（已存在会返回错误，忽略即可）。
  await fetch(`https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: giteeToken,
      tag_name: tag,
      name: tag,
      body: `duoduo ${tag}`,
      target_commitish: "master",
    }),
  }).then((r) => r.text()).then((t) => console.log("  release:", t.slice(0, 80)));
  // 上传资产用 multipart；Gitee v5 附件接口按 release id，需先查 id。
  // 简化：用 form-data 走 attach_files 接口（按 release tag 查 id）。
  const rel = await fetch(
    `https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases/tags/${tag}?access_token=${giteeToken}`,
  ).then((r) => r.json());
  for (const file of [exe, manifest]) {
    const fd = new FormData();
    fd.append("access_token", giteeToken);
    fd.append("file", new Blob([readFileSync(file)]), file.split(/[\\/]/).pop());
    const up = await fetch(
      `https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases/${rel.id}/attach_files`,
      { method: "POST", body: fd },
    );
    console.log(`  上传 ${file.split(/[\\/]/).pop()}: HTTP ${up.status}`);
  }
} else {
  console.warn("⚠ 未设 GITEE_TOKEN，跳过 Gitee Release。");
}

// —— 2) Gitee 仓库 master 的 version.json（raw 链接源）——
console.log("→ 更新仓库内 version.json（供 raw 链接）...");
copyFileSync(manifest, join(root, "version.json"));
const git = (args) => execFileSync("git", args, { cwd: root, stdio: "inherit" });
try {
  git(["add", "version.json"]);
  git(["commit", "-m", `chore: 更新 version.json 至 ${tag}\n\nchangelog: ignore`]);
  git(["push", "origin", "master"]); // origin = gitee
} catch {
  console.warn("⚠ version.json 无改动或推送失败，按需手动处理。");
}

// —— 3) 服务器 scp ——
const scpTarget = process.env.DUODUO_SERVER_SCP;
if (scpTarget) {
  console.log(`→ scp 到服务器 ${scpTarget} ...`);
  // 约定服务器目录结构：<target>/version.json 与 <target>/v<ver>/duoduo.exe
  execFileSync("ssh", [scpTarget.split(":")[0], `mkdir -p ${scpTarget.split(":")[1]}/v${version}`], { stdio: "inherit" });
  execFileSync("scp", [manifest, `${scpTarget}/version.json`], { stdio: "inherit" });
  execFileSync("scp", [exe, `${scpTarget}/v${version}/duoduo.exe`], { stdio: "inherit" });
} else {
  console.warn("⚠ 未设 DUODUO_SERVER_SCP，跳过服务器同步。");
}

console.log("\n✅ 镜像发布完成（已跳过的源见上方警告）。");
