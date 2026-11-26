# Slidebrief · 汇报工坊

Slidebrief 帮助需要准备项目进展、复盘和方案汇报的用户，把零散材料整理为可以继续编辑的 PowerPoint。汇报目标和听众会影响内容取舍，内置示例可直接体验预览、编辑、换主题和下载。

| Anna App | 信息 |
| --- | --- |
| App name | `Slidebrief · 汇报工坊` |
| Slug | `slidebrief-studio` |
| 版本 | `1.0.0` |

![Slidebrief 的汇报任务、幻灯片预览与主题选择](docs/workspace.png)

## 体验流程

1. 在 [Anna staging](https://staging.anna.partners) 的应用中心安装并打开 Slidebrief。也可在 Anna 聊天中通过 `#` 选择已安装的 Slidebrief，请它打开工作区并带入 brief。
2. 填写主题，选择 4、5、6 或 8 页。补充听众、汇报目标和参考资料，可以让结论与素材更贴合实际。
3. 生成后逐页检查。可直接编辑文字和演讲备注、更换主题，也可用一条修改要求让 Anna 重写当前页。
4. 下载 `.pptx`，用 PowerPoint 或 WPS 打开。标题、正文和图形都是可编辑对象，演讲备注也写入文件。

## Anna 集成和额度

应用通过 Anna App Runtime 的 `llm.complete` 调用当前账号的模型。生成整份简报与重写单页各发起一次请求，分别限制输出长度。示例、手动编辑、切换主题和 PPTX 导出都在浏览器内完成，不调用模型。每次生成前可以先检查 brief，出现异常时由用户决定是否重试。真实调用消耗执行账号的 Anna 额度。 [Anna LLM API](https://staging.anna.partners/developers/apps/llm-and-agent)

## 本地运行

需要 Node.js 22 或更新版本。

```sh
npm ci
npm run dev
npm test
npm run validate
```

本地页面可体验内置示例、编辑和导出。Anna AI 生成功能在 Anna 应用窗口中运行。`npm run validate` 构建 `bundle/` 并通过 Anna 官方 CLI 检查应用清单和构建产物。

## 上传和发布

1. 用已验证邮箱的账号登录 [Anna 开发者控制台](https://staging.anna.partners/developer)，阅读并接受开发者条款，激活开发者访问权限并设置 handle。应用以 `@handle/slidebrief-studio` 标识。 [开发者验证](https://staging.anna.partners/developers/reference/verified-developer)
2. 在项目目录运行以下命令，按 CLI 提示在浏览器授权登录，随后上传工作草稿。

```sh
npm run validate
npx anna-app login --host https://staging.anna.partners --no-browser
npx anna-app whoami
npx anna-app apps push --account https://staging.anna.partners
```

3. 在开发者控制台打开该应用，安装并试用版本 `0.0.0-draft`。验证示例、编辑和导出后，使用内置「客户支持知识库四周试点」的 brief，选择 4 页并发起一次 AI 生成。检查页数、标题与要点、材料中的数字是否仍明确标为目标或计划、演讲备注和可编辑的 PPTX，并记录平台返回的额度消耗。按需再验证一次单页重写。
4. 用已验证的草稿创建版本并提交审核。

```sh
npx anna-app apps cut 1.0.0 --account https://staging.anna.partners
npx anna-app apps submit-review --account https://staging.anna.partners
```

5. 审核通过后发布版本，随后在应用中心验证安装与打开状态。公开入口为 `https://staging.anna.partners/store/@<handle>/slidebrief-studio`。若平台在批准时同时发布，直接核查 `PUBLISHED` 状态即可。 [发布流程](https://staging.anna.partners/developers/apps/app-publish)

```sh
npx anna-app apps release 1.0.0 --account https://staging.anna.partners
npx anna-app apps status slidebrief-studio --account https://staging.anna.partners
```

## 验证记录

本地通过 Anna CLI 严格校验与自动测试。桌面与窄屏浏览器验证了预览、编辑、主题切换、草稿保存和下载，PowerPoint 打开并渲染了覆盖 3 套主题和 5 种版式的样片。模拟 Anna 窗口验证了聊天字段带入、整稿生成与单页改写各发起一次请求，以及窗口内下载。

Staging 真实测试、额度记录和公开发布须在账号授权后完成。
