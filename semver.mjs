/**
 * 共享的 SemVer 工具：校验器与同步脚本都用这一份，避免两套实现漂移。
 */

const NUMERIC = '(?:0|[1-9]\\d*)'
const PRERELEASE_PART = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`

/** 精确版本号的 SemVer 2.0.0 语法。 */
export const SEMVER = new RegExp(
  `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
  'u',
)

const COMPARATOR = /^(?:[<>=^~]{1,2})?v?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u

/**
 * 语法体检级别的 SemVer range 判断（支持 `^ ~ >= > <= < = || -` 与 x/*）。
 * 正式兼容性判定仍由 DSH 内部的 semver 完成。
 */
export function isSemverRange(range) {
  if (typeof range !== 'string' || range.trim() === '') return false
  if (range.startsWith('workspace:')) return false
  for (const part of range.split('||')) {
    const body = part.trim()
    if (body === '') return false
    const hyphens = body.split(/\s+-\s+/)
    if (hyphens.length > 2) return false
    for (const comparator of hyphens) {
      const tokens = comparator.trim().split(/\s+/).filter(Boolean)
      if (tokens.length === 0) return false
      for (const token of tokens) if (!COMPARATOR.test(token)) return false
    }
  }
  return true
}

/** 是否为预发布版本（带 `-` 后缀）。 */
export function isPrerelease(version) {
  return /-/.test(version.split('+')[0])
}

/** SemVer 优先级比较：正数表示 a 高于 b。 */
export function compareSemver(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]*))?(?:\+.*)?$/u.exec(v)
    return m === null ? null : { numbers: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4]?.split('.') ?? [] }
  }
  const left = parse(a)
  const right = parse(b)
  if (left === null || right === null) return 0
  for (let i = 0; i < 3; i += 1) {
    if (left.numbers[i] !== right.numbers[i]) return left.numbers[i] - right.numbers[i]
  }
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length
  const length = Math.max(left.pre.length, right.pre.length)
  for (let i = 0; i < length; i += 1) {
    const x = left.pre[i]
    const y = right.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNumeric = /^\d+$/u.test(x)
    const yNumeric = /^\d+$/u.test(y)
    if (xNumeric && yNumeric) return Number(x) - Number(y)
    if (xNumeric) return -1
    if (yNumeric) return 1
    return x < y ? -1 : 1
  }
  return 0
}
