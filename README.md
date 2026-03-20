# 数据库 MCP 服务器

MCP (Model Context Protocol) 服务器，使 AI 助手能够安全地查询和操作多种类型的远程数据库。

## 功能特性

- **多数据库支持**：MySQL、PostgreSQL（预留扩展接口）
- **安全连接**：通过 SSH 隧道连接远程数据库
- **权限控制**：三级组合控制（连接级 + 表级 + 操作级）
- **SQL 安全**：分层防护（智能检测 + 危险操作确认）
- **元数据查询**：支持查询表、字段、索引等元数据

---

## 快速开始

### 本地运行

```bash
# 1. 安装依赖
npm install && npm run build

# 2. 配置数据库连接
cp config.example.json config.json
# 编辑 config.json，填入数据库信息

# 3. 启动
npm start
```

### Docker 部署

```bash
# 1. 准备配置
cp config.example.json config.json
cp .env.example .env
# 编辑配置文件

# 2. 一键启动
docker compose up -d

# 3. 查看日志
docker compose logs -f
```

---

## 部署架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        远程服务器                                 │
│  ┌─────────────┐         ┌─────────────┐         ┌───────────┐  │
│  │  MCP 服务器  │ ──────▶ │  跳板机     │ ──────▶ │  数据库    │  │
│  │ (SSE/stdio) │  SSH    │ (可选)      │  内网    │ (MySQL/PG)│  │
│  └─────────────┘         └─────────────┘         └───────────┘  │
│        ▲                                                        │
│        │ SSE over HTTP                                          │
└────────┼─────────────────────────────────────────────────────────┘
         │
         │
┌────────┴────────┐
│   本地 Claude    │
│   Code / Desktop │
└─────────────────┘
```

---

## 远程服务器部署

### 1. 目录结构

```
/opt/db-mcp/
├── config/
│   ├── config.json       # 数据库连接配置
│   └── .env              # 环境变量（密码）
├── docker-compose.yml
├── Dockerfile
├── .ssh/                 # SSH 密钥（如需要跳板机）
│   └── id_rsa
└── src/
```

### 2. 创建配置文件

```bash
# 创建配置目录
mkdir -p /opt/db-mcp/config

# 创建数据库配置
cat > /opt/db-mcp/config/config.json << 'EOF'
{
  "databases": [
    {
      "name": "mysql-dev",
      "type": "mysql",
      "host": "db.example.com",
      "port": 3306,
      "database": "your_database",
      "username": "db_user",
      "password": "${MYSQL_PASSWORD}",
      "permissions": { "level": "readwrite" }
    }
  ]
}
EOF

# 创建环境变量
cat > /opt/db-mcp/config/.env << 'EOF'
MYSQL_PASSWORD=your_password
EOF
```

### 3. 启动 SSE 服务

```bash
cd /opt/db-mcp

# 启动 SSE 模式（支持远程连接）
docker compose up -d db-mcp-sse

# 验证服务
curl http://localhost:3000/health
```

### 4. 防火墙配置

```bash
# 开放 3000 端口
sudo ufw allow 3000/tcp
# 或
sudo firewall-cmd --add-port=3000/tcp --permanent
sudo firewall-cmd --reload
```

---

## 本地 Claude Code 配置

### 方式一：连接本地 MCP

在 `~/.claude/mcp.json` 配置：

```json
{
  "mcpServers": {
    "db-mcp-local": {
      "command": "node",
      "args": ["/path/to/db-mcp/dist/index.js"],
      "env": {
        "DB_MCP_CONFIG": "/path/to/db-mcp/config.json"
      }
    }
  }
}
```

### 方式二：连接远程 SSE 服务

```json
{
  "mcpServers": {
    "db-mcp-remote": {
      "url": "http://your-server.com:3000/sse",
      "transport": "sse"
    }
  }
}
```

**注意**：远程模式下，数据库配置和密码都在服务器端，本地无需任何敏感信息。

---

## 配置详解

### 数据库配置示例

```json
{
  "databases": [
    {
      "name": "mysql-dev",
      "type": "mysql",
      "host": "db-dev.example.com",
      "port": 3306,
      "database": "app_db",
      "username": "app_user",
      "password": "${MYSQL_DEV_PASSWORD}",
      "permissions": {
        "level": "readwrite"
      }
    },
    {
      "name": "mysql-prod",
      "type": "mysql",
      "host": "db-prod.example.com",
      "port": 3306,
      "database": "app_db",
      "username": "app_user",
      "password": "${MYSQL_PROD_PASSWORD}",
      "ssh": {
        "host": "jump.example.com",
        "port": 22,
        "username": "ssh_user",
        "privateKey": "/root/.ssh/id_rsa"
      },
      "permissions": {
        "level": "readonly",
        "forbiddenOperations": ["DELETE", "DDL"]
      }
    }
  ]
}
```

### 配置项说明

| 配置项 | 必填 | 说明 |
|--------|------|------|
| `name` | 是 | 连接名称，工具调用时使用 |
| `type` | 是 | 数据库类型：`mysql` / `postgresql` |
| `host` | 是 | 数据库服务器地址 |
| `port` | 是 | 数据库端口 |
| `database` | 是 | 数据库名称 |
| `username` | 是 | 数据库用户名 |
| `password` | 是 | 数据库密码（支持环境变量 `${ENV_VAR}`） |
| `ssh` | 否 | SSH 隧道配置（数据库在内网时需要） |
| `ssh.host` | 是 | 跳板机地址 |
| `ssh.port` | 否 | SSH 端口，默认 22 |
| `ssh.username` | 是 | SSH 用户名 |
| `ssh.privateKey` | 是 | SSH 私钥路径或内容 |
| `ssh.passphrase` | 否 | 私钥密码 |
| `permissions` | 是 | 权限配置 |
| `permissions.level` | 是 | 权限级别 |
| `permissions.tableOverrides` | 否 | 表级权限覆盖 |
| `permissions.forbiddenOperations` | 否 | 禁止的操作类型 |

### 权限级别

| 级别 | 允许的操作 | 适用环境 |
|------|----------|----------|
| `readonly` | 仅 SELECT | PRE / PROD |
| `readwrite` | SELECT, INSERT, UPDATE, DELETE | DEV / SIT / UAT |
| `admin` | 所有操作，包括 DDL | DEV |

### 环境命名规范

推荐按环境命名连接，便于 AI 识别：

```json
{
  "databases": [
    { "name": "mysql-dev", ... },
    { "name": "mysql-sit", ... },
    { "name": "mysql-uat", ... },
    { "name": "mysql-prod", ... }
  ]
}
```

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_MCP_CONFIG` | 配置文件路径 | `./config.json` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `MCP_TRANSPORT` | 传输模式：`stdio` / `sse` | `stdio` |
| `MCP_PORT` | SSE 模式端口 | `3000` |

---

## Docker 命令参考

```bash
# 构建镜像
docker build -t db-mcp:latest .

# stdio 模式（本地使用）
docker run -d --name db-mcp \
  -v $(pwd)/config:/app/config:ro \
  -v ~/.ssh:/root/.ssh:ro \
  db-mcp:latest

# SSE 模式（远程连接）
docker run -d --name db-mcp-sse \
  -p 3000:3000 \
  -v $(pwd)/config:/app/config:ro \
  -v ~/.ssh:/root/.ssh:ro \
  -e MCP_TRANSPORT=sse \
  -e MCP_PORT=3000 \
  db-mcp:latest

# Docker Compose
docker compose up -d              # 启动所有
docker compose up -d db-mcp-sse   # 仅 SSE 模式
docker compose logs -f            # 查看日志
docker compose restart            # 重启
docker compose down               # 停止
```

---

## MCP 工具列表

| 工具名称 | 功能 | 示例 |
|---------|------|------|
| `db_query` | 执行 SQL 查询 | `db_query(connection="mysql-dev", sql="SELECT * FROM users")` |
| `db_metadata` | 查询数据库元数据 | 获取表结构、索引信息 |
| `db_list_connections` | 列出可用连接 | 查看所有配置的数据库连接 |
| `db_test_connection` | 测试连接 | 验证数据库连接是否正常 |
| `db_explain` | 分析执行计划 | 查询 SQL 执行计划 |
| `db_sample_data` | 获取样本数据 | 获取表中前 N 行数据 |

---

## 安全提示

1. **权限最小化**：生产环境使用 `readonly` 权限
2. **环境变量**：密码使用环境变量，不硬编码
3. **SSH 密钥**：私钥权限 `chmod 600`
4. **配置文件**：配置文件权限 `chmod 600`
5. **网络安全**：SSE 模式配合 Nginx + HTTPS
6. **敏感文件**：`config.json` 和 `.env` 不要提交到 Git

---

## 故障排查

### SSH 连接失败

```bash
chmod 600 ~/.ssh/id_rsa
ssh -v ssh_user@jump.example.com
```

### Docker 容器无法启动

```bash
docker compose logs db-mcp
ls -la config/config.json
```

### 连接超时

- 检查安全组/防火墙是否开放端口
- 检查 SSH 隧道是否正常建立

---

## License

MIT
