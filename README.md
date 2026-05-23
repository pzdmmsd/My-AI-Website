# NVIDIA NIM Chat Site

一个部署在 Cloudflare Pages 上的多用户 AI 聊天站点。前端只访问同源 `/api/*`，NVIDIA API Key、管理员账号和用户数据都保存在 Cloudflare 的服务端配置或 KV 中，不会暴露给浏览器。

## 主要功能

- 多用户登录，不开放自助注册。
- 普通用户只能由管理员在后台创建。
- 普通用户可以在设置中修改自己的密码。
- 管理员可以创建用户、删除用户、重置普通用户密码。
- 每个用户的对话记录会同步到 Cloudflare KV，同一账号在不同设备登录后读取同一份聊天记录。
- 支持多会话、会话列表抽屉、移动端和桌面端响应式布局。
- 支持模型选择、系统提示词、温度、最大输出长度、联网搜索、文件文本附加、Markdown 渲染、代码块渲染和聊天记录导出。
- 支持亮色、暗色和跟随系统主题。
- 支持每个用户单独选择主题颜色偏好。
- AI 回答会显示耗时，并在流式输出时使用渐变文字效果。

## 技术栈

- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare KV
- NVIDIA NIM OpenAI-compatible API
- 原生 HTML、CSS、JavaScript

## 项目结构

```text
public/
  index.html          # 聊天主界面
  admin.html          # 管理员后台
  app.js              # 聊天端逻辑
  admin.js            # 后台管理逻辑
  styles.css          # 全站样式
  _headers            # 安全响应头

functions/
  _auth.js            # 登录、session、密码和用户权限工具
  _models.js          # 模型列表工具
  _search.js          # 联网搜索工具
  api/
    chat.js           # 聊天 API
    models.js         # 模型列表 API
    state.js          # 用户聊天状态同步 API
    admin/users.js    # 管理员用户管理 API
    auth/login.js     # 登录 API
    auth/logout.js    # 登出 API
    auth/me.js        # 当前登录用户 API
    auth/password.js  # 普通用户修改密码 API
```

## 本地运行

1. 安装依赖：

   ```bash
   npm install
   ```

2. 创建本地环境变量文件：

   ```bash
   cp .dev.vars.example .dev.vars
   ```

3. 编辑 `.dev.vars`：

   ```env
   NVIDIA_API_KEY=your_nvidia_nim_api_key
   NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
   NVIDIA_MODEL=openai/gpt-oss-120b
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=change_this_password
   SEARCH_PROVIDER=tavily
   TAVILY_API_KEY=
   BRAVE_SEARCH_API_KEY=
   SEARCH_MAX_RESULTS=5
   ```

4. 启动本地开发服务：

   ```bash
   npm run dev
   ```

## Cloudflare Pages 部署

项目当前适合继续使用 Cloudflare Pages + Pages Functions，不需要迁移到 Workers。`wrangler.toml` 已配置 Pages 输出目录和 KV 绑定：

```toml
name = "nvidia-nim-chat-site"
compatibility_date = "2026-05-21"
pages_build_output_dir = "public"

[vars]
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
NVIDIA_MODEL = "openai/gpt-oss-120b"

[[kv_namespaces]]
binding = "CHAT_KV"
id = "ca5f55ca7b5a4211a3a6e03513555e5c"
```

Cloudflare Pages 项目后台也需要绑定同名 KV：

- Binding name: `CHAT_KV`
- KV namespace id: `ca5f55ca7b5a4211a3a6e03513555e5c`

部署前设置 Secrets：

```bash
npx wrangler pages secret put NVIDIA_API_KEY
npx wrangler pages secret put ADMIN_USERNAME
npx wrangler pages secret put ADMIN_PASSWORD
```

如果使用联网搜索，再按需要设置：

```bash
npx wrangler pages secret put TAVILY_API_KEY
npx wrangler pages secret put BRAVE_SEARCH_API_KEY
```

部署：

```bash
npm run deploy
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `NVIDIA_API_KEY` | 是 | NVIDIA NIM API Key |
| `NVIDIA_BASE_URL` | 否 | NVIDIA API Base URL，默认 `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_MODEL` | 否 | 默认模型，当前默认 `openai/gpt-oss-120b` |
| `ADMIN_USERNAME` | 是 | 管理员用户名 |
| `ADMIN_PASSWORD` | 是 | 管理员密码 |
| `SEARCH_PROVIDER` | 否 | 联网搜索提供方，可用 `tavily` 或 `brave` |
| `TAVILY_API_KEY` | 否 | Tavily 搜索 API Key |
| `BRAVE_SEARCH_API_KEY` | 否 | Brave Search API Key |
| `SEARCH_MAX_RESULTS` | 否 | 搜索结果数量，默认 `5` |

## 账号和权限

- 管理员使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。
- 管理员入口只对管理员显示，普通用户界面不显示后台入口。
- 普通用户只能通过管理员后台创建，不能自己注册。
- 普通用户可以在聊天界面的设置中修改自己的密码。
- 管理员不能在普通设置里修改管理员密码；管理员密码通过 Cloudflare Secret 管理。
- 删除用户或重置用户密码后，该用户旧 session 会失效。
- 修改 `ADMIN_PASSWORD` 后，管理员旧 session 会失效，需要重新登录。

## 数据存储

`CHAT_KV` 用于保存：

- 普通用户账号信息。
- 用户 session。
- 每个用户的聊天状态和对话记录。

聊天状态按用户隔离，同一个账号的所有对话会同步。前端仍会保留本地缓存，用于改善加载体验；登录后会优先读取远端 KV 中的状态。

## 安全说明

- API Key 只存在服务端环境变量或 Secret 中。
- 浏览器不会直接访问 NVIDIA API。
- `/api/chat`、`/api/models`、`/api/state` 等接口都要求有效 session。
- 后台用户管理接口要求管理员 session。
- `_headers` 已配置基础安全响应头，包括 CSP、权限策略和 frame 限制。

## 常见问题

### 需要从 Cloudflare Pages 迁移到 Workers 吗？

不需要。当前项目是静态前端加 Pages Functions 的结构，Cloudflare Pages 可以直接支持 API 路由、KV 绑定和 Secrets。除非后续需要 Workers 独有能力，例如队列、Durable Objects、复杂路由或跨项目共享 Worker，否则继续使用 Pages 更简单。

### 普通用户为什么不能注册？

这是当前设计。用户只能由管理员创建，适合私有工具、小团队或受控访问场景。

### 为什么后台要单独配置 KV 绑定？

`wrangler.toml` 用于本地和 Wrangler 部署配置；Cloudflare Pages 控制台中的生产环境也需要有同名 `CHAT_KV` 绑定，Pages Functions 才能在生产环境访问 KV。

## 参考链接

- [NVIDIA NIM for LLMs API Reference](https://docs.nvidia.com/nim/large-language-models/latest/reference/api-reference.html)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Cloudflare Pages Functions Bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [Tavily Search API](https://docs.tavily.com/api-reference/endpoint/search)
- [Brave Search API](https://brave.com/search/api/)
