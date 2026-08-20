<!-- branch-cleanup-groupguard-2026-08-21 -->

# Branch Archive

## 2026-08-21 merged branch cleanup

本节记录 2026-08-21 清理前已完成验收的历史分支。清理原则：仅删除已确认进入 `main`、无开放 PR、未被本地 worktree 使用、且远程 tip 与验收记录一致的分支。删除的是分支引用，不删除已经进入 `main` 的提交历史。

### 1. `hotfix/windows-powershell51-encoding-20260820`
- 验收时 tip：`6e40762c3b8f384e37560966e98365d2c3165400`
- 对应合并：PR #43，merge commit `c2b1281c907d60d0c8945bdec665f4182fb79fc0`
- 目的：修复 Windows PowerShell 5.1 下部署/回滚脚本的编码兼容，并增加 CI 防回归。
- 主要影响：`.github/workflows/groupguard-ci.yml`、`scripts/windows/groupguard-rollback.ps1`、`scripts/windows/groupguard-update.ps1`
- 结论：功能和测试均已进入 `main`，分支仅保留历史引用价值，删除分支引用。

### 2. `hotfix/windows-shell-line-endings-20260820`
- 验收时 tip：`7025bcfb0043ab20b4a82f43709407e0b1eb69e8`
- 对应合并：PR #44，merge commit `ad738f02089ba228e7eb67085120ede29fed32d6`
- 目的：统一远程 shell / SCP 传输使用 LF，修复 Windows CRLF 带来的远程脚本执行问题。
- 主要影响：`.gitattributes`、GroupGuard CI、Windows update/rollback 脚本。
- 结论：修复已进入 `main`，删除分支引用。

### 3. `audit/config-maturity-20260819`
- 验收时 tip：`35e069cf6e590480cfc57f58b2f8a5cfbc9f3136`
- 对应合并：PR #42，merge commit `9427c6577439acf8987a208909fa8ae3e9c09e2d`
- 目的：完成 GroupGuard 配置架构成熟度收口，包括配置继承、持久化保护、WebUI、部署/回滚契约以及相关架构/运维文档。
- 结论：工程实现和文档已经完整进入 `main`，删除分支引用。

### 4. `docs/record-root-reconcile-production-20260809`
- 验收时 tip：`8e375c985c9f73916726bc6690940d7991e2a92b`
- 对应合并：PR #41，merge commit `455bdbbde2b6d1db7714a21c4f52b6b440df765e`
- 目的：记录 target-file root reconcile 的生产发布与验收结果。
- 结论：生产验收记录已进入 `main`，删除分支引用。

### 5. `docs/record-root-reconcile-production-20260809-duplicate`
- 验收时 tip：`276ddd1b9d2d986151057267dba7301d8244e955`
- 对应历史：与 PR #40/#41 收口链路重叠。
- 目的：中间阶段/重复的生产验收记录分支。
- 结论：内容已被正式生产记录链吸收，属于重复历史引用，删除分支引用。

### 6. `fix/target-file-retention-cleanup-20260809`
- 验收时 tip：`d1b33c6fbb308af5d004a5e9d3702b58f1eb49a9`
- 对应合并：PR #38，merge commit `b0c7f665a6a905a5d53590e72ac98cbd65056cef`
- 目的：修复 SnowLuma target-file 保留/删除策略以及失败临时文件清理，并补充验证和决策文档。
- 结论：代码、测试和文档均已进入 `main`，删除分支引用。

### 7. `fix/target-file-root-reconcile-20260809`
- 验收时 tip：`d6d13a5d53ecc93f2f6fd63508726c2354511326`
- 对应合并：PR #39，merge commit `d54a5ad9dac63f85db9bda1a8a6b6137f03e9712`
- 目的：实现 target-file exclusive root reconciliation，并完善 host profile、delivery/service、API/WebUI 与回归测试。
- 结论：实现已经进入 `main`，删除分支引用。

### 8. `tmp-ignore`
- 验收时 tip：`276ddd1b9d2d986151057267dba7301d8244e955`
- 目的：临时历史引用，与生产 root reconcile 收口链重叠。
- 结论：无独立有效内容需要继续作为分支存在，删除分支引用。

## 清理后的维护规则
- 新功能完成并正式进入默认分支后，应在相关 PR / 项目文档中保留目标、关键决策和最终状态。
- 临时诊断、重复验收、构建触发分支在任务结束后应及时关闭/删除，避免长期堆积。
- 有独有代码、开放 PR、本地 worktree 仍在使用、或无法证明已被主线吸收的分支，不按本节规则删除。
