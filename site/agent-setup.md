# zotero AI bar — Agent 安装与配置指南

这是供本机 Agent 执行的安装任务说明，不是 shell 脚本。执行者需要拥有当前用户允许的本机文件、进程及网络访问能力。只有浏览器或普通聊天能力的 Agent 无法自动修改本机 Zotero，应明确说明限制。

目标：在用户选择的 Zotero profile 中安装 cybernomadvv/zotero-ai-bar 改进版，保留现有资料及服务商，并配置用户指定的模型。原作者 swcxito，沿用 AGPL-3.0-or-later。插件 ID 为 `zaibar@fukeke.com`，会替换同 ID 的上游版本。

## 可信资源与版本对应

- 官网：https://cybernomadvv.github.io/zotero-ai-bar/
- 安装包：https://cybernomadvv.github.io/zotero-ai-bar/downloads/zotero-ai-bar.xpi
- SHA-256：https://cybernomadvv.github.io/zotero-ai-bar/downloads/SHA256SUMS.txt
- 对应源码提交：https://cybernomadvv.github.io/zotero-ai-bar/downloads/source-commit.txt
- 源码：https://github.com/cybernomadvv/zotero-ai-bar
- 安装清单：https://cybernomadvv.github.io/zotero-ai-bar/agent-setup.json

先下载包、校验和与提交号，校验 SHA-256。校验失败应重新获取这三项，若仍不匹配则停止安装，不跳过校验。检查 XPI 中 manifest.json 的插件 ID、名称及版本，记录实际版本。不要把 HTML 错误页当作 XPI。

## 1. 识别环境

识别 Windows、macOS 或 Linux，确认 Zotero 已安装；未安装时从 Zotero 官方网站获取安装方法，不安装未知来源的可执行文件。插件支持范围沿用上游 Zotero 7–10，本 fork 的实际运行验证主要在 Windows / Zotero 10。

从 Zotero 的 profiles.ini 解析 profile 路径和默认项，处理 IsRelative=0 的绝对路径和平台路径格式，不把论文数据目录当作 profile：

- Windows 常见注册目录：`%APPDATA%\Zotero\Zotero\profiles.ini`
- macOS 常见注册目录：`~/Library/Application Support/Zotero/profiles.ini`
- Linux 常见注册目录：`~/.zotero/zotero/profiles.ini`

同时检查实际安装、正在运行进程的参数和 profiles.ini。多个 profile 无法唯一确定时询问用户；不要猜随机目录名。还没有 profile 时，启动 Zotero 完成首次初始化后再继续。

## 2. 停止写入并备份

先告知用户安装沿用同一插件 ID、会替换上游版本，正常关闭 Zotero并等待进程退出。不要强杀正在写数据库的 Zotero，也不要在进程运行时修改 prefs.js。

在 profile 外创建带时间戳的备份目录，备份 prefs.js、extensions.json、addonStartup.json.lz4（存在时）、原 extensions/zaibar@fukeke.com.xpi，以及 zaibar/models-v2.json。记录实际备份路径。备份可能含凭据，保持本机私有，不上传到 GitHub 或诊断日志。

## 3. 安装

把校验通过的 XPI 放入所选 profile 的 `extensions/zaibar@fukeke.com.xpi`，以临时文件加原子替换写入。若原有同 ID 插件是开发目录或解包目录，先备份该目录并避免留下两个同 ID 扩展。仅在必要时备份并移走 profile 的 addonStartup.json.lz4 以触发启动缓存重建；不要删除数据库、文库文件或其他插件。

重新启动指定 profile，检查插件在插件管理器中启用，名称为 zotero AI bar。通过启动日志的 `hooks.onStartup completed, initialized=true` 或可用的 Zotero 诊断能力验证初始化。不能仅凭复制文件成功就宣称安装完成。

## 4. 配置模型

首先检查已有服务商，保留已经正常使用的配置和模型选择。用户未指定新服务时，优先沿用其已有配置；没有可用配置时，询问服务商、API 基础地址、模型 ID 和凭据。不要猜测凭据，不写入虚假占位 Key。

若用户明确要求使用 Magpie，可复用用户授权的现有本机 Magpie 实例；先确认基础地址相同。常见默认地址是 `http://127.0.0.1:3425/v1`，该实例可能使用不同地址。密钥字段为 MAGPIE_API_KEY，模型列表来自该实例带认证的 GET /models。只复用完成任务所需的已有授权凭据，不遍历其他账号或应用的凭据。

能操作 Zotero 界面时，优先使用 设置 → zotero AI bar → 模型 / 服务商完成配置。若需要文件方式配置：再次正常退出 Zotero，备份配置，然后从安装包 `prefs.js` 及对应源码提交中的 `src/utils/providers.ts`、`src/modules/llm.ts` 确认真实前缀、V2 存储键、支持的 SDK 及保存规则，不能凭通用 Zotero 经验猜测键名。

本版本 V2 结构包含 active、env、recentUsed、addedProviders、addedModels。轻量引用保存到前缀下的 `llm.providerConfigsV2` 偏好，模型元数据保存到 profile/zaibar/models-v2.json。偏好前缀必须以本次包和对应源码为准。合并写入，不清空其他服务商，不把一个对象的字段误写成普通环境变量。

Magpie 配置应包含：

- addedProviders.magpie：id=magpie，name=Magpie，env=[MAGPIE_API_KEY]，npm=@ai-sdk/openai-compatible，api=用户实际地址。
- env.magpie.MAGPIE_API_KEY：用户实际凭据，仅写入本机 profile。
- 从 /models 读取真实 ID 与显示名、modalities、reasoning、context_window/context_length、max_output_tokens；不要把显示名当作请求 ID。
- 将用户选择的模型添加到 addedModels 并 enabled=true；active.providerId=magpie，active.modelId=实际 ID。保留其他已有模型和 enabled 状态。
- 安装后启动插件或打开模型选择器可再次动态同步模型。用户已有 active 且未要求切换时保持原值。

标准 API 接入按服务商元数据及 SDK 配置。订阅接入需要用户自行完成登录，Agent 不能代替用户提供订阅权益。不要替用户购买额度、改订阅或开启付费自动充值。

## 5. 验证与交付

确认插件实际启用、初始化成功、选择器显示目标模型。经用户授权后，使用不包含私人文献内容的简短测试问题验证请求能够返回；这可能消耗服务商额度。未获模型调用授权时，只验证配置和模型列表，明确说明尚未测试回答。

确认原有文库、论文文件与其他服务商仍在，报告安装版本、profile、备份路径、所选模型和验证结果。报告和截图中遮挡密钥；不要把 prefs.js 原文输出到聊天中。

离线词典、模型与 Python 运行时并不包含在 XPI 中。除非用户明确要求，不安装这些额外资源，不开始整篇论文翻译，不发送用户文献，不更改系统输入法。遇到缺权限、登录或必要凭据时，精确说明缺少什么，不声称已配置完成。
