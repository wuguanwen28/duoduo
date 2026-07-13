// 从 CHANGELOG.md 提取指定版本的段落，输出到 stdout（供 CI 用作 release 说明）。
//
// 用法：node scripts/extract-changelog.mjs 0.1.0   （传版本号，不带 v）
// 约定 CHANGELOG.md 每个版本段以 "## [版本号]" 开头，到下一个 "## " 或文件结束。
// 取不到对应段时回退为提示文字（不报错，避免阻断发布）。
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 版本号去掉可能的前导 v。
const version = (process.argv[2] || '').replace(/^v/, '')

let body = ''
try {
  const md = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8')
  const lines = md.split(/\r?\n/)
  // 找到 "## [<version>]" 这一行。
  const start = lines.findIndex((l) =>
    new RegExp(`^##\\s*\\[${version.replace(/\./g, '\\.')}\\]`).test(l),
  )
  if (start !== -1) {
    // 从该标题的下一行起，收集到下一个 "## " 标题或文件末尾。
    const rest = []
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) break
      rest.push(lines[i])
    }
    body = rest.join('\n').trim()
  }
} catch {
  // 读不到文件：保持 body 为空，走下方回退。
}

if (!body) {
  body = `详见 CHANGELOG.md（v${version}）。`
}
process.stdout.write(body + '\n')
