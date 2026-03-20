# 数据库 MCP 服务器

MCP (Model Context Protocol) 服务器，使 AI 助手能够安全地查询和操作多种类型的远程数据库。

## 功能特性

- **多数据库支持**：MySQL、PostgreSQL（预留扩展接口）
- **安全连接**：通过 SSH 隧道连接远程数据库
- **权限控制**：三级组合控制（连接级 + 表级 + 操作级）
- **SQL 安全**：分层防护（智能检测 + 危险操作确认）
- **元数据查询**：支持查询表、字段、索引等元数据

---

## 部署方式

### 方式一：Docker 一键部署（推荐）

#### 1. 准备配置文件

```bash
# 复制示例配置
cp config.example.json config.json

# 编辑配置文件
vim config.json
```

#### 2. 创建环境变量文件

```bash
# 创建 .env 文件
cat > .env << 'EOF'
MYSQL_PASSWORD=your_mysql_password
POSTGRES_PASSWORD=your_postgres_password
EOF
```

#### 3. 启动服务

```bash
# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f db-mcp
```

#### 4. 停止服务

```bash
docker compose down
```

---

### 方式二：本地直接部署

#### 1. 安装依赖

```bash
npm install
npm run build
```

#### 2. 配置

```bash
cp config.example.json config.json
# 编辑 config.json
```

#### 3. 运行

```bash
npm start
```

---

## 配置详解

### 服务器端配置

#### config.json 配置文件

```json
{
  "databases": [
    {
      "name": "my-mysql",
      "type": "mysql",
      "host": "db.example.com",
      "port": 3306,
      "database": "your_database",
      "username": "db_user",
      "password": "${MYSQL_PASSWORD}",
      "ssh": {
        "host": "jump.example.com",
        "port": 22,
        "username": "ssh_user",
        "privateKey": "~/.ssh/id_rsa",
        "passphrase": "${SSH_PASSPHRASE}"
      },
      "permissions": {
        "level": "readonly",
        "tableOverrides": {
          "users": "readonly",
          "logs": "readwrite"
        },
        "forbiddenOperations": ["DELETE", "DDL"]
      }
    }
  ]
}
```

#### 配置项说明

| 配置项 | 必填 | 说明 |
|--------|------|------|
| `name` | 是 | 连接名称，工具调用时使用 |
| `type` | 是 | 数据库类型：`mysql` / `postgresql` |
| `host` | 是 | 数据库服务器地址 |
| `port` | 是 | 数据库端口 |
| `database` | 是 | 数据库名称 |
| `username` | 是 | 数据库用户名 |
| `password` | 是 | 数据库密码（支持环境变量 `${ENV_VAR}`） |
| `ssh` | 否 | SSH 隧道配置 |
| `ssh.host` | 是 | SSH 服务器地址 |
| `ssh.port` | 否 | SSH 端口，默认 22 |
| `ssh.username` | 是 | SSH 用户名 |
| `ssh.privateKey` | 是 | SSH 私钥路径或内容 |
| `ssh.passphrase` | 否 | 私钥密码 |
| `permissions` | 是 | 权限配置 |
| `permissions.level` | 是 | 权限级别 |
| `permissions.tableOverrides` | 否 | 表级权限覆盖 |
| `permissions.forbiddenOperations` | 否 | 禁止的操作类型 |

#### 权限级别

| 级别 | 允许的操作 |
|------|----------|
| `readonly` | 仅 SELECT |
| `readwrite` | SELECT, INSERT, UPDATE, DELETE |
| `admin` | 所有操作，包括 DDL |

#### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_MCP_CONFIG` | 配置文件路径 | `./config.json` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `MYSQL_PASSWORD` | MySQL 密码（示例） | - |
| `POSTGRES_PASSWORD` | PostgreSQL 密码（示例） | - |

---

### 本地 Claude Code 配置

#### Claude Desktop 配置

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "db-mcp": {
      "command": "node",
      "args": ["/path/to/db-mcp/dist/index.js"],
      "env": {
        "DB_MCP_CONFIG": "/path/to/db-mcp/config.json",
        "MYSQL_PASSWORD": "your_password"
      }
    }
  }
}
```

#### Claude Code CLI 配置

在项目目录创建 `.mcp.json` 或在用户目录创建 `~/.claude/mcp.json`：

```json
{
  "mcpServers": {
    "db-mcp": {
      "command": "node",
      "args": ["/Users/yourname/projects/db-mcp/dist/index.js"],
      "env": {
        "DB_MCP_CONFIG": "/Users/yourname/projects/db-mcp/config.json",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

#### 连接远程 Docker 部署的 MCP

```json
{
  "mcpServers": {
    "db-mcp-remote": {
      "url": "http://your-server:3000/sse",
      "transport": "sse"
    }
  }
}
```

---

## Docker 部署详细说明

### 目录结构

```
db-mcp/
├── Dockerfile
├── docker-compose.yml
├── config/
│   └── config.json      # 配置文件（需手动创建）
├── .env                 # 环境变量（需手动创建）
├── src/
├── dist/
└── package.json
```

### Docker 命令

```bash
# 构建镜像
docker build -t db-mcp:latest .

# 运行容器（stdio 模式）
docker run -d \
  --name db-mcp \
  -v $(pwd)/config:/app/config:ro \
  -v ~/.ssh:/root/.ssh:ro \
  -e MYSQL_PASSWORD=${MYSQL_PASSWORD} \
  db-mcp:latest

# 运行容器（SSE 模式，支持远程连接）
docker run -d \
  --name db-mcp-sse \
  -p 3000:3000 \
  -v $(pwd)/config:/app/config:ro \
  -v ~/.ssh:/root/.ssh:ro \
  -e MCP_TRANSPORT=sse \
  -e MCP_PORT=3000 \
  -e MYSQL_PASSWORD=${MYSQL_PASSWORD} \
  db-mcp:latest

# 查看日志
docker logs -f db-mcp

# 进入容器调试
docker exec -it db-mcp sh
```

### Docker Compose 命令

```bash
# 启动所有服务
docker compose up -d

# 仅启动 stdio 模式
docker compose up -d db-mcp

# 仅启动 SSE 模式
docker compose up -d db-mcp-sse

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止并删除
docker compose down

# 重新构建
docker compose up -d --build
```

---

## MCP 工具列表

| 工具名称 | 功能 | 示例 |
|---------|------|------|
| `db_query` | 执行 SQL 查询 | `SELECT * FROM users LIMIT 10` |
| `db_metadata` | 查询数据库元数据 | 获取表结构、索引信息 |
| `db_list_connections` | 列出可用连接 | 查看所有配置的数据库连接 |
| `db_test_connection` | 测试连接 | 验证数据库连接是否正常 |
| `db_explain` | 分析执行计划 | 查询 SQL 执行计划 |
| `db_sample_data` | 获取样本数据 | 获取表中前 N 行数据 |

---

## 开发

```bash
# 开发模式（热重载）
npm run dev

# 构建
npm run build

# 类型检查
npm run typecheck

# 测试
npm run test

# 代码检查
npm run lint
```

---

## 安全提示

1. **权限最小化**：生产环境建议使用 `readonly` 权限
2. **环境变量**：敏感配置使用环境变量，不要硬编码密码
3. **SSH 密钥**：私钥权限设置为 `600`
4. **配置文件**：配置文件权限设置为 `600`
5. **网络安全**：SSE 模式建议配合反向代理（Nginx）和 HTTPS
6. **访问控制**：Docker 部署建议限制容器网络访问

---

## 故障排查

### 常见问题

1. **SSH 连接失败**
   ```bash
   # 检查 SSH 密钥权限
   chmod 600 ~/.ssh/id_rsa

   # 测试 SSH 连接
   ssh -v ssh_user@jump.example.com
   ```

2. **数据库连接超时**
   ```bash
   # 检查 SSH 隧道是否正常
   # 检查数据库端口是否可访问
   ```

3. **权限被拒绝**
   - 检查 `permissions.level` 配置
   - 检查 `tableOverrides` 是否覆盖了权限
   - 检查 `forbiddenOperations` 黑名单

4. **Docker 容器无法启动**
   ```bash
   # 查看详细日志
   docker compose logs db-mcp

   # 检查配置文件是否存在
   ls -la config/config.json
   ```

---

## License

MIT
