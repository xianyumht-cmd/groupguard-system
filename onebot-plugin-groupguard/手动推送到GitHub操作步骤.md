# 手动推送到 GitHub 操作步骤（大白话版）

下面这套流程，照着敲就能把本地改动推到 GitHub。

## 1）先确认你在正确目录

在终端先进入项目目录：

```powershell
cd D:\project2\napcatplugin\lengxi_repo\onebot-plugin-groupguard
```

## 2）看看哪些文件改了

```powershell
git status --short
```

看到 `M`、`A` 这些标记就是有改动，正常。

## 3）把改动加入提交区

如果你想一次性提交全部改动：

```powershell
git add .
```

如果你只想提交某几个文件，就把文件路径写上去：

```powershell
git add src/services/interaction_service.ts
git add webui/config.html
```

## 4）提交一次版本

```powershell
git commit -m "feat(groupguard): 增加封号查询主备接口自动切换与可配置能力"
```

如果提示“nothing to commit”，说明你可能还没 `git add`，或者之前已经提交过。

## 5）确认当前分支

```powershell
git branch --show-current
```

一般是 `main`，如果不是，记住当前分支名。

## 6）推送到 GitHub

如果当前是 `main`：

```powershell
git push origin main
```

如果你在别的分支（比如 `feature/ban-api`）：

```powershell
git push origin feature/ban-api
```

## 7）推送后检查

```powershell
git status
```

如果看到下面这种，说明已经推上去了：

- `nothing to commit, working tree clean`
- `Your branch is up to date with 'origin/xxx'`

---

## 常见报错怎么处理

### 报错：`rejected` / `non-fast-forward`

说明远程比你本地新，先拉再推：

```powershell
git pull --rebase origin main
git push origin main
```

### 报错：要登录或权限不足

- 检查你是否有该仓库权限
- 检查远程地址是否正确：`git remote -v`
- 使用正确账号重新登录 GitHub（或更新凭据）

### 报错：有冲突

- 打开冲突文件，处理冲突标记
- 处理完后：

```powershell
git add .
git rebase --continue
git push origin main
```

