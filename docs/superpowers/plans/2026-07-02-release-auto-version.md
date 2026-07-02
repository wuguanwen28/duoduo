# Release Auto Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm release` support npm-version-style automatic version increments while preserving explicit version releases.

**Architecture:** Keep all release orchestration in `scripts/release.mjs`. Add a small argument resolver before existing validation so the rest of the script continues to receive one concrete `version` and `tag` value.

**Tech Stack:** Node.js ESM script, JSON file parsing, existing git-cliff release flow.

## Global Constraints

- Only modify `scripts/release.mjs` for runtime behavior.
- Keep existing release flow: clean worktree check, version sync, git-cliff changelog, release commit, tag, push to `github`, best-effort push to `origin`.
- Supported arguments: no arg or `patch`, `minor`, `major`, or explicit `x.y.z`.
- Default no-arg behavior is `patch`.
- `minor` resets patch to `0`; `major` resets minor and patch to `0`.
- Do not add dependencies.

---

## File Structure

- Modify: `scripts/release.mjs`
  - Update usage comments.
  - Add `readPackageVersion()` helper.
  - Add `resolveVersion(input)` helper that returns a concrete `x.y.z` string.
  - Keep all downstream release logic unchanged after `version` and `tag` are resolved.

---

### Task 1: Add automatic version resolution to release script

**Files:**
- Modify: `scripts/release.mjs`

**Interfaces:**
- Consumes: current `package.json` root `version` string.
- Produces: existing `version: string` and `tag: string` variables used by current release flow.

- [ ] **Step 1: Update usage comments**

Replace the top usage comment in `scripts/release.mjs` with:

```js
// 用法：
//   pnpm release            # 自动递增 patch，如 0.2.2 → 0.2.3
//   pnpm release patch      # 自动递增 patch
//   pnpm release minor      # 自动递增 minor，并把 patch 归 0
//   pnpm release major      # 自动递增 major，并把 minor/patch 归 0
//   pnpm release 0.3.5      # 手动指定精确版本号
```

- [ ] **Step 2: Replace direct `version` assignment with resolver**

Replace:

```js
const version = process.argv[2];
const tag = `v${version}`;
```

with:

```js
const releaseArg = process.argv[2] || 'patch';
const version = resolveVersion(releaseArg);
const tag = `v${version}`;
```

- [ ] **Step 3: Add helpers before validation block**

Insert these helpers before `// 1) 校验。`:

```js
function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  const current = packageJson.version;
  if (!/^\d+\.\d+\.\d+$/.test(current)) {
    console.error(`✗ package.json 当前版本号不支持自动递增：${current}`);
    console.error('  请先改成 x.y.z 格式，或使用 pnpm release x.y.z 手动指定。');
    process.exit(1);
  }
  return current;
}

function bumpVersion(current, level) {
  const [major, minor, patch] = current.split('.').map(Number);
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  if (level === 'major') return `${major + 1}.0.0`;
  throw new Error(`未知递增类型：${level}`);
}

function resolveVersion(input) {
  if (/^\d+\.\d+\.\d+$/.test(input)) return input;
  if (['patch', 'minor', 'major'].includes(input)) {
    return bumpVersion(readPackageVersion(), input);
  }

  console.error('✗ 用法：');
  console.error('  pnpm release            # 自动递增 patch');
  console.error('  pnpm release patch      # 自动递增 patch');
  console.error('  pnpm release minor      # 自动递增 minor，并把 patch 归 0');
  console.error('  pnpm release major      # 自动递增 major，并把 minor/patch 归 0');
  console.error('  pnpm release 0.3.5      # 手动指定精确版本号');
  process.exit(1);
}
```

- [ ] **Step 4: Simplify existing validation**

Replace existing validation:

```js
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("✗ 用法：pnpm release <版本号>，如 pnpm release 0.2.0");
  process.exit(1);
}
```

with:

```js
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`✗ 解析后的版本号无效：${version}`);
  process.exit(1);
}
```

- [ ] **Step 5: Verify script syntax**

Run:

```bash
node --check scripts/release.mjs
```

Expected: no output and exit code 0.

- [ ] **Step 6: Verify diff is scoped**

Run:

```bash
git diff -- scripts/release.mjs
```

Expected: only usage comments and argument/version resolution logic changed.

- [ ] **Step 7: Commit**

Run:

```bash
git add scripts/release.mjs docs/superpowers/plans/2026-07-02-release-auto-version.md
git commit -m "feat: release 支持自动递增版本号" -m "pnpm release 默认递增 patch，并支持 patch/minor/major 与精确版本号，保持原有发版流程不变。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Expected: one commit containing the release script change and this plan.

---

## Self-Review

- Spec coverage: The plan covers default patch, explicit patch/minor/major, explicit x.y.z, reset rules, no new dependency, and preserving existing release flow.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: `resolveVersion(input)`, `bumpVersion(current, level)`, and `readPackageVersion()` are defined before use and all return concrete version strings except process-exit branches.
