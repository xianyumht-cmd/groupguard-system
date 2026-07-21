# 命令覆盖报告

- 生成时间：2026-06-21T14:58:33.833Z
- legacy 命令数量（去重后）：136
- 新路由完整命中数量：7
- 未匹配数量：129
- 覆盖率：5.15%

## 模块 matcher 摘要

- auth.ts: exact=3, prefixes=4
- interaction.ts: exact=16, prefixes=34
- moderation.ts: exact=14, prefixes=19
- qa.ts: exact=3, prefixes=17
- risk.ts: exact=37, prefixes=29
- system.ts: exact=18, prefixes=7

## 详细命中表

| 命令 | 类型 | matcher覆盖 | 处理实现 | 状态 |
| --- | --- | --- | --- | --- |
| 帮助 | exact | ✅ system.ts:exact | ❌ | UNMATCHED |
| 菜单 | exact | ✅ system.ts:exact | ❌ | UNMATCHED |
| 查询授权 | exact | ✅ auth.ts:exact | ✅ auth.ts | OK |
| 授权状态 | exact | ✅ auth.ts:exact | ✅ auth.ts | OK |
| 授权查询 | exact | ✅ auth.ts:exact | ✅ auth.ts | OK |
| 群管帮助 | exact | ✅ system.ts:exact | ❌ | UNMATCHED |
| 群管菜单 | exact | ✅ system.ts:exact | ❌ | UNMATCHED |
| 风控设置 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 安全设置 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭宵禁 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 定时列表 | exact | ✅ system.ts:exact | ❌ | UNMATCHED |
| 签到 | exact | ✅ interaction.ts:exact | ❌ | UNMATCHED |
| 签到榜 | exact | ✅ interaction.ts:exact | ❌ | UNMATCHED |
| 我的积分 | exact | ✅ interaction.ts:exact | ❌ | UNMATCHED |
| 邀请查询 | exact | ✅ interaction.ts:exact | ❌ | UNMATCHED |
| 邀请榜 | exact | ✅ interaction.ts:exact | ❌ | UNMATCHED |
| 运行状态 | exact | ✅ system.ts:exact | ❌ | UNMATCHED |
| 抽奖 | exact | ✅ interaction.ts:exact | ❌ | UNMATCHED |
| 积分商城 | exact | ✅ interaction.ts:exact | ❌ | UNMATCHED |
| 商城 | exact | ✅ interaction.ts:exact | ❌ | UNMATCHED |
| 关闭发言奖励 | exact | ✅ interaction.ts:exact | ❌ | UNMATCHED |
| 全体禁言 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 全体解禁 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 名片锁定列表 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 开启防撤回 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 关闭防撤回 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 防撤回列表 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 开启回应表情 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 关闭回应表情 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 针对列表 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 清除针对 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 关闭自身撤回 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 黑名单列表 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 群黑名单列表 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 白名单列表 | exact | ✅ moderation.ts:exact | ❌ | UNMATCHED |
| 违禁词列表 | exact | ✅ qa.ts:exact | ❌ | UNMATCHED |
| 拒绝词列表 | exact | ✅ qa.ts:exact | ❌ | UNMATCHED |
| 问答列表 | exact | ✅ qa.ts:exact | ❌ | UNMATCHED |
| 开启入群验证 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭入群验证 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 开启自动审批 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭自动审批 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 开启刷屏检测 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭刷屏检测 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 开启退群拉黑 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭退群拉黑 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭入群暗号 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 开启暗号回落 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭暗号回落 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 清空群配置 | exact | ✅ system.ts:exact | ❌ | UNMATCHED |
| 确认清空群配置 | exact | ✅ system.ts:exact | ❌ | UNMATCHED |
| 开启二维码撤回 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭二维码撤回 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 查看发送策略 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 查看SQLite状态 | exact | ✅ system.ts:exact | ❌ | UNMATCHED |
| 查看存储状态 | exact | ✅ system.ts:exact | ❌ | UNMATCHED |
| 开启调试 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭调试 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 开启随机后缀 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭随机后缀 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 开启全局自身撤回 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 关闭全局自身撤回 | exact | ✅ risk.ts:exact | ❌ | UNMATCHED |
| 授权  | startsWith | ✅ auth.ts:prefix | ✅ auth.ts | OK |
| 回收授权  | startsWith | ✅ auth.ts:prefix | ✅ auth.ts | OK |
| 查询授权  | startsWith | ✅ auth.ts:prefix | ✅ auth.ts | OK |
| 警告  | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 清除警告  | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 查看警告  | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 开启宵禁  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 开启功能  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 关闭功能  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置暗号  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 屏蔽  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 取消屏蔽  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置欢迎词  | startsWith | ✅ system.ts:prefix | ❌ | UNMATCHED |
| 定时任务  | startsWith | ✅ system.ts:prefix | ❌ | UNMATCHED |
| 删除定时任务  | startsWith | ✅ system.ts:prefix | ❌ | UNMATCHED |
| 查封号 | startsWith | ✅ interaction.ts:prefix | ❌ | UNMATCHED |
| 设置lolurl | startsWith | ✅ interaction.ts:prefix | ❌ | UNMATCHED |
| 设置lolkey | startsWith | ✅ interaction.ts:prefix | ❌ | UNMATCHED |
| 设置loltoken | startsWith | ✅ interaction.ts:prefix | ❌ | UNMATCHED |
| 查隐藏 | startsWith | ✅ interaction.ts:prefix | ❌ | UNMATCHED |
| 激活  | startsWith | ✅ auth.ts:prefix | ✅ auth.ts | OK |
| 兑换  | startsWith | ✅ interaction.ts:prefix | ❌ | UNMATCHED |
| 开启发言奖励  | startsWith | ✅ interaction.ts:prefix | ❌ | UNMATCHED |
| 踢出 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 禁言 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 解禁 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 授予头衔 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 清除头衔 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 锁定名片 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 解锁名片 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 针对 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 取消针对 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 开启自身撤回 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 拉黑 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 取消拉黑 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 群拉黑 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 群取消拉黑 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 白名单 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 取消白名单 | startsWith | ✅ moderation.ts:prefix | ❌ | UNMATCHED |
| 添加违禁词 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 添加全局违禁词 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 删除违禁词 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 删除全局违禁词 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 设置违禁词惩罚  | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 设置违禁词禁言  | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 添加拒绝词 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 添加全局拒绝词 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 删除拒绝词 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 删除全局拒绝词 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 模糊问 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 精确问 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 添加正则问答  | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 添加问答  | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 添加模糊问答  | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 删除问答  | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 删问 | startsWith | ✅ qa.ts:prefix | ❌ | UNMATCHED |
| 活跃统计 | startsWith | ✅ interaction.ts:prefix | ❌ | UNMATCHED |
| 设置刷屏窗口  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置刷屏阈值  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置刷屏禁言  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置入群暗号  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 多群广播  | startsWith | ✅ system.ts:prefix | ❌ | UNMATCHED |
| 设置权限缓存  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置复读阈值  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置随机延迟  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置发送队列模式  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置发送并发  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置全局限流  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置问答冷却  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置用户冷却  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置分级冷却  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置群熔断  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置回复概率  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |
| 设置回复模板  | startsWith | ✅ risk.ts:prefix | ❌ | UNMATCHED |

## 未匹配命令

- exact:帮助
- exact:菜单
- exact:群管帮助
- exact:群管菜单
- exact:风控设置
- exact:安全设置
- exact:关闭宵禁
- exact:定时列表
- exact:签到
- exact:签到榜
- exact:我的积分
- exact:邀请查询
- exact:邀请榜
- exact:运行状态
- exact:抽奖
- exact:积分商城
- exact:商城
- exact:关闭发言奖励
- exact:全体禁言
- exact:全体解禁
- exact:名片锁定列表
- exact:开启防撤回
- exact:关闭防撤回
- exact:防撤回列表
- exact:开启回应表情
- exact:关闭回应表情
- exact:针对列表
- exact:清除针对
- exact:关闭自身撤回
- exact:黑名单列表
- exact:群黑名单列表
- exact:白名单列表
- exact:违禁词列表
- exact:拒绝词列表
- exact:问答列表
- exact:开启入群验证
- exact:关闭入群验证
- exact:开启自动审批
- exact:关闭自动审批
- exact:开启刷屏检测
- exact:关闭刷屏检测
- exact:开启退群拉黑
- exact:关闭退群拉黑
- exact:关闭入群暗号
- exact:开启暗号回落
- exact:关闭暗号回落
- exact:清空群配置
- exact:确认清空群配置
- exact:开启二维码撤回
- exact:关闭二维码撤回
- exact:查看发送策略
- exact:查看SQLite状态
- exact:查看存储状态
- exact:开启调试
- exact:关闭调试
- exact:开启随机后缀
- exact:关闭随机后缀
- exact:开启全局自身撤回
- exact:关闭全局自身撤回
- startsWith:警告 
- startsWith:清除警告 
- startsWith:查看警告 
- startsWith:开启宵禁 
- startsWith:开启功能 
- startsWith:关闭功能 
- startsWith:设置暗号 
- startsWith:屏蔽 
- startsWith:取消屏蔽 
- startsWith:设置欢迎词 
- startsWith:定时任务 
- startsWith:删除定时任务 
- startsWith:查封号
- startsWith:设置lolurl
- startsWith:设置lolkey
- startsWith:设置loltoken
- startsWith:查隐藏
- startsWith:兑换 
- startsWith:开启发言奖励 
- startsWith:踢出
- startsWith:禁言
- startsWith:解禁
- startsWith:授予头衔
- startsWith:清除头衔
- startsWith:锁定名片
- startsWith:解锁名片
- startsWith:针对
- startsWith:取消针对
- startsWith:开启自身撤回
- startsWith:拉黑
- startsWith:取消拉黑
- startsWith:群拉黑
- startsWith:群取消拉黑
- startsWith:白名单
- startsWith:取消白名单
- startsWith:添加违禁词
- startsWith:添加全局违禁词
- startsWith:删除违禁词
- startsWith:删除全局违禁词
- startsWith:设置违禁词惩罚 
- startsWith:设置违禁词禁言 
- startsWith:添加拒绝词
- startsWith:添加全局拒绝词
- startsWith:删除拒绝词
- startsWith:删除全局拒绝词
- startsWith:模糊问
- startsWith:精确问
- startsWith:添加正则问答 
- startsWith:添加问答 
- startsWith:添加模糊问答 
- startsWith:删除问答 
- startsWith:删问
- startsWith:活跃统计
- startsWith:设置刷屏窗口 
- startsWith:设置刷屏阈值 
- startsWith:设置刷屏禁言 
- startsWith:设置入群暗号 
- startsWith:多群广播 
- startsWith:设置权限缓存 
- startsWith:设置复读阈值 
- startsWith:设置随机延迟 
- startsWith:设置发送队列模式 
- startsWith:设置发送并发 
- startsWith:设置全局限流 
- startsWith:设置问答冷却 
- startsWith:设置用户冷却 
- startsWith:设置分级冷却 
- startsWith:设置群熔断 
- startsWith:设置回复概率 
- startsWith:设置回复模板 

