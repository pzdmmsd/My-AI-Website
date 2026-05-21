# NVIDIA NIM Chat Site

一个部署到 Cloudflare Pages 的 NVIDIA NIM 聊天网页。前端只访问同源 `/api/chat`，NVIDIA API key 保存在 Cloudflare Secret 中。

## 本地运行 

1. 安装依赖：

   ```bash
   npm install
   ```

2. 创建 `.dev.vars`：

   ```bash
   cp .dev.vars.example .dev.vars
   ```

   然后把 `.dev.vars` 里的 `NVIDIA_API_KEY` 改成你的真实密钥。

3. 启动：

   ```bash
   npm run dev
   ```

## Cloudflare 部署

1. 登录 Cloudflare：

   ```bash
   npx wrangler login
   ```

2. 设置 Secret：

   ```bash
   npx wrangler pages secret put NVIDIA_API_KEY
   npx wrangler pages secret put APP_PASSWORD
   ```

   `APP_PASSWORD` 可不设置；不设置时站点公开可访问。

3. 部署：

   ```bash
   npm run deploy
   ```

## 配置

- `NVIDIA_API_KEY`: 必填，NVIDIA NIM API key。
- `NVIDIA_BASE_URL`: 默认 `https://integrate.api.nvidia.com/v1`。
- `NVIDIA_MODEL`: 默认 `google/gemma-4-31b-it`。
- `APP_PASSWORD`: 可选，给网站加一个简单访问密码。
- `SEARCH_PROVIDER`: 可选，`tavily` 或 `brave`，默认优先使用 Tavily。
- `TAVILY_API_KEY`: 可选，开启联网模式时用于 Tavily Search API。
- `BRAVE_SEARCH_API_KEY`: 可选，开启联网模式时用于 Brave Search API。
- `SEARCH_MAX_RESULTS`: 可选，联网模式每次搜索使用的结果数，默认 `5`。

## 功能

- 从 NVIDIA `GET /v1/models` 动态读取当前 API key 可见模型，并显示为下拉列表。
- 下拉列表会用极短的 `/v1/chat/completions` 请求验证模型，只有真实可用于聊天的模型才会展示。
- 模型验证结果缓存在 Cloudflare Cache 中；网页读取 `/api/models` 会立即返回缓存，缓存过旧时后端会用 `waitUntil` 在后台刷新。可访问 `/api/models?refresh=1` 强制同步刷新。
- 支持 ChatGPT 风格的多对话列表。
- 支持 System / Dark / Light 三种主题模式。
- 按 Enter 发送，Shift+Enter 换行。
- 支持分批上传文本类文件，单个文件超过 180 KB 会被拒绝；聊天界面只显示文件卡片，发送给模型时才附加文件内容。
- AI 回复标题显示实际返回的模型名称。
- AI 回复会按 Markdown 渲染。
- Markdown 代码块会显示语言标签，并提供轻量关键字高亮。
- 页面固定为应用高度，长对话只在消息区滚动。
- 联网模式会先搜索网页，再把来源片段注入模型上下文；AI 回复下方会显示来源链接。需要配置 `TAVILY_API_KEY` 或 `BRAVE_SEARCH_API_KEY`。
- 多个对话可以同时生成；右上角 Stop 只停止当前打开的对话。
- Web 模式按对话单独保存，不同对话可以独立开关。
- 对话列表支持悬停删除；已发送的用户消息支持编辑，并会从编辑位置截断后续内容重新生成。
- 对话标题会在首轮问答完成后由模型根据首个问题和回答自动生成。

如果希望完全按固定时间刷新模型可用性，可以用 Cloudflare Workers Cron Trigger 定时请求线上 `/api/models?refresh=1`。当前 Pages Function 已经支持该刷新入口。

如果 NVIDIA 返回 `Function ... Not found for account ...`，通常是当前 API key 对请求的模型没有权限。把 `.dev.vars` 或 Cloudflare Secret/变量里的 `NVIDIA_MODEL` 改成该 key 可访问的模型，然后重启本地服务或重新部署。

NVIDIA NIM LLM 提供 OpenAI-compatible `/v1/chat/completions` 和 `GET /v1/models` 接口。Cloudflare Pages Function 在服务端转发请求，避免密钥泄露到浏览器；前端模型下拉列表会优先读取当前 API key 可见的模型。

参考：

- [NVIDIA NIM for LLMs API Reference](https://docs.nvidia.com/nim/large-language-models/latest/reference/api-reference.html)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Tavily Search API](https://docs.tavily.com/api-reference/endpoint/search)
- [Brave Search API](https://brave.com/search/api/)
