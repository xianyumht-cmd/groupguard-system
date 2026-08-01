# 🛡️ GroupGuard 群管理系统

[![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)](onebot-plugin-groupguard/package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

GroupGuard 是面向 QQ 群管理与自动化场景的完整系统，集成风控防护、商业授权、互动娱乐、入群验证、自动问答、动态命令和 WebUI 配置等能力。

## 项目身份与运行环境

- **项目名称**：GroupGuard
- **仓库名称**：`groupguard-system`
- **核心程序目录**：`onebot-plugin-groupguard`
- **当前生产运行环境**：SnowLuma
- **通信与适配层**：OneBot
- **NapCat 状态**：保留兼容构建，不代表当前生产环境

> 后续排查、开发和部署应优先按 SnowLuma 链路判断。仓库中的 `napcat-types`、`napcat` 元数据和 `build:napcat` 脚本属于兼容层，不应据此判断当前实际宿主。

## ✨ 核心特性

### 🛡️ 安全风控
- **入群验证**：支持数学验证、暗号验证、自动同意等多种模式。
- **违禁词过滤**：多级惩罚机制（撤回、禁言、踢出、拉黑），支持正则匹配。
- **防刷屏与复读**：支持自定义时间窗口、触发阈值和自动处罚。
- **媒体屏蔽**：支持图片、视频、语音、链接、二维码、名片和小程序等类型。
- **防撤回记录**：记录撤回事件，具体呈现方式以当前服务设置为准。

### 💼 商业授权
- **分级授权**：支持免费版、专业版、企业版差异化功能控制。
- **自动过期**：授权到期后自动降级。
- **在线激活**：支持通过激活码实时激活授权。

### 🎮 互动娱乐
- **签到系统**：每日签到、连续签到奖励和积分累计。
- **积分商城**：支持兑换免死金牌、自定义头衔和解除禁言等物品。
- **抽奖系统**：使用积分参与抽奖并获取随机奖励。
- **活跃统计**：统计群成员发言活跃度排行。

### 🤖 智能辅助
- **问答系统**：支持精确、模糊和正则三种匹配方式。
- **动态命令**：支持通过配置接入查询和自动化能力。
- **定时任务**：支持群内设置每日消息任务。
- **入群欢迎**：支持自定义欢迎语。

## 📖 快速上手

### 激活授权

系统启动后，默认处于未授权状态，部分功能受限。

- 群内发送：`激活 <激活码>`，例如 `激活 PRO-30-ABCDEF`
- 查询状态：`查询授权`

### 常用指令

| 指令 | 说明 | 示例 |
|---|---|---|
| `踢出 @某人` | 踢出成员 | `踢出 @张三` |
| `禁言 @某人 <分钟>` | 禁言指定时长 | `禁言 @李四 30` |
| `解禁 @某人` | 解除禁言 | `解禁 @李四` |
| `警告 @某人` | 记录一次警告 | `警告 @王五` |
| `全体禁言` / `全体解禁` | 切换全员禁言 | `全体禁言` |
| `开启/关闭功能 <功能名>` | 开关群管理功能 | `关闭功能 问答` |
| `屏蔽/取消屏蔽 <类型>` | 开关消息类型过滤 | `屏蔽 链接` |

> 客户优先使用 [玻璃主题网页手册](USER_MANUAL.html)，支持搜索、分类和一键复制。飞书同步及纯文本备份使用 [Markdown 手册](USER_MANUAL.md)。

## 🧰 构建与运行

在仓库根目录执行：

```bash
npm --prefix onebot-plugin-groupguard install
npm test
```

### SnowLuma（当前生产链路）

```bash
npm run build:snowluma
npm --prefix onebot-plugin-groupguard run start:snowluma
```

SnowLuma 构建入口为：

```text
onebot-plugin-groupguard/dist/snowluma-service.mjs
```

实际生产环境通常由容器或服务管理器执行该入口，不应按 NapCat 插件目录的部署方式处理。

### NapCat（兼容链路）

```bash
npm run build
```

该构建用于兼容 NapCat 插件运行方式，不是当前生产部署的默认路径。

## ⚠️ 注意事项

- 踢人、禁言等操作要求机器人在目标群拥有管理员或群主权限。
- 建议定期备份配置、数据库和运行数据目录。
- 排查宿主能力时，应先核对 SnowLuma 是否提供对应事件和 OneBot 动作，不能直接引用 NapCat 专属接口作为结论。
- 项目身份和维护路径详见 [`docs/PROJECT_IDENTITY.md`](docs/PROJECT_IDENTITY.md)。

---

&copy; 2024 GroupGuard. All Rights Reserved.
