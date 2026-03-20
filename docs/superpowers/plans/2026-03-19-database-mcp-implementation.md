# 数据库 MCP 服务器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 MCP 服务器，使 AI 助手能够安全地查询和操作多种类型的远程数据库（MySQL、PostgreSQL），通过 SSH 隧道连接，支持细粒度权限控制和 SQL 安全防护。

**Architecture:** 单体分层架构（Tool Layer → Security Layer → Database Layer → SSH Tunnel），使用 TypeScript/Node.js，MCP SDK，支持多数据库适配器模式。

**Tech Stack:** TypeScript 5.3+, Node.js 20+, @modelcontextprotocol/sdk, mysql2, pg, ssh2, node-sql-parser, zod v4, pino

**Spec Document:** `docs/superpowers/specs/2026-03-19-database-mcp-server-design.md`

---

## Phase 1: 项目初始化与基础设施

### Task 1.1: 项目脚手架与配置

**Files:**
- Create `package.json`
- Create `tsconfig.json`
- Create `.gitignore`
- Create `README.md`

**Details:**
```json
// package.json
{
  "name": "db-mcp",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "db-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest",
    "lint": "eslint src"
  }
}
```

**Test:**
- [ ] `npm install` 成功安装所有依赖
- [ ] `npm run build` 成功编译

---

### Task 1.2: TypeScript 配置

**Files:**
- Create `tsconfig.json`

**Details:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Test:**
- [ ] TypeScript 编译无错误
- [ ] 生成的 `.d.ts` 文件正确

---

## Phase 2: 核心类型与日志

### Task 2.1: 核心类型定义

**Files:**
- Create `src/types/index.ts`

**Key Interfaces:**
- `DatabaseType`, `PermissionLevel`, `SqlOperation`
- `DatabaseConfig`, `SshConfig`, `PermissionConfig`
- `ConnectionPoolConfig`, `ManagedConnection`, `ConnectionStatus`
- `TableInfo`, `ColumnInfo`, `IndexInfo`, `FieldInfo`
- `QueryResult<T>`, `ExplainResult`, `DatabaseMetadata`
- `TestResult`, `CheckResult`, `AnalysisResult`

**Test:**
- [ ] 类型定义完整，无 TypeScript 错误
- [ ] 导出所有类型供其他模块使用

---

### Task 2.2: 日志模块

**Files:**
- Create `src/logger/index.ts`

**Details:**
- 使用 pino 日志框架
- 支持环境变量 `LOG_LEVEL` 控制日志级别
- 生产环境 JSON 输出，开发环境 pino-pretty 美化
- 敏感字段自动脱敏（password, privateKey, passphrase）

**Test:**
- [ ] 日志输出正确格式化
- [ ] 敏感字段被脱敏

---

## Phase 3: 数据库适配器层

### Task 3.1: 数据库适配器基类

**Files:**
- Create `src/database/base-adapter.ts`

**Methods:**
- `connect(): Promise<void>`
- `disconnect(): Promise<void>`
- `query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>`
- `getTables(): Promise<TableInfo[]>`
- `getColumns(tableName: string): Promise<ColumnInfo[]>`
- `getIndexes(tableName: string): Promise<IndexInfo[]>`
- `explain(sql: string): Promise<ExplainResult>`
- `getMetadata(): Promise<DatabaseMetadata>`

**Test:**
- [ ] 抽象方法定义正确
- [ ] `getMetadata` 默认实现工作正常

---

### Task 3.2: MySQL 适配器

**Files:**
- Create `src/database/mysql-adapter.ts`

**Dependencies:** `mysql2/promise`

**Implementation:**
- 使用 `mysql2/promise` 创建连接池
- 实现 `information_schema` 查询获取元数据
- `EXPLAIN` 格式化输出

**Test:**
- [ ] 连接池创建成功
- [ ] SELECT 查询返回正确结果
- [ ] INSERT/UPDATE/DELETE 返回 affectedRows
- [ ] `getTables()` 返回表列表
- [ ] `getColumns()` 返回列信息
- [ ] `getIndexes()` 返回索引信息
- [ ] 参数化查询防止 SQL 注入

---

### Task 3.3: PostgreSQL 适配器

**Files:**
- Create `src/database/postgres-adapter.ts`

**Dependencies:** `pg`

**Implementation:**
- 使用 `pg` Pool 创建连接池
- 实现 `pg_catalog` 查询获取元数据
- 支持 Schema 概念
- `EXPLAIN ANALYZE` 格式化输出

**Test:**
- [ ] 连接池创建成功
- [ ] SELECT 查询返回正确结果
- [ ] INSERT/UPDATE/DELETE 返回 affectedRows
- [ ] `getTables()` 返回表列表（包含 Schema）
- [ ] `getColumns()` 返回列信息
- [ ] `getIndexes()` 返回索引信息
- [ ] 参数化查询防止 SQL 注入

---

### Task 3.4: 连接管理器

**Files:**
- Create `src/database/connection-manager.ts`

**Dependencies:** `ssh2`

**Methods:**
- `initialize(configs: DatabaseConfig[]): Promise<void>`
- `getAdapter(name: string): BaseDatabaseAdapter`
- `listConnections(): ConnectionStatus[]`
- `testConnection(name: string): Promise<TestResult>`
- `shutdown(): Promise<void>`
- `createSshTunnel(config: SshConfig, dbPort: number): Promise<{ tunnel: Client; localPort: number }>`

**Implementation Details:**
- SSH 隧道创建与端口转发
- 私钥加载（支持文件路径和直接内容）
- 心跳检测（30 秒）
- 自动重连（最多 3 次，指数退避）
- 错误处理与状态管理

**Test:**
- [ ] SSH 隧道建立成功
- [ ] 本地端口正确映射
- [ ] 私钥文件加载
- [ ] 私钥内容直接使用
- [ ] 心跳检测工作正常
- [ ] 重连机制触发
- [ ] 连接状态正确更新

---

## Phase 4: 安全层

### Task 4.1: 权限校验器

**Files:**
- Create `src/security/permission-checker.ts`

**Methods:**
- `check(config: PermissionConfig, sql: string, tableName?: string): CheckResult`
- `getEffectivePermission(config: PermissionConfig, tableName?: string): PermissionLevel`

**Implementation Details:**
- 连接级权限（默认）
- 表级权限覆盖（优先级更高）
- 操作级黑名单
- 权限映射表：
  - `readonly`: SELECT only
  - `readwrite`: SELECT + INSERT + UPDATE + DELETE
  - `admin`: 所有操作

**Test:**
- [ ] `readonly` 允许 SELECT
- [ ] `readonly` 拒绝 INSERT/UPDATE/DELETE
- [ ] `readwrite` 允许 INSERT/UPDATE/DELETE
- [ ] `admin` 允许 DDL
- [ ] 表级覆盖生效
- [ ] 操作级黑名单生效

---

### Task 4.2: SQL 分析器

**Files:**
- Create `src/security/sql-analyzer.ts`

**Dependencies:** `node-sql-parser`

**Methods:**
- `analyze(sql: string): AnalysisResult`
- `isDangerous(sql: string): boolean`
- `extractTableNamesFromSql(sql: string): string[]`

**Implementation Details:**
- 使用 `node-sql-parser` 解析 SQL AST
- 支持 MySQL 和 PostgreSQL 方言
- 提取操作类型（SELECT/INSERT/UPDATE/DELETE/DDL）
- 危险操作检测：
  - DDL 操作（DROP/CREATE/ALTER/TRUNCATE）
  - 无 WHERE 条件的 DELETE/UPDATE

**Test:**
- [ ] SELECT 语句解析正确
- [ ] INSERT 语句解析正确
- [ ] UPDATE 语句解析正确
- [ ] DELETE 语句解析正确
- [ ] DDL 语句解析正确
- [ ] 多表 JOIN 表名提取
- [ ] 子查询表名提取
- [ ] DROP 标记为危险
- [ ] TRUNCATE 标记为危险
- [ ] 无 WHERE 的 DELETE 标记为危险

---

## Phase 5: MCP 工具层

### Task 5.1: 工具注册入口

**Files:**
- Create `src/tools/index.ts`

**Details:**
- 导出所有工具注册函数
- 统一工具注册接口

---

### Task 5.2: db_query 工具

**Files:**
- Create `src/tools/db-query.ts`

**Input Schema:**
```typescript
{
  connection: z.string().describe('数据库连接名称'),
  sql: z.string().describe('SQL 查询语句'),
  params: z.array(z.unknown()).optional().describe('SQL 参数'),
}
```

**Handler Flow:**
1. 获取数据库适配器
2. 分析 SQL（操作类型、表名、危险检测）
3. 权限校验
4. 危险操作确认（使用 `server.elicit`）
5. 执行查询
6. 返回结果

**Test:**
- [ ] SELECT 查询返回结果
- [ ] INSERT 返回 affectedRows
- [ ] 权限拒绝返回错误
- [ ] 危险操作触发确认
- [ ] 用户取消危险操作返回取消消息
- [ ] SQL 参数化查询

---

### Task 5.3: db_metadata 工具

**Files:**
- Create `src/tools/db-metadata.ts`

**Input Schema:**
```typescript
{
  connection: z.string().describe('数据库连接名称'),
  table: z.string().optional().describe('表名（可选）'),
}
```

**Handler Flow:**
1. 获取数据库适配器
2. 如果指定表名，返回该表的列和索引信息
3. 否则返回所有表的元数据

**Test:**
- [ ] 返回所有表元数据
- [ ] 返回指定表元数据
- [ ] 表不存在时返回空

---

### Task 5.4: db_list_connections 工具

**Files:**
- Create `src/tools/db-list-connections.ts`

**Input Schema:** 无参数

**Handler Flow:**
1. 调用 `connectionManager.listConnections()`
2. 返回连接状态列表

**Test:**
- [ ] 返回所有连接
- [ ] 连接状态正确

---

### Task 5.5: db_test_connection 工具

**Files:**
- Create `src/tools/db-test-connection.ts`

**Input Schema:**
```typescript
{
  connection: z.string().describe('数据库连接名称'),
}
```

**Handler Flow:**
1. 调用 `connectionManager.testConnection()`
2. 返回测试结果（成功/失败、延迟、错误信息）

**Test:**
- [ ] 连接成功返回延迟
- [ ] 连接失败返回错误信息

---

### Task 5.6: db_explain 工具

**Files:**
- Create `src/tools/db-explain.ts`

**Input Schema:**
```typescript
{
  connection: z.string().describe('数据库连接名称'),
  sql: z.string().describe('SQL 语句'),
}
```

**Handler Flow:**
1. 获取数据库适配器
2. 调用 `adapter.explain(sql)`
3. 返回执行计划

**Test:**
- [ ] 返回执行计划
- [ ] 复杂查询执行计划正确

---

### Task 5.7: db_sample_data 工具

**Files:**
- Create `src/tools/db-sample-data.ts`

**Input Schema:**
```typescript
{
  connection: z.string().describe('数据库连接名称'),
  table: z.string().describe('表名'),
  limit: z.number().optional().default(10).describe('返回行数'),
}
```

**Handler Flow:**
1. 获取数据库适配器
2. 执行 `SELECT * FROM {table} LIMIT {limit}`
3. 返回样本数据

**Test:**
- [ ] 返回指定行数数据
- [ ] 默认返回 10 行

---

## Phase 6: MCP 服务器核心

### Task 6.1: 配置加载器

**Files:**
- Create `src/config/index.ts`
- Create `src/config/schema.ts`

**Details:**
- 支持 JSON 配置文件路径（通过环境变量 `DB_MCP_CONFIG` 或默认 `./config.json`）
- 环境变量展开（`${ENV_VAR}` 格式）
- Zod schema 验证配置

**Test:**
- [ ] 加载配置文件成功
- [ ] 环境变量展开正确
- [ ] 配置验证失败返回错误

---

### Task 6.2: MCP 服务器

**Files:**
- Create `src/server.ts`

**Details:**
- 创建 `McpServer` 实例
- 注册所有工具
- 初始化连接管理器
- 处理进程信号（SIGINT, SIGTERM）优雅关闭

**Test:**
- [ ] 服务器启动成功
- [ ] 工具注册成功
- [ ] 优雅关闭

---

### Task 6.3: 入口文件

**Files:**
- Create `src/index.ts`

**Details:**
- shebang `#!/usr/bin/env node`
- 加载配置
- 启动服务器
- 错误处理

**Test:**
- [ ] 作为 CLI 运行成功
- [ ] 配置文件不存在时返回友好错误

---

## Phase 7: 配置示例与文档

- [ ] `npm run test` 所有测试通过
- [ ] `npm run build` 成功
- [ ] `npm run start` 启动成功

---

## Dependencies Summary

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "mysql2": "^3.6.0",
    "pg": "^8.11.0",
    "ssh2": "^1.15.0",
    "node-sql-parser": "^4.18.0",
    "zod": "^3.24.0",
    "pino": "^8.18.0",
    "pino-pretty": "^10.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.10.0",
    "@types/ssh2": "^1.15.0",
    "tsx": "^4.7.0",
    "vitest": "^1.0.0"
  }
}
```
