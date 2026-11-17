# zotero AI bar

![zotero AI bar：黑色实线标识](addon/content/icons/favicon.svg)

Zotero 文献阅读助手：划词提问、上下文问答、悬浮翻译，以及支持断点保存的全文翻译。

**这是改进版 fork，不是上游官方发行版。** 原作者为 **[swcxito](https://github.com/swcxito)**，原项目为 **[swcxito/zotero-ai-bar](https://github.com/swcxito/zotero-ai-bar)**。本 fork 由 **[freeshr1107-free](https://github.com/freeshr1107-free)** 维护，基于上游 **v1.6.10**（`b3cf801667e0dc7dfef6cf0454495c721fef904c`）继续开发。保留上游版权声明及 [AGPL-3.0-or-later 开源许可证](LICENSE)。

[本 fork 仓库](https://github.com/freeshr1107-free/zotero-ai-bar) · [问题反馈](https://github.com/freeshr1107-free/zotero-ai-bar/issues) · [构建产物](https://github.com/freeshr1107-free/zotero-ai-bar/actions/workflows/ci.yml) · [发布页](https://github.com/freeshr1107-free/zotero-ai-bar/releases)

[访问官网](https://cybernomadvv.github.io/zotero-ai-bar/) · [安装与使用指南](https://cybernomadvv.github.io/zotero-ai-bar/guide.html) · [直接下载 XPI](https://cybernomadvv.github.io/zotero-ai-bar/downloads/zotero-ai-bar.xpi)

官网位于 `site/`，使用 GitHub Pages 免费托管，无需服务器、数据库或第三方统计服务。更新 `custom` 分支中的网站或插件源码会触发 `.github/workflows/pages.yml`，从已提交源码构建 XPI 并与网站一同部署。安装包校验和及对应源码提交分别位于网站 `downloads/SHA256SUMS.txt` 和 `downloads/source-commit.txt`。本地预览可运行 `python -m http.server 4187 --directory site`；下载文件在 CI 构建时生成。

## 功能

- **划词提问**：选中文献内容后解释、总结、翻译或输入问题，按需附加选区上下文。
- **文献问答**：快捷、全文和 Agent 模式；侧栏与独立聊天窗口；支持 Markdown、代码、表格和数学公式。
- **悬浮翻译**：在阅读器附近显示翻译结果，支持拖动、调整尺寸和重新翻译。
- **全文翻译与术语**：按论文及目标语言保存原文、译文、术语和选区修订，完成后优先复用缓存。
- **断点续译**：每个校验通过的完整批次保存一次；失败、暂停或退出后，可点击“继续全文翻译”，跳过已保存内容。尚未完成的批次会重新请求。
- **本地优先**：优先查询论文译文、术语及可选的 ECDICT 词典；配置离线运行时后可使用 CPU 英译中小模型。
- **工具栏自定义**：选择并排序直接显示的操作，至少保留三个，其余操作收入“更多”。
- **模型接入**：支持多服务商、OpenAI-compatible API 和 Magpie；保留上游实验性 Codex 订阅接入。

## 本 fork 的主要改进

| 项目           | 改进内容                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| 产品标识       | 名称统一为 `zotero AI bar`，插件入口使用黑色实线标识                     |
| 阅读界面       | 简化模型名称与思考强度显示，去除输入提示和空白页联网诗词                 |
| 划词体验       | 工具栏定位调整、可配置操作顺序、翻译浮层与工具栏宽度联动                 |
| 翻译存储       | 逐批保存、暂停与恢复、原文和目标语言校验，全部完成且写盘成功后才标记完成 |
| 模型与离线资源 | Magpie 接入、本地词典与轻量离线翻译支持                                  |

## 安装

支持范围沿用上游 Zotero 7–10；本 fork 的本机运行验收主要在 Windows / Zotero 10 上进行。

1. 从本 fork 的 [Releases](https://github.com/freeshr1107-free/zotero-ai-bar/releases) 获取 `.xpi`；若尚无发行包，可从成功的 [CI 构建](https://github.com/freeshr1107-free/zotero-ai-bar/actions/workflows/ci.yml)下载 `build-result`，或按下文自行构建。CI 下载的是 ZIP，解压后取其中的 `.xpi`，不要解压 XPI 本身。
2. 在 Zotero 中打开 **工具 → 插件 / 附加组件 → 齿轮 → 从文件安装插件**，选择 `.xpi`。
3. 打开 **设置 → zotero AI bar**，添加服务商、API Key 和模型。
4. 打开文献并选中文字，选择工具栏操作或输入问题。

**升级注意：** 本 fork 保留插件 ID `zaibar@fukeke.com` 和设置命名空间，以沿用已有配置。因此安装会替换上游版本，不能与上游版本同时启用。安装前请备份 Zotero 配置；本 fork 的主页和更新地址指向本仓库。

## 配置模型

普通 API 接入需要配置自己的服务商、密钥和模型，调用费用按服务商条款计算。Magpie 默认地址为 `http://127.0.0.1:3425/v1`；请先启动自己的 Magpie 服务，并填写该实例要求的凭据与可用模型。仓库不包含用户 API Key 或订阅凭据。

已配置 Magpie 后，插件会在启动、打开模型下拉框及模型设置时请求该实例的 `/models`，同步新增模型、显示名称、上下文容量和思考能力。新模型自动加入可选列表，已有模型的启用状态和当前选择保持不变。请求失败时保留已保存列表；恢复服务后重新打开模型选择器即可再次同步。模型设置保留 Magpie 的 `MAGPIE_API_KEY` 字段，不依赖在线公共服务商目录。

Codex 订阅接入需要受支持的本机运行时与相应账号，当前为实验功能，详见 [Codex 接入说明](docs/codex-integration.md)。插件不附赠模型订阅。

## 翻译与断点保存

打开论文后，可以选择“翻译此文章”或“不翻译此文章”。全文翻译在后台逐批执行，运行时可点击“暂停并保存”；中断后显示已保存进度及“继续全文翻译”。恢复前校验原文和目标语言，避免混用不同内容的译文。

缓存保存在 Zotero profile 的 `zaibar/paper-translations/` 中。只有全文处理完成且成功写盘，才显示 `全文翻译：true`。缓存包含论文正文和译文，请按自己的资料管理要求备份。

离线资源**不包含在 XPI 中，也不会因安装插件自动准备好**。词典、小模型和 Python 运行时需要单独配置：

- [本地优先翻译及离线资源说明](docs/local-first-translation.md)
- [悬浮翻译说明](docs/floating-translation.md)
- [断点续译及验收记录](docs/translation-resume.md)

当前离线模型支持英译中；其输出是基础译文。准备脚本为 `scripts/prepare-offline-assets.py`，Python 依赖见 `scripts/local-translation-requirements.txt`。`scripts/install-offline-assets.py` 是本机部署辅助脚本，使用前必须修改其中的 profile 路径，并退出 Zotero。

## 从源码构建

需要 Node.js 和 pnpm 10.28.0：

```bash
git clone https://github.com/freeshr1107-free/zotero-ai-bar.git
cd zotero-ai-bar
pnpm install --frozen-lockfile
pnpm build
```

构建同时执行 TypeScript 检查；XPI 输出在 `.scaffold/build/`。本地开发可参考 [.env.example](.env.example)，配置 Zotero 路径后执行 `pnpm start`。

断点续译模块验证：

```bash
node scripts/verify-translation-resume.mjs
```

Magpie 模型同步回归（使用本地测试数据，不调用云端）：

```bash
node scripts/verify-magpie-model-sync.mjs
```

真实 Zotero / 离线翻译验证脚本依赖本机 profile、资源路径及运行时，不是通用的零配置测试。历史验收和限制见对应文档；模拟云端测试不代表真实论文译文质量。

## 数据与隐私

AI 问答及云端翻译会向所选服务商发送问题、选区，以及当前模式需要的正文或图片。全文模式及全文翻译会发送论文内容。离线词典和本地模型不需要云端翻译请求；点击“重新翻译”会调用 AI。请按模型服务商条款及文献使用权限配置功能。

本地运行时、配置备份、密钥和日志不纳入仓库。请勿在 Issue 中粘贴密钥、账号配置或受限论文全文。

## 原作者、贡献与开源协议

- **原作者：** [swcxito](https://github.com/swcxito)，原项目 [Zotero AI Bar](https://github.com/swcxito/zotero-ai-bar)。本 fork 的主体基础代码来自该项目。
- **改进版维护者：** [freeshr1107-free](https://github.com/freeshr1107-free)。具体改动可查看本仓库提交及 [定制记录](docs/local-customization.md)。
- **许可证：** [GNU Affero General Public License v3.0 or later（AGPL-3.0-or-later）](LICENSE)。本 fork 继续沿用该协议；原有版权和许可证声明保留。修改、再分发及通过网络提供修改版服务时，请遵守协议规定的对应源代码提供义务。
- **独立离线资源：** ECDICT 使用 MIT 许可证；OPUS-MT 模型的许可证及来源随准备资源保存，详见离线资源说明。它们不打包进 XPI。

感谢上游作者与贡献者，以及 [Zotero](https://www.zotero.org)、[Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template)、[Vercel AI SDK](https://github.com/vercel/ai)、[models.dev](https://github.com/anomalyco/models.dev)、[Zotero PDF Translate](https://github.com/windingwind/zotero-pdf-translate) 和 [Zotero PDF2zh](https://github.com/guaguastandup/zotero-pdf2zh)。
