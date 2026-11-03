# 自建 DSH 插件索引源（format 1）

DSH 的「插件 → 发现」页读的不是硬编码的商店，而是**你自己添加的索引 URL**；索引本身就是一份 JSON。
这个仓库就是一份可直接跑通的最小实现：改 `index.json` → 校验 → push → 在 GUI 里加一条源。

> **线上地址**：<https://3072141364.github.io/dsh-index-source/index.json>
> 本地预览：`node serve.mjs` → <http://127.0.0.1:8787/index.json>

```
dsh-index-source/
├── index.json      # 索引本体（format 1）
├── icons/          # 相对图标放这里，按索引 URL 解析
├── validate.mjs    # 零依赖校验器（规则对齐官方 @deepseek-ai/dsh-plugin-market-index）
├── serve.mjs       # 本地预览服务器
├── package.json    # 想走 npm + jsDelivr 托管时用
├── .nojekyll       # 关掉 Jekyll，避免下划线/点开头的文件被丢
├── .github/workflows/validate.yml  # push 时自动校验
└── README.md
```

## 1. 加进 DSH

1. 打开 **插件 → 发现**；
2. 点 **添加索引源**；
3. 填 `https://3072141364.github.io/dsh-index-source/index.json`（本地调试可填 `http://127.0.0.1:8787/index.json`）；
4. 新源会自动成为当前插件市场，能看到 3 个条目（本机已装的会显示「已安装」）。

索引源只能由你在界面里增删，Agent 侧的 `plugin_market` 工具是只读的——这是 DSH 的安全设计。
另一条路是改 profile 配置（`~/.dsh/profiles/desktop/cordis.patch.yml` 里 `plugin-market` 的 `indexes`），但要重载 profile，日常没必要。

## 2. 格式速查

顶层：

| 字段 | 必填 | 说明 |
|---|---|---|
| `format` | 是 | 固定 `1` |
| `title` | 是 | 字符串，或 `{ "en": "...", "zh": "..." }`，**对象形式必须含 `en`** |
| `description` | 否 | 同上 |
| `metadata.categories` | 否 | `{ id: { title: 文案 } }`，插件只能引用这里声明过的分类 |
| `metadata.labels` | 否 | 同上，可多选筛选 |
| `metadata.sortKeys` | 否 | `{ id: { title: 文案, order: "asc" \| "desc" } }` |
| `plugins` | 是 | 条目数组，`name` 不能重复 |

每个 `plugins[]`：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | npm 包名（`@scope/name` 也合法），≤214 字符 |
| `title` / `description` | 否 | 本地化文案，对象必须含 `en` |
| `icon` | 否 | 相对/绝对 URL（须 https，或与索引同源）或 `data:image/...;base64,`（解码 ≤32 KiB） |
| `author` | 否 | 字符串 |
| `homepage` | 否 | http(s) 绝对 URL |
| `repository` | 否 | `{ url, directory? }`，`directory` 是包在仓库里的子目录 |
| `metadata.category` | 否 | 必须是已声明的分类 id |
| `metadata.keywords` | 否 | 字符串数组，参与搜索加权 |
| `metadata.labels` | 否 | 已声明标签 id 的数组，不可重复 |
| `metadata.sortKeys` | 否 | `{ 已声明id: 数字 }` |
| `versions` | 是 | 非空数组，`version` 不可重复；读取时按 SemVer 降序排好 |

每个 `versions[]`：

| 字段 | 必填 | 说明 |
|---|---|---|
| `version` | 是 | 精确 SemVer，不接受 `^1.2.3` 这类范围 |
| `publishTimestamp` | 是 | **Unix 秒**（不是毫秒），整数 |
| `source` | 是 | `{"type":"npm"}`（可加 `registry`）或 `{"type":"git","url":"https://github.com/a/b","commit":"<40位小写sha>","path":"packages/x"}` |
| `engines.dsh` | 否 | SemVer range，例如 `^0.2.1`；不兼容的版本在 UI 里会标灰 |

安装语义（DSH 自动生成，不用你写）：

- npm → `pnpm add <name>@<version>`，`source.registry` 存在时先问该 registry；
- git → `git+https://...git#<commit>&path:/<path>`，**必须钉死在 commit**，不能用分支。

## 3. 加一个自己的插件

把包发布到 npm（或内网 registry）后，加一条：

```json
{
  "name": "@your-scope/dsh-your-plugin",
  "title": { "en": "Your plugin", "zh": "你的插件" },
  "description": { "en": "What it does.", "zh": "它做什么。" },
  "author": "you",
  "repository": { "url": "https://github.com/you/dsh-your-plugin" },
  "metadata": { "category": "tools", "keywords": ["demo"] },
  "versions": [
    { "version": "0.1.0", "publishTimestamp": 1793000000,
      "source": { "type": "npm" }, "engines": { "dsh": "^0.2.1" } }
  ]
}
```

不想发 npm，就走 git 源（私有仓库也行，只要运行 DSH 的机器能 clone）：

```json
{
  "name": "dsh-your-plugin",
  "title": { "en": "Your plugin" },
  "repository": { "url": "https://github.com/you/dsh-your-plugin" },
  "metadata": {},
  "versions": [
    { "version": "0.1.0", "publishTimestamp": 1793000000,
      "source": { "type": "git", "url": "https://github.com/you/dsh-your-plugin", "commit": "0123456789abcdef0123456789abcdef01234567" } }
  ]
}
```

包本身必须是个 DSH 组合包（`package.json` 里声明 `dsh.bundle.patch`），否则装了也不挂载。

## 4. 发布前校验

```bash
node validate.mjs                       # 校验 ./index.json
node validate.mjs index.json --url https://example.com/index.json
node validate.mjs --print               # 通过后打印归一化结果（版本已排序）
```

规则是逐条对着 DSH 内置校验器写的，并已用官方包做过 14 组正/负用例交叉验证（含版本排序、未声明分类、重复标签、跨源 http 图标、git commit 大小写、`workspace:` range 等）。
唯一差异：`engines.dsh` 的 SemVer range 只做语法体检，最终以安装时的真实 semver 判断为准。

要 100% 对齐，也可以直接用官方包：

```bash
npm i -D @deepseek-ai/dsh-plugin-market-index
node --input-type=module -e "
import fs from 'node:fs'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
const doc = JSON.parse(fs.readFileSync('index.json', 'utf8'))
console.log(parseMarketIndex(doc, 'https://example.com/index.json').plugins.length, 'plugins ok')
"
```

## 5. 托管到哪

| 方式 | URL 形态 | 适合 |
|---|---|---|
| **GitHub Pages** | `https://<u>.github.io/<repo>/index.json` | 最省事，git push 即发布，自带 HTTPS 和 CDN |
| npm 包 + jsDelivr | `https://cdn.jsdelivr.net/npm/<pkg>/index.json` | 需要版本化分发、多人引用同一份 |
| GitHub raw | `https://raw.githubusercontent.com/<u>/<r>/main/index.json` | 连 Pages 都不想开时 |
| 本机/内网服务器 | `http://127.0.0.1:8787/index.json` | 自用、内网插件，或调试阶段 |

### GitHub Pages（本仓库已启用）

1. 本仓库已把 `index.json` 放在**仓库根目录**，Pages 源已设为 `main` / `(root)`。
2. 日常更新：改 `index.json` → `node validate.mjs` → `git push`，约 30–60 秒后线上生效。
3. 线上地址：`https://3072141364.github.io/dsh-index-source/index.json`
4. 把这个 URL 加进 **插件 → 发现 → 添加索引源**。

新仓库想复刻这套配置时：**Settings → Pages → Source: Deploy from a branch → main / (root)**，保存即可。

本仓库带的两份文件让 Pages 直接可用：

- `.nojekyll` —— 关掉 Jekyll 构建，否则以下划线/点开头的文件、特殊字符路径会被静默丢掉，而且构建还会多几十秒。
- `.github/workflows/validate.yml` —— push 时自动跑 `validate.mjs`（用真实 Pages 地址解析图标），索引写坏了在 CI 阶段就红，不会把坏索引发布出去。

想换自定义域名（`index.example.com`）也可以，但**务必把源地址写成自定义域名**：附加域名后 `*.github.io` 会 301 跳到新域名，而 DSH 拒绝重定向。

npm 方式：

```bash
# 1) 把 package.json 的 name/version 改成自己的
npm publish
# 2) 源地址
https://cdn.jsdelivr.net/npm/<your-pkg>@<version>/index.json
```

`package.json` 已配好 `files: ["index.json", "icons"]` 和 `prepublishOnly` 校验钩子，发布前会自动跑一遍校验。

## 6. 几个容易踩的坑

- **索引 URL 规则**：必须 http/https，不能带凭据或 `#`；可以带 query。**重定向会被拒绝**，请直接填最终地址。
- **Pages 的缓存**：GitHub Pages 给静态文件发 `cache-control: max-age=600`，叠上 DSH 自己的 10 分钟缓存，改完最多可能要等 10 分钟才看到。急着验证时把源地址临时写成 `.../index.json?v=2`（query 合法，且换 URL 就换了缓存键）。
- **Pages 必须用 https**：`http://` 会 301 到 https，而 DSH 拒绝重定向，所以源地址一律写 `https://`，也不要写 `.../repo`（目录会跳转到 `.../repo/`）。
- **Pages 站点是公开的**：私有仓库要开 Pages 得是付费套餐，而且发布出来的站点默认仍然公开可读（企业版才可控）。所以索引里别写内网地址、凭据或不想外泄的包名。
- **缓存 10 分钟**：`cacheTtlMs` 默认 600000；改了内容立刻生效请用发现页的刷新按钮；后续分页靠 `fetchedAt` 固定同一份文档。
- **jsDelivr 缓存**：刚发布的版本可能要等几分钟；引用固定版本号（`@1.0.1`）比 `@latest` 稳。
- **图标**：https 页面里加载 http 图标会被浏览器拦（本地 `http://127.0.0.1:55933` 页面不受影响）；跨源 http 图标会被校验器直接拒绝。
- **声明不等于事实**：索引里的 name/version 只是声明，真正装什么由包自己的 manifest 决定；索引没有签名，只给自己人用的源别乱加第三方条目。
- **索引源是全局列表**：设置页保存时整表覆盖，两个窗口同时改会互相盖掉。
- **索引很大时**：DSH 会整份下载并建全文索引（上限 128 MiB），个人源建议控制在几百条以内。
- **只影响「发现」**：添加索引源不会装任何东西；安装仍走 `plugin_manager` 的检查与审批流程。
