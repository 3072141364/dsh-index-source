#!/usr/bin/env node
/**
 * 从 npm registry 同步 index.json 的版本列表。
 *
 * 默认只补「最新稳定版」，已声明的手工条目原样保留（含你自己写的 engines 和排序键）。
 * 预发布版本默认跳过，需要时加 --include-prerelease。
 *
 * 用法：
 *   node sync.mjs --dry-run          # 只打印将要发生的变更
 *   node sync.mjs                    # 写回 index.json
 *   node sync.mjs --keep 5           # 每个插件最多保留 5 个最新版本
 *   node sync.mjs --file other.json
 *
 * 不处理 git 源（需要解析 tag 和 commit，留给人工）。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { SEMVER, compareSemver, isPrerelease, isSemverRange } from './semver.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const file = path.resolve(option('file', path.join(path.dirname(new URL(import.meta.url).pathname), 'index.json')))
const keep = Number(option('keep', 0))
const dryRun = flag('dry-run')
const includePrerelease = flag('include-prerelease')
const timeoutMs = Number(option('timeout', 20000))

const readJson = async (url) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json', 'user-agent': 'dsh-index-sync' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  return response.json()
}

const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
const changes = []
let attempted = 0
let failures = 0

for (const plugin of doc.plugins ?? []) {
  const npmVersions = plugin.versions.filter((v) => v.source?.type === 'npm')
  const hasGit = plugin.versions.some((v) => v.source?.type === 'git')
  if (npmVersions.length === 0) {
    if (hasGit) console.log(`- ${plugin.name}: git 源，跳过（请手动钉 commit）`)
    continue
  }

  attempted += 1
  const registry = npmVersions.find((v) => v.source.registry)?.source.registry ?? 'https://registry.npmjs.org'
  const metaUrl = `${registry.replace(/\/+$/u, '')}/${plugin.name}`
  let meta
  try {
    meta = await readJson(metaUrl)
  } catch (error) {
    failures += 1
    console.error(`! ${plugin.name}: 读取 ${metaUrl} 失败（${error.message}）`)
    continue
  }

  const times = meta.time ?? {}
  const declared = new Set(plugin.versions.map((v) => v.version))
  // 只向前补：比已声明的最高版本更新的版本，避免把历史上的旧版本回填进来
  const highest = [...declared].sort((left, right) => compareSemver(right, left))[0]
  const candidates = Object.keys(meta.versions ?? {})
    .filter((version) => SEMVER.test(version) && typeof times[version] === 'string')
    .filter((version) => includePrerelease || !isPrerelease(version))
    .filter((version) => !declared.has(version))
    .filter((version) => compareSemver(version, highest) > 0)
    .sort((left, right) => Date.parse(times[right]) - Date.parse(times[left]))

  // 默认只补最新一个稳定版；--all 时补全部更新的版本
  const selected = flag('all') ? candidates : candidates.slice(0, 1)

  for (const version of selected) {
    const manifest = meta.versions[version] ?? {}
    const engines = isSemverRange(manifest.engines?.dsh) ? { dsh: manifest.engines.dsh } : {}
    const source = { type: 'npm' }
    if (npmVersions[0].source.registry) source.registry = npmVersions[0].source.registry
    plugin.versions.push({
      version,
      publishTimestamp: Math.floor(Date.parse(times[version]) / 1000),
      source,
      engines,
    })
    changes.push(`${plugin.name} +${version}`)
  }

  if (keep > 0) {
    const sorted = [...plugin.versions].sort((left, right) => compareSemver(right.version, left.version))
    const dropped = sorted.slice(keep)
    if (dropped.length > 0) {
      plugin.versions = sorted.slice(0, keep)
      for (const version of dropped) changes.push(`${plugin.name} -${version.version}（超出 --keep ${keep}）`)
    } else {
      plugin.versions = sorted
    }
  } else {
    plugin.versions.sort((left, right) => compareSemver(right.version, left.version))
  }
}

// 单个包读失败只告警（可能被撤包或临时故障）；全部失败才判定为系统性故障。
// --strict 时任何失败都返回非零。
const failed = failures > 0 && (flag('strict') || (attempted > 0 && failures === attempted))

if (changes.length === 0) {
  console.log('没有需要同步的版本。')
  if (failures > 0) console.warn(`${failures}/${attempted} 个包读取失败`)
  process.exit(failed ? 1 : 0)
}

console.log(dryRun ? `将发生 ${changes.length} 处变更：` : `已更新 ${changes.length} 处：`)
for (const change of changes) console.log(`  ${change}`)

if (!dryRun) {
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
  console.log(`已写入 ${file}`)
}
if (failures > 0) console.warn(`${failures}/${attempted} 个包读取失败`)
process.exit(failed ? 1 : 0)
