# NVIDIA NIM Chat Site

一个部署到 Cloudflare Pages 的 NVIDIA NIM 聊天站点。前端只访问同源 `/api/*`，NVIDIA API key、管理员账号和用户数据都保存在 Cloudflare 的服务端配置或 KV 中。

## 本地运行

1. 安装依赖：

   ```bash
   npm install
   ```

2. 创建 `.dev.vars`：

   ```bash
   cp .dev.vars.example .dev.vars
   ```

3. 修改 `.dev.vars`：

   ```env
   NVIDIA_API_KEY=your_nvidia_nim_api_key
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=change_this_password
   ```

4. 启动：

   ```bash
   npm run dev
   ```

## Cloudflare Pages 部署

项目继续使用 Cloudflare Pages + Pages Functions，不需要迁移到 Workers。

1. 设置 Secrets：

   ```bash
   npx wrangler pages secret put NVIDIA_API_KEY
   npx wrangler pages secret put ADMIN_USERNAME
   npx wrangler pages secret put ADMIN_PASSWORD
   ```

2. 确认 KV 绑定：

   `wrangler.toml` 已配置：

   ```toml
   [[kv_namespaces]]
   binding = "CHAT_KV"
   id = "ca5f55ca7b5a4211a3a6e03513555e5c"
   ```

   Cloudflare Pages 项目后台也需要有同名绑定 `CHAT_KV`，指向这个 KV namespace。

3. 部署：

   ```bash
   npm run deploy
   ```

## 账号模式

- 站点不开放自助注册。
- 管理员使用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。
- 普通用户只能由管理员在 `/admin.html` 后台创建。
- 删除普通用户后，该用户旧 session 会失效。
- 管理员修改普通用户密码后，该用户旧 session 会失效。
- 修改 `ADMIN_PASSWORD` 后，旧管理员 session 会失效，需要重新登录。

## 配置

- `NVIDIA_API_KEY`: 必填，NVIDIA NIM API key。
- `NVIDIA_BASE_URL`: 可选，默认 `https://integrate.api.nvidia.com/v1`。
- `NVIDIA_MODEL`: 可选，默认 `google/gemma-4-31b-it`。
- `ADMIN_USERNAME`: 必填，后台管理员用户名。
- `ADMIN_PASSWORD`: 必填，后台管理员密码。
- `SEARCH_PROVIDER`: 可选，`tavily` 或 `brave`。
- `TAVILY_API_KEY`: 可选，联网搜索使用 Tavily。
- `BRAVE_SEARCH_API_KEY`: 可选，联网搜索使用 Brave Search。
- `SEARCH_MAX_RESULTS`: 可选，联网搜索结果数，默认 `5`。

## 功能

- 多用户登录。
- 只允许后台创建普通用户。
- 管理员后台支持创建用户、删除用户、修改密码。
- 聊天接口和模型列表接口都要求有效 session。
- 支持多会话聊天、模型选择、Markdown 渲染、文件文本附加、联网搜索、主题切换、导出聊天记录。

## 参考

- [NVIDIA NIM for LLMs API Reference](https://docs.nvidia.com/nim/large-language-models/latest/reference/api-reference.html)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Cloudflare Pages Functions Bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Tavily Search API](https://docs.tavily.com/api-reference/endpoint/search)
- [Brave Search API](https://brave.com/search/api/)
