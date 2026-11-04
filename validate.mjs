#!/usr/bin/env node
/**
 * 校验 DSH 插件市场索引（format 1）。
 *
 * 规则逐条对应 DSH 内置的 @deepseek-ai/dsh-plugin-market-index（0.2.x），
 * 零依赖，方便在没有装 DSH 的机器上跑（CI、发布前预检）。
 *
 * 用法：
 *   node validate.mjs                     # 校验同目录 index.json
 *   node validate.mjs other.json          # 校验指定文件
 *   node validate.mjs --url https://x/i.json
 *   node validate.mjs --print             # 校验通过后打印归一化结果
 *
 * 与官方实现的唯一差异：engines.dsh 的 SemVer range 只做语法体检（见 isRange），
 * 安装时 DSH 仍会用真正的 semver 再判一次兼容性。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { SEMVER, compareSemver, isSemverRange } from './semver.mjs'

const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const PACKAGE_NAME_MAX_LENGTH = 214
const COMMIT = /^[0-9a-f]{40}$/u
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u
const DATA_ICON = /^data:(?:image\/svg\+xml|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]*={0,2})$/u
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const MAX_INLINE_ICON_BYTES = 32 * 1024
const MAX_PUBLISH_TIMESTAMP = 1e11

const args = process.argv.slice(2)
let file = path.join(path.dirname(new URL(import.meta.url).pathname), 'index.json')
let indexUrl = 'https://example.com/index.json'
let print = false
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--url') indexUrl = args[++i]
  else if (arg === '--print') print = true
  else if (arg === '--help' || arg === '-h') {
    console.log('node validate.mjs [index.json] [--url <索引 URL>] [--print]')
    process.exit(0)
  } else file = arg
}

const errors = []
const fail = (at, reason) => errors.push(`${at} ${reason}`)

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const objectAt = (v, at) => {
  if (!isObject(v)) {
    fail(at, '必须是一个对象')
    return undefined
  }
  return v
}
const stringAt = (v, at) => {
  if (typeof v !== 'string' || v.trim() === '') {
    fail(at, '必须是非空白字符串')
    return undefined
  }
  return v
}
const optional = (obj, key, at, read) => (Object.hasOwn(obj, key) ? read(obj[key], `${at}.${key}`) : undefined)

function localizedText(value, at) {
  if (typeof value === 'string') return stringAt(value, at)
  const object = objectAt(value, at)
  if (object === undefined) return undefined
  let ok = true
  for (const [language, member] of Object.entries(object)) {
    if (!LANGUAGE_ID.test(language)) {
      fail(`${at}.${language}`, '语言键必须是小写语言 id（如 en、zh、zh-cn）')
      ok = false
    }
    if (typeof member !== 'string' || member.trim() === '') {
      fail(`${at}.${language}`, '必须是该语言的非空白文案')
      ok = false
    }
  }
  if (!Object.hasOwn(object, 'en')) {
    fail(at, '必须包含 en 文案')
    ok = false
  }
  return ok ? object : undefined
}

function declarations(value, at, read) {
  const object = objectAt(value, at)
  if (object === undefined) return undefined
  const result = {}
  for (const [id, member] of Object.entries(object)) {
    if (id === '') fail(at, '不能声明空 id')
    const memberAt = `${at}.${id}`
    const obj = objectAt(member, memberAt)
    if (obj !== undefined) result[id] = read(obj, memberAt)
  }
  return result
}

function indexMetadata(value) {
  if (value === undefined) return { categories: {}, labels: {}, sortKeys: {} }
  const object = objectAt(value, '$.metadata')
  if (object === undefined) return { categories: {}, labels: {}, sortKeys: {} }
  const categories = optional(object, 'categories', '$.metadata', (v, at) =>
    declarations(v, at, (obj, memberAt) => ({ title: localizedText(obj.title, `${memberAt}.title`) })),
  )
  const labels = optional(object, 'labels', '$.metadata', (v, at) =>
    declarations(v, at, (obj, memberAt) => ({ title: localizedText(obj.title, `${memberAt}.title`) })),
  )
  const sortKeys = optional(object, 'sortKeys', '$.metadata', (v, at) =>
    declarations(v, at, (obj, memberAt) => {
      if (obj.order !== 'asc' && obj.order !== 'desc') fail(`${memberAt}.order`, '必须是 "asc" 或 "desc"')
      return { title: localizedText(obj.title, `${memberAt}.title`), order: obj.order }
    }),
  )
  return { categories: categories ?? {}, labels: labels ?? {}, sortKeys: sortKeys ?? {} }
}

function declaredId(value, at, declared, what) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(at, '必须是非空白字符串')
    return undefined
  }
  if (!Object.hasOwn(declared, value)) fail(at, `引用了未声明的${what} id "${value}"`)
  return value
}

function pluginMetadata(value, at, index) {
  if (value === undefined) return { keywords: [], labels: [], sortKeys: {} }
  const object = objectAt(value, at)
  if (object === undefined) return { keywords: [], labels: [], sortKeys: {} }

  const category = optional(object, 'category', at, (v, memberAt) => declaredId(v, memberAt, index.categories, '分类'))
  const keywords = optional(object, 'keywords', at, (v, memberAt) => {
    if (!Array.isArray(v)) {
      fail(memberAt, '必须是字符串数组')
      return []
    }
    return v.map((keyword, i) => {
      if (typeof keyword !== 'string') fail(`${memberAt}[${i}]`, '必须是字符串')
      return keyword
    })
  }) ?? []
  const labels = optional(object, 'labels', at, (v, memberAt) => {
    if (!Array.isArray(v)) {
      fail(memberAt, '必须是数组')
      return []
    }
    const ids = v.map((label, i) => declaredId(label, `${memberAt}[${i}]`, index.labels, '标签'))
    if (new Set(ids).size !== ids.length) fail(memberAt, '不能重复声明同一个标签')
    return ids
  }) ?? []
  const sortKeys = optional(object, 'sortKeys', at, (v, memberAt) => {
    const values = {}
    for (const [id, sortValue] of Object.entries(objectAt(v, memberAt) ?? {})) {
      declaredId(id, `${memberAt}.${id}`, index.sortKeys, '排序键')
      if (typeof sortValue !== 'number' || !Number.isFinite(sortValue)) fail(`${memberAt}.${id}`, '必须是有限数字')
      values[id] = sortValue
    }
    return values
  }) ?? {}

  return {
    ...(category === undefined ? {} : { category }),
    keywords,
    labels,
    sortKeys,
  }
}

function httpUrl(value, at, protocols, extra) {
  const text = stringAt(value, at)
  if (text === undefined) return undefined
  let url
  try {
    url = new URL(text)
  } catch {
    fail(at, '必须是绝对 URL')
    return undefined
  }
  if (!protocols.includes(url.protocol)) fail(at, `必须使用 ${protocols.join(' 或 ')}`)
  if (url.username !== '' || url.password !== '') fail(at, '不能包含凭据')
  if (url.href.includes('?') || url.href.includes('#')) fail(at, '不能包含 query 或 fragment')
  if (extra?.canonical && url.href !== text) fail(at, '必须是规范化的 URL 写法（不能有冗余字符）')
  return url
}

function packagePath(value, at) {
  const text = stringAt(value, at)
  if (text === undefined) return undefined
  if (text.split('/').some((segment) => segment === '.' || segment === '..' || !PATH_SEGMENT.test(segment))) {
    fail(at, '必须是 ._@+- 字符组成的相对目录，且不能含 . 或 ..')
    return undefined
  }
  return text
}

function source(value, at) {
  const object = objectAt(value, at)
  if (object === undefined) return undefined
  if (object.type === 'npm') {
    const registry = optional(object, 'registry', at, (v, memberAt) => httpUrl(v, memberAt, ['https:', 'http:'])?.href)
    return { type: 'npm', ...(registry === undefined ? {} : { registry }) }
  }
  if (object.type === 'git') {
    const commit = stringAt(object.commit, `${at}.commit`)
    if (commit !== undefined && !COMMIT.test(commit)) fail(`${at}.commit`, '必须是 40 位小写十六进制 commit SHA')
    const url = httpUrl(object.url, `${at}.url`, ['https:'], { canonical: true })
    if (url !== undefined) {
      if (!/^(?:\/[^/]+){2,}$/u.test(url.pathname)) fail(`${at}.url`, '必须指向至少两段路径的仓库')
      if (/\.(?:tgz|tar\.gz)$/iu.test(url.pathname)) fail(`${at}.url`, '必须是仓库地址，不能是 tarball')
    }
    const dir = optional(object, 'path', at, packagePath)
    return { type: 'git', url: url?.href, commit, ...(dir === undefined ? {} : { path: dir }) }
  }
  fail(`${at}.type`, '必须是 "npm" 或 "git"')
  return undefined
}

function engines(value, at) {
  if (!isObject(value)) {
    fail(at, '必须是一个对象')
    return {}
  }
  const dsh = optional(value, 'dsh', at, (v, memberAt) => {
    if (typeof v !== 'string' || v.trim() === '') {
      fail(memberAt, '必须是非空白字符串')
      return undefined
    }
    if (v.startsWith('workspace:')) fail(memberAt, '不能使用 workspace: range')
    else if (!isSemverRange(v)) fail(memberAt, `不像合法的 SemVer range："${v}"（安装时 DSH 会再判一次）`)
    return v
  })
  return dsh === undefined ? {} : { dsh }
}

function icon(value, at, baseUrl) {
  const text = stringAt(value, at)
  if (text === undefined) return undefined
  if (text.startsWith('data:')) {
    const payload = DATA_ICON.exec(text)?.[1]
    if (payload === undefined || payload === '' || !BASE64.test(payload)) {
      fail(at, '必须是 base64 的 SVG/PNG/JPEG/WebP data URL')
      return undefined
    }
    const bytes = (payload.length / 4) * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
    if (bytes > MAX_INLINE_ICON_BYTES) fail(at, `解码后不能超过 ${MAX_INLINE_ICON_BYTES / 1024} KiB`)
    return text
  }
  let resolved
  try {
    resolved = new URL(text, baseUrl)
  } catch {
    fail(at, '必须是 URL 引用')
    return undefined
  }
  if (resolved.protocol !== 'https:' && resolved.origin !== baseUrl.origin) {
    fail(at, '必须解析到 https，或与索引同源')
  }
  return resolved.href
}

function versions(value, at) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(at, '必须是非空数组')
    return []
  }
  const seen = new Set()
  const parsed = []
  value.forEach((member, i) => {
    const memberAt = `${at}[${i}]`
    const object = objectAt(member, memberAt)
    if (object === undefined) return
    const version = stringAt(object.version, `${memberAt}.version`)
    if (version !== undefined) {
      if (!SEMVER.test(version)) fail(`${memberAt}.version`, '必须是精确的 SemVer 版本号')
      if (seen.has(version)) fail(`${memberAt}.version`, `重复声明 ${version}`)
      seen.add(version)
    }
    const publishTimestamp = object.publishTimestamp
    if (
      typeof publishTimestamp !== 'number' ||
      !Number.isInteger(publishTimestamp) ||
      publishTimestamp < 0 ||
      publishTimestamp >= MAX_PUBLISH_TIMESTAMP
    ) {
      fail(`${memberAt}.publishTimestamp`, '必须是 Unix 秒整数，范围 [0, 10^11)')
    }
    const src = source(object.source, `${memberAt}.source`)
    const eng = optional(object, 'engines', memberAt, engines) ?? {}
    parsed.push({ version, publishTimestamp, source: src, engines: eng })
  })
  return parsed.sort((left, right) => compareSemver(right.version, left.version))
}

function plugin(value, at, index, baseUrl) {
  const object = objectAt(value, at)
  if (object === undefined) return undefined
  const name = stringAt(object.name, `${at}.name`)
  if (name !== undefined && (name.length > PACKAGE_NAME_MAX_LENGTH || !PACKAGE_NAME.test(name))) {
    fail(`${at}.name`, '必须是合法的 npm 包名')
  }
  const title = optional(object, 'title', at, localizedText)
  const description = optional(object, 'description', at, localizedText)
  const iconUrl = optional(object, 'icon', at, (v, memberAt) => icon(v, memberAt, baseUrl))
  const author = optional(object, 'author', at, stringAt)
  const homepage = optional(object, 'homepage', at, (v, memberAt) => {
    const text = stringAt(v, memberAt)
    if (text === undefined) return undefined
    if (!URL.canParse(text)) {
      fail(memberAt, '必须是绝对 URL')
      return undefined
    }
    const url = new URL(text)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') fail(memberAt, '必须使用 https: 或 http:')
    return url.href
  })
  const repo = optional(object, 'repository', at, (v, memberAt) => {
    const obj = objectAt(v, memberAt)
    if (obj === undefined) return undefined
    const url = httpUrl(obj.url, `${memberAt}.url`, ['https:', 'http:'])
    const directory = optional(obj, 'directory', memberAt, packagePath)
    return { url: url?.href, ...(directory === undefined ? {} : { directory }) }
  })
  return {
    name,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(iconUrl === undefined ? {} : { icon: iconUrl }),
    ...(author === undefined ? {} : { author }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(repo === undefined ? {} : { repository: repo }),
    metadata: pluginMetadata(object.metadata, `${at}.metadata`, index),
    versions: versions(object.versions, `${at}.versions`),
  }
}

// ---------------------------------------------------------------------------

let raw
try {
  raw = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch (error) {
  console.error(`无法读取或解析 ${file}：${error.message}`)
  process.exit(1)
}

if (!URL.canParse(indexUrl)) {
  console.error(`--url 必须是绝对 URL：${indexUrl}`)
  process.exit(1)
}
const baseUrl = new URL(indexUrl)

if (!isObject(raw)) {
  console.error('索引根节点必须是 JSON 对象')
  process.exit(1)
}
if (raw.format !== 1) fail('$.format', '必须是 1')
const metadata = indexMetadata(raw.metadata)
const title = localizedText(raw.title, '$.title')
const description = optional(raw, 'description', '$', localizedText)
const names = new Set()
const plugins = []
if (!Array.isArray(raw.plugins)) fail('$.plugins', '必须是数组')
else {
  raw.plugins.forEach((entry, i) => {
    const parsed = plugin(entry, `$.plugins[${i}]`, metadata, baseUrl)
    if (parsed?.name !== undefined) {
      if (names.has(parsed.name)) fail(`$.plugins[${i}].name`, `重复声明 ${parsed.name}`)
      names.add(parsed.name)
    }
    if (parsed !== undefined) plugins.push(parsed)
  })
}

if (errors.length > 0) {
  console.error(`✗ ${file} 不符合 format 1，共 ${errors.length} 处问题：`)
  for (const message of errors.slice(0, 40)) console.error(`  - ${message}`)
  if (errors.length > 40) console.error(`  … 其余 ${errors.length - 40} 处省略`)
  process.exit(1)
}

const normalized = {
  format: 1,
  title,
  ...(description === undefined ? {} : { description }),
  metadata,
  plugins,
}

const versionsOf = (p) => p.versions.map((v) => v.version).join(', ')
console.log(`✓ ${file} 通过 format 1 校验`)
console.log(`  索引：${typeof title === 'string' ? title : title.en}`)
console.log(`  插件 ${plugins.length} 个，分类 ${Object.keys(metadata.categories).length} 个，标签 ${Object.keys(metadata.labels).length} 个`)
for (const p of plugins) console.log(`  - ${p.name}  ${versionsOf(p)}${p.metadata.category === undefined ? '' : `  [${p.metadata.category}]`}`)
console.log(`  以 ${indexUrl} 为索引地址解析图标`)
if (print) console.log(JSON.stringify(normalized, null, 2))
