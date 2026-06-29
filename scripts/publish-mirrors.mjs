// 注意：发版流程已接入 server 端自动同步（server/server/api/webhooks/github-release.post.ts）。
// 本脚本保留作为灾备/兜底，正常发版无需再手动运行。
//
// 半自动镜像发布（方案 A：以 GitHub Release 为唯一构建源）。
//
// 为什么不读本地 dist-package/：同一版本在 CI 与本机各构建一次会得到不同的
// 二进制（嵌入路径/时间戳不同）→ sha256 不一致。更新器是「版本查一个源、exe
// 下另一个源」地 fallback 的，跨源就会校验失败。所以这里只认 GitHub Release
// 上 CI 产出的那一份，下载下来再原样转发到 Gitee 与服务器，保证三源 sha256 一致。
//
// 流程：
//   0) 从 package.json 读版本号 → tag = v<版本>；
//   1) 从 GitHub Release 下载 version.json + duoduo.exe 到 dist-mirror/；
//   2) 用 version.json 里的 sha256 校验下载的 exe（确保拿到一致的一对）；
//   3) 上传这一对到 Gitee Release（需 GITEE_TOKEN）；
//   4) 把 version.json 提交到 Gitee 仓库 master（供 raw 链接给更新器查版本）；
//   5) scp 这一对到自建服务器（需 DUODUO_SERVER_SCP）。
//
// 用法：发版打 tag 后，等 GitHub Actions 跑完（Release 已就绪），再：
//   GITEE_TOKEN=xxx DUODUO_SERVER_SCP=user@host:/var/www/duoduo pnpm publish:mirrors
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "wuguanwen28";
const REPO = "duoduo";

// 0) 版本号取自 package.json（pnpm release 已同步）。
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const tag = `v${version}`;

// 中转目录：每次清空重建。
const mirrorDir = join(root, "dist-mirror");
rmSync(mirrorDir, { recursive: true, force: true });
mkdirSync(mirrorDir, { recursive: true });
const exe = join(mirrorDir, "duoduo.exe");
const manifest = join(mirrorDir, "version.json");

/** 从 URL 下载到本地文件（跟随重定向，node fetch 默认即跟随）。 */
async function download(url, dest) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`下载失败 HTTP ${resp.status}：${url}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(dest, buf);
  return buf;
}

// 1) 从 GitHub Release 下载唯一构建产物。
const base = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}`;
console.log(`→ 从 GitHub Release ${tag} 下载唯一构建产物...`);
try {
  await download(`${base}/version.json`, manifest);
  await download(`${base}/duoduo.exe`, exe);
} catch (e) {
  console.error(
    `✗ ${e.message}\n  请确认 GitHub Actions 已跑完且 Release ${tag} 含 duoduo.exe / version.json。`,
  );
  process.exit(1);
}

// 2) 用 version.json 的 sha256 校验下载的 exe（确保是一致的一对）。
const meta = JSON.parse(readFileSync(manifest, "utf-8"));
const actual = createHash("sha256").update(readFileSync(exe)).digest("hex");
if (actual.toLowerCase() !== String(meta.exe?.sha256 || "").toLowerCase()) {
  console.error(
    `✗ 下载的 exe 与 version.json 的 sha256 不一致：\n  exe=${actual}\n  json=${meta.exe?.sha256}`,
  );
  process.exit(1);
}
console.log(`✓ 已下载并校验：duoduo.exe + version.json（sha256=${actual.slice(0, 12)}…）`);

// 3) Gitee Release：创建（若不存在）并上传 exe + version.json。
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
  })
    .then((r) => r.text())
    .then((t) => console.log("  release:", t.slice(0, 80)));
  // 按 tag 查 release id，再逐个 attach_files 上传。
  const rel = await fetch(
    `https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases/tags/${tag}?access_token=${giteeToken}`,
  ).then((r) => r.json());
  if (!rel || !rel.id) {
    console.warn(`⚠ 未取得 Gitee release id（token 失效或 release 创建失败？）：${JSON.stringify(rel).slice(0, 120)}`);
  } else {
    for (const file of [exe, manifest]) {
      const name = file.split(/[\\/]/).pop();
      const fd = new FormData();
      fd.append("access_token", giteeToken);
      fd.append("file", new Blob([readFileSync(file)]), name);
      const up = await fetch(
        `https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases/${rel.id}/attach_files`,
        { method: "POST", body: fd },
      );
      console.log(`  上传 ${name}: HTTP ${up.status}`);
    }
  }
} else {
  console.warn("⚠ 未设 GITEE_TOKEN，跳过 Gitee Release。");
}

// 4) Gitee 仓库 master 的 version.json（raw 链接源，更新器查版本用）。
console.log("→ 更新仓库内 version.json（供 raw 链接）...");
copyFileSync(manifest, join(root, "version.json"));
const git = (args) => execFileSync("git", args, { cwd: root, stdio: "inherit" });
try {
  git(["add", "version.json"]);
  git(["commit", "-m", `chore: 更新 version.json 至 ${tag}\n\nchangelog: ignore`]);
  git(["push", "origin", "master"]); // origin = gitee
  console.log("  已提交并推送 version.json 到 gitee master。");
} catch {
  console.warn("⚠ version.json 无改动 / 提交 / 推送失败，请按需手动处理（git status 查看）。");
}

// 5) 服务器 scp：约定 <target>/version.json 与 <target>/v<版本>/duoduo.exe。
const scpTarget = process.env.DUODUO_SERVER_SCP;
if (scpTarget) {
  console.log(`→ scp 到服务器 ${scpTarget} ...`);
  const sep = scpTarget.indexOf(":");
  const host = scpTarget.slice(0, sep);
  const path = scpTarget.slice(sep + 1);
  execFileSync("ssh", [host, `mkdir -p ${path}/v${version}`], { stdio: "inherit" });
  execFileSync("scp", [manifest, `${scpTarget}/version.json`], { stdio: "inherit" });
  execFileSync("scp", [exe, `${scpTarget}/v${version}/duoduo.exe`], { stdio: "inherit" });
} else {
  console.warn("⚠ 未设 DUODUO_SERVER_SCP，跳过服务器同步。");
}

console.log("\n✅ 镜像发布完成（已跳过的源见上方警告）。三源现服务同一份 GitHub 构建产物。");
