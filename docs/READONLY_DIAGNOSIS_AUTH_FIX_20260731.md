# GroupGuard 只读诊断 SSH 认证修复

时间：2026-07-31 14:25 +08:00  
涉及任务：`GG-BATTLE-DELIVERY-001`、`GFM-DELETE-002`

## 首次执行结果

用户运行首版双任务只读诊断包后，脚本在第一条远程读取命令前失败：

```text
root@192.168.3.89: Permission denied (publickey,password).
Diagnosis failed with exit code 1.
```

上传的 `reports.zip` 只包含：

- 本地仓库状态；
- 静态源码证据；
- 初始摘要。

没有生成生产前快照、OneBot 只读探针、容器日志或生产后快照。因此本次执行没有取得任何 ARM 生产证据，也不能据此判断战绩 A/B/C/D/E 或 GFM 的结构、ID、延迟原因。

## 根因

首版 PowerShell 脚本为所有 SSH 调用强制加入：

```text
-o BatchMode=yes
```

该参数禁止交互式密码提示，只允许无需交互的密钥认证。当前服务器允许 `publickey,password`，但 Windows 端没有可用密钥，因此 SSH 直接拒绝。

同时，Windows PowerShell 5.1 在 `$ErrorActionPreference='Stop'` 时可能把原生程序 stderr 提升为 `NativeCommandError`，导致脚本在记录真实 SSH 退出码和友好错误前提前中止。

## v2 修复

新版诊断包已：

1. 移除 `BatchMode=yes`；
2. 允许 `publickey,keyboard-interactive,password`；
3. 允许最多三次密码输入；
4. 在调用 `ssh.exe` 时临时使用 `ErrorActionPreference=Continue`，随后按真实退出码处理；
5. 增加明确的登录失败提示；
6. 不保存、不输出 SSH 密码。

新版文件：

```text
GroupGuard-GFM-DELETE-002-GG-BATTLE-DELIVERY-001-readonly-diagnosis-kit-v2.zip
SHA-256: 9309f2f4ce1a9c6a0ff3b5104b6d8963c8ce1ede85a2d4a9a96824fb81cf6840
```

## 安全结论

本次失败发生在第一条远程读取命令建立连接之前：

```text
production_modified=false
service_restarted=false
build_executed=false
deployment_executed=false
git_updated=false
```

## 本地仓库附带发现

首次报告显示：

```text
branch=main
head=600bf3ca678b76061733485efe6bc2b06ba648dd
expected_branch=codex/gg-battle-delivery-diagnosis-20260731
working_tree_dirty=false
```

工作分支相对 `main` 的差异当前仅为诊断和交接文档，所以本地处于 `main` 不会造成这次 SSH 认证失败，也不阻止 v2 包执行只读生产采集。诊断阶段继续禁止自动 `git pull/reset/clean/checkout`。

## 下一步

1. 可先运行 `ssh root@192.168.3.89` 手动确认密码登录；
2. 解压并运行 v2 包中的 `run-readonly-groupguard-diagnosis.cmd`；
3. 遇到密码提示时输入 root 密码，输入内容不显示属于正常现象；
4. 按提示在 QQ 群执行一次真实“查战绩”；
5. 上传新生成的 `reports\groupguard-readonly-diagnosis-<timestamp>.zip`。
