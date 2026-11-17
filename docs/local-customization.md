# AI Bar 本地定制记录

源码基线：官方 v1.6.10，commit b3cf801667e0dc7dfef6cf0454495c721fef904c。
本地安装保留官方插件 ID `zaibar@fukeke.com` 和版本号 1.6.10，以复用现有设置。
许可证保留为上游 AGPL-3.0-or-later。

## 现有功能概览

以下来自 README、默认设置及源码；不表示已逐项完成真实模型调用测试。

| 模块 | 已有功能 |
| --- | --- |
| 划词操作 | 阅读器划词工具栏，解释、翻译、总结、提问，附加选区附近上下文 |
| 对话模式 | 普通、全文、Agent；全文模式附加当前文献，Agent 按需检索和读取 |
| 聊天位置 | 主窗口侧栏、独立窗口、窗口置顶设置、侧栏宽度设置 |
| 会话管理 | 历史记录、收藏、新建／清空、重试最近回答、上下文轮数、上下文压缩 |
| 提示词 | 内置操作和自定义提示词编辑器 |
| 模型接入 | 多服务商、多模型、自定义兼容端点、API Key；实验性 Codex 订阅接入 |
| 生成参数 | 温度、输出 Token 上限、思考强度、Token 用量及已知上下文窗口占用 |
| 翻译 | 自动翻译开关、目标语言、独立模型、单词／缩写结构化卡片、独立翻译标签页 |
| 图像 | 输入图片、PDF 页面截图、图表分析；分析需要模型支持图像 |
| 富文本显示 | 流式输出、Markdown、代码高亮、表格、数学公式、回复复制 |
| 文库 Agent 工具 | 文献元数据和正文读取、全文搜索、文库检索与目录、读取当前所选文献 |
| 文献检索与添加 | Crossref 检索、根据 DOI 添加文献，带重复检查及下载结果反馈 |
| 外观 | 字号、皮肤、界面设置；原版中文空白页还会获取诗句并播放切换动画 |

## 第一次修改：移除空白页古诗文

- 重写 `src/components/chatEmptyState.ts`，空白页改用已有本地化静态问候语。
- 移除该组件的今日诗词／一言联网请求、Token 获取、缓存、诗句按钮、出处和切换动画。
- 保留空白页生命周期：新会话显示问候语，有消息或历史记录时隐藏；清空后恢复；主题预览中隐藏；销毁时断开观察器。
- 保留未引用的旧诗词 CSS 和本地化键，便于后续界面集中整理；运行脚本不再包含诗词接口地址。
- 未改动模型接入、提示词、翻译或 Agent 业务代码。

## 构建及安装验证

- 使用锁文件安装依赖，`pnpm build` 成功（包含 TypeScript 检查）。
- 改动组件通过 ESLint 和 Prettier 检查。
- XPI 条目使用正斜杠；打包脚本不含 `jinrishici.com` 或 `v1.hitokoto.cn`。
- Zotero 正常退出后备份原安装包、扩展注册文件和启动缓存，再安装修改版并重建启动缓存。
- 重启日志确认 `hooks.onStartup completed, initialized=true`。
- 注册状态确认插件 active=true、userDisabled=false、appDisabled=false。
- 安装包与构建产物 SHA256 一致：`1c9bcaa63f65fcb548edc1a10fbf3e4b9822a07952381cbcfed275b1cd7ca3bc`。
- 将该插件 `applyBackgroundUpdates` 设为 0，避免官方更新覆盖定制。
- 未做桌面截图验收或真实供应商问答回归。

安装包：`dist/zotero-ai-bar-1.6.10-no-poems.xpi`。
原版备份：`local-backups/20261116-200832/zaibar@fukeke.com.xpi`。
恢复时应先正常退出 Zotero，换回原包并重建启动缓存；如需恢复自动更新，在插件管理器中调整该插件设置。

## 第二次修改：模型名称、输入提示、思考强度

- 共用 `ModelInfo` 组件改为显示已配置的模型名称，缺少别名时显示模型 ID；不再使用彩色图标、版本及类型角标。
- 划词工具栏、侧栏和独立聊天窗口共用此显示，保留点击选择模型及跨窗口刷新。
- 长名称受容器宽度限制，省略溢出部分，悬停显示完整名称；下拉选项的图标不变。
- 划词工具栏和聊天输入框的 placeholder 设为空，保留辅助技术使用的 aria-label。仅在输入框聚焦时出现系统光标，不强制抢焦点。
- 思考强度按钮移除 Brain 图标，仅保留当前强度文字；原有强度菜单交互不变。
- ESLint、TypeScript、git diff --check 通过，成功打包。
- 安装并重启确认 `hooks.onStartup completed, initialized=true`；插件启用、自动更新关闭，安装文件与构建产物哈希一致。
- 当前安装包：`dist/zotero-ai-bar-1.6.10-custom-ui.xpi`。
- 本次修改前备份：`local-backups/20261116-233041/`。
- 当前 SHA256：`42389690802495f6c65b35aeb8d29dcfa861d4fa36a73106d8f41bf368d41e7f`。
- 未执行桌面截图验收或真实供应商问答回归。

### 会话及模式的区别

文章速答按阅读器文献分配会话，能够附加当前划词。全局助理使用跨阅读器共享会话，不自动绑定当前文献或划词，固定 Agent 模式，可按需读取文库所选文献。文章速答中的普通模式不自动附加全文；全文模式附加正文（过长时提示切换 Agent、使用部分文档快照或取消）；Agent 模式用工具按需搜索和读取。

## 第三次修改：快捷模式、文章标签、Magpie 和选区稳定性

- 中文模式名“普通”改为“快捷”，含输入模式菜单和默认模式设置；内部 normal 值及行为不变。
- 仅移除侧栏及独立窗口中“文章速答”标签的图标，保留全局助理与翻译图标。
- 内置供应商目录新增 Magpie（本机 http://127.0.0.1:3425/v1），根据已配置且由实时 /models 返回的交集加入 11 个模型。认证只存本地 Zotero 配置，不写入源码目录的供应商目录。
- 复用 OpenAI-compatible SDK，新增 Magpie reasoningEffort 参数传递；不需要另开转发进程。
- 日常 profile 配置 Magpie 为当前供应商，默认沿用 Pi 中的 codex/gpt-6.1-sol；原有其他供应商保留。
- 实际用同款 SDK 测试 Magpie：流式输出 MAGPIE_OK；流式工具调用及执行输出成功（reasoningEffort=low）。测试脚本 scripts/verify-magpie-local.mjs。
- 原 profile 的 translate.enableAuto=true 会在选区事件后发起翻译并展开聊天侧栏。将其关闭（使用原版 false 默认值），保留手动翻译和提问。用户重新开启自动翻译设置会恢复该行为。
- 划词工具栏不再对 transform/位置使用 transition: all；改为隐藏时测量，在 requestAnimationFrame 中完成越界修正后显示，避免先出现再移动。
- 编译、TypeScript、相关文件 ESLint、安装包哈希和插件 initialized=true 验证通过；确认有效自动翻译设置为 false、Magpie 配置及 11 模型已持久化。
- 本次修改前备份 local-backups/20261116-235140/（包含 prefs.js、models-v2.json、扩展注册及原包）；备份文件可能含账号配置，不应分发。
- 最新 dist/zotero-ai-bar-1.6.10-custom-ui.xpi SHA256：02ad43ad87b558073644f7532f766d952be1e7cc14fd70ea078cd0dec6c1ead3。
- 限制：SDK 集成测试在 Node 中执行，未在 Zotero 内发起真实论文问答；未做真实鼠标选区的视觉抖动对比，不能据静态检查宣称视觉问题彻底消失。

## Magpie 动态模型同步及凭据修复

- 新增 `src/modules/magpieModels.ts`：使用 Zotero 中配置的 Magpie 地址及凭据请求 `/models`，在启动及打开模型选择器时刷新；保留当前选择、已关闭模型和已保存列表，新增模型自动启用。服务声明支持 priority 时生成对应 Fast 选项。
- 在线公共服务商目录与本地目录合并，避免公共目录不含 Magpie 时丢失其模型及 API Key 字段定义；设置界面保留标准 `MAGPIE_API_KEY` 字段并兼容旧 `API_KEY` 值。保存设置时不再记录完整配置对象。
- `scripts/verify-magpie-model-sync.mjs` 验证新模型、重复刷新、当前选择及关闭状态保留、Fast 选项、离线及无效响应保留原配置。
- 隔离 Zotero 中打开真实 PDF，验证两个 Hy4 flash 模型出现在实际模型下拉框并可选择；打开、关闭模型设置后凭据保留。真实 Hy4 flash 问答返回 `MAGPIE_ZOTERO_OK`。
- 本机升级前备份至 `local-backups/20261117-144730/`。仅在本地恢复缺失的 Magpie 配置及凭据，保持当前选择 `workbuddy/glm-5.3-flashx`；凭据不写入源码或安装包。

## 侧栏输入与输入法组合输入稳定性

- 输入高度改由独立的不可见、不可聚焦 textarea 测量，避免每次输入先把活动编辑器高度重置为 `auto`。组合输入期间保持活动输入框高度，组合结束后再更新。
- 输入法组合期间的 Enter 及兼容路径 keyCode 229 不触发发送；普通 Enter 发送、Shift+Enter 换行保持原行为。
- `scripts/verify-input-zotero.mjs` 在隔离 Zotero 的实际 PDF 阅读侧栏中验证：组合事件期间坐标与焦点稳定、文字保留、候选确认不发送、普通发送、多行伸缩和测量框不可见。
- 构建、TypeScript、相关 ESLint 及原生输入回归通过。本机更新前备份：`local-backups/20261117-151410/`；安装包哈希与构建产物一致，启动确认 initialized=true。
- 验证使用合成组合事件，未自动化 Windows 输入法候选窗口的绘制；实际系统输入法闪现情况需在日常输入中观察。

