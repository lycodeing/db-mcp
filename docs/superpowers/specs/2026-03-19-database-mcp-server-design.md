# 数据库 MCP 服务器设计文档

> 创建日期：2026-03-19
> 状态：已审核通过
> 版本：v1.1（根据审查意见修订）

## 1. 概述

### 1.1 项目目标

构建一个 MCP（Model Context Protocol）服务器，使 AI 助手能够通过 MCP 协议安全地查询和操作多种类型的远程数据库。

### 1.2 核心需求

| 需求项 | 描述 |
|--------|------|
| 多数据库支持 | 支持 MySQL、PostgreSQL，架构预留扩展能力 |
| 安全连接 | 通过 SSH 隧道连接远程数据库，无需开放数据库端口 |
| 权限控制 | 组合控制：连接级 + 表级 + 操作级 |
| SQL 安全 | 分层防护：智能检测 + 危险操作确认 |
| 元数据查询 | 支持查询表、字段、索引等元数据 |

### 1.3 技术选型

| 技术点 | 选择 | 理由 |
|--------|------|------|
| 运行时 | Node.js + TypeScript | MCP 官方 SDK 首选，类型安全 |
| 连接方式 | SSH 隧道 | 安全可靠，无需额外开发 |
| 架构模式 | 单体分层架构 | 简单直接，易于维护 |

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        AI 助手 (Claude)                      │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP 协议
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     db-mcp Server                           │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Tool Layer (工具层)                  │   │
│  │  db_query | db_metadata | db_list_connections |      │   │
│  │  db_test_connection | db_explain | db_sample_data   │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Security Layer (安全层)                  │   │
│  │  PermissionChecker (权限校验) | SqlAnalyzer (SQL分析) │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Database Layer (数据库层)                   │   │
│  │  ConnectionManager | BaseAdapter | MySQL | PostgreSQL│   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │            SSH Tunnel (SSH 隧道层)                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │ SSH 加密通道
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    远程服务器                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   MySQL     │  │ PostgreSQL  │  │   其他 DB    │        │
│  │   :3306     │  │   :5432     │  │             │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
用户请求 → AI 助手 → MCP Tool Call
    → 权限校验 → SQL 分析
    → 危险操作检测（如需要则请求确认）
    → SSH 隧道 → 数据库执行
    → 返回结果 → AI 助手 → 用户
```

---

## 3. 项目结构

```
db-mcp/
├── src/
│   ├── index.ts                 # 入口文件，启动 MCP 服务器
│   ├── server.ts                # MCP 服务器核心逻辑
│   ├── config/
│   │   ├── index.ts             # 配置加载器
│   │   └── schema.ts            # 配置文件 JSON Schema
│   ├── tools/
│   │   ├── index.ts             # 工具注册入口
│   │   ├── db-query.ts          # 执行 SQL 查询
│   │   ├── db-metadata.ts       # 查询元数据
│   │   ├── db-list-connections.ts  # 列出连接
│   │   ├── db-test-connection.ts   # 测试连接
│   │   ├── db-explain.ts        # 执行计划分析
│   │   └── db-sample-data.ts    # 获取样本数据
│   ├── database/
│   │   ├── connection-manager.ts   # 连接池管理 + SSH 隧道
│   │   ├── base-adapter.ts      # 数据库适配器抽象基类
│   │   ├── mysql-adapter.ts     # MySQL 实现
│   │   └── postgres-adapter.ts  # PostgreSQL 实现
│   ├── security/
│   │   ├── permission-checker.ts   # 权限校验
│   │   └── sql-analyzer.ts      # SQL 安全分析
│   └── types/
│       └── index.ts             # TypeScript 类型定义
├── config.example.json          # 配置文件示例
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. 核心类型定义

```typescript
// src/types/index.ts

/**
 * 支持的数据库类型
 * 预留扩展能力，后续可添加 oracle、sqlite 等
 */
export type DatabaseType = 'mysql' | 'postgresql';

/**
 * 权限级别
 * - readonly: 只允许 SELECT 查询
 * - readwrite: 允许 SELECT/INSERT/UPDATE/DELETE
 * - admin: 允许所有操作，包括 DDL
 */
export type PermissionLevel = 'readonly' | 'readwrite' | 'admin';

/**
 * SQL 操作类型
 */
export type SqlOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL';

/**
 * 数据库连接配置
 */
export interface DatabaseConfig {
  /** 连接名称，唯一标识 */
  name: string;
  /** 数据库类型 */
  type: DatabaseType;
  /** 数据库主机地址（远程服务器地址） */
  host: string;
  /** 数据库端口 */
  port: number;
  /** 数据库名称 */
  database: string;
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
  /** SSH 隧道配置 */
  ssh: SshConfig;
  /** 权限配置 */
  permissions: PermissionConfig;
  /** 连接池配置（可选） */
  pool?: ConnectionPoolConfig;
}

/**
 * SSH 隧道配置
 */
export interface SshConfig {
  /** SSH 主机地址（通常与数据库主机相同） */
  host: string;
  /** SSH 端口，默认 22 */
  port: number;
  /** SSH 用户名 */
  username: string;
  /** SSH 私钥路径或私钥内容 */
  privateKey: string;
  /** 私钥密码（如果有） */
  passphrase?: string;
}

/**
 * 权限配置（组合控制）
 */
export interface PermissionConfig {
  /** 连接级权限 */
  level: PermissionLevel;
  /** 表级权限覆盖（可选） */
  tableOverrides?: Record<string, PermissionLevel>;
  /** 禁止的操作类型（可选） */
  forbiddenOperations?: SqlOperation[];
}

/**
 * 表信息
 */
export interface TableInfo {
  name: string;
  schema?: string;
  type: 'table' | 'view';
  comment?: string;
}

/**
 * 列信息
 */
export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey: boolean;
  comment?: string;
}

/**
 * 索引信息
 */
export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

/**
 * 查询结果通用类型
 */
export interface QueryResult<T> {
  /** 返回的数据行 */
  rows: T[];
  /** 影响的行数（INSERT/UPDATE/DELETE） */
  affectedRows?: number;
  /** 字段信息 */
  fields?: FieldInfo[];
  /** 执行时间（毫秒） */
  executionTime: number;
}

/**
 * 字段信息
 */
export interface FieldInfo {
  name: string;
  type: string;
}

/**
 * SQL 执行计划结果
 */
export interface ExplainResult {
  /** 执行计划详情（数据库原生格式） */
  plan: unknown[];
  /** 预估成本（可选） */
  cost?: number;
  /** 预估行数（可选） */
  rows?: number;
}

/**
 * 数据库元数据
 */
export interface DatabaseMetadata {
  /** 表名 -> 表元信息映射 */
  tables: Record<string, {
    columns: ColumnInfo[];
    indexes: IndexInfo[];
  }>;
}

/**
 * 托管的连接对象（内部使用）
 */
export interface ManagedConnection {
  /** 连接配置 */
  config: DatabaseConfig;
  /** 数据库适配器实例 */
  adapter: BaseDatabaseAdapter;
  /** SSH 隧道实例 */
  sshTunnel: SshTunnel | null;
  /** 本地映射端口 */
  localPort: number;
  /** 连接状态 */
  status: 'connected' | 'disconnected' | 'error';
  /** 最后错误信息 */
  lastError?: string;
}

/**
 * 连接池配置
 */
export interface ConnectionPoolConfig {
  /** 最大连接数，默认 10 */
  max: number;
  /** 最小连接数，默认 2 */
  min: number;
  /** 获取连接超时时间（毫秒），默认 30000 */
  acquireTimeoutMillis: number;
  /** 空闲连接超时时间（毫秒），默认 10000 */
  idleTimeoutMillis: number;
}

/**
 * 连接状态
 */
export interface ConnectionStatus {
  name: string;
  type: DatabaseType;
  status: 'connected' | 'disconnected' | 'error';
  lastError?: string;
}

/**
 * 连接测试结果
 */
export interface TestResult {
  success: boolean;
  latency?: number;
  error?: string;
}
```

---

## 5. 数据库适配器架构

### 5.1 基类设计

```typescript
// src/database/base-adapter.ts

/**
 * 数据库适配器抽象基类
 * 所有数据库实现必须继承此类
 *
 * 设计模式：模板方法 + 策略模式
 * - 基类定义通用流程
 * - 子类实现具体数据库差异
 */
export abstract class BaseDatabaseAdapter {
  constructor(protected config: DatabaseConfig) {}

  /**
   * 建立数据库连接
   * 子类必须实现
   */
  abstract connect(): Promise<void>;

  /**
   * 关闭数据库连接
   * 子类必须实现
   */
  abstract disconnect(): Promise<void>;

  /**
   * 执行 SQL 查询
   * @param sql SQL 语句
   * @param params 参数（防止 SQL 注入）
   */
  abstract query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

  /**
   * 获取表列表
   */
  abstract getTables(): Promise<TableInfo[]>;

  /**
   * 获取表的列信息
   */
  abstract getColumns(tableName: string): Promise<ColumnInfo[]>;

  /**
   * 获取表的索引信息
   */
  abstract getIndexes(tableName: string): Promise<IndexInfo[]>;

  /**
   * 获取 SQL 执行计划
   */
  abstract explain(sql: string): Promise<ExplainResult>;

  /**
   * 获取数据库元数据（表、列、索引的聚合信息）
   * 子类可以重写以优化性能
   */
  async getMetadata(): Promise<DatabaseMetadata> {
    const tables = await this.getTables();
    const metadata: DatabaseMetadata = { tables: {} };

    for (const table of tables) {
      metadata.tables[table.name] = {
        columns: await this.getColumns(table.name),
        indexes: await this.getIndexes(table.name),
      };
    }

    return metadata;
  }
}
```

### 5.2 MySQL 适配器要点

- 使用 `mysql2/promise` 支持异步
- 连接池配置（最大连接数、空闲超时等）
- 元数据查询使用 `information_schema`

### 5.3 PostgreSQL 适配器要点

- 使用 `pg` 库
- 支持 Schema 概念
- 元数据查询使用 `pg_catalog`

---

## 6. 连接管理与 SSH 隧道

### 6.1 连接管理器

```typescript
// src/database/connection-manager.ts

import { Client, ClientChannel } from 'ssh2';
import { getLogger } from '../logger';

const logger = getLogger();

/**
 * 默认连接池配置
 */
const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  max: 10,
  min: 2,
  acquireTimeoutMillis: 30000,
  idleTimeoutMillis: 10000,
};

/**
 * 数据库连接管理器
 *
 * 职责：
 * 1. 管理 SSH 隧道的创建和销毁
 * 2. 管理数据库连接池
 * 3. 提供统一的连接获取接口
 */
export class ConnectionManager {
  private connections: Map<string, ManagedConnection> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private readonly maxReconnectAttempts = 3;
  private readonly reconnectDelayMs = 1000;

  /**
   * 初始化所有配置的数据库连接
   */
  async initialize(configs: DatabaseConfig[]): Promise<void> {
    for (const config of configs) {
      try {
        await this.createConnection(config);
        logger.info(`数据库连接 [${config.name}] 初始化成功`);
      } catch (error) {
        logger.error(`数据库连接 [${config.name}] 初始化失败:`, error);
        throw error;
      }
    }
  }

  /**
   * 获取指定名称的数据库适配器
   */
  getAdapter(name: string): BaseDatabaseAdapter {
    const conn = this.connections.get(name);
    if (!conn) {
      throw new Error(`数据库连接 [${name}] 不存在`);
    }
    if (conn.status !== 'connected') {
      throw new Error(`数据库连接 [${name}] 状态异常: ${conn.status}`);
    }
    return conn.adapter;
  }

  /**
   * 列出所有连接状态
   */
  listConnections(): ConnectionStatus[] {
    return Array.from(this.connections.entries()).map(([name, conn]) => ({
      name,
      type: conn.adapter.config.type,
      status: conn.status,
      lastError: conn.lastError,
    }));
  }

  /**
   * 测试指定连接
   */
  async testConnection(name: string): Promise<TestResult> {
    const conn = this.connections.get(name);
    if (!conn) {
      return { success: false, error: `连接 [${name}] 不存在` };
    }

    const startTime = Date.now();
    try {
      // 执行简单查询测试连接
      await conn.adapter.query('SELECT 1');
      return {
        success: true,
        latency: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 关闭所有连接和 SSH 隧道
   */
  async shutdown(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.adapter.disconnect();
        if (conn.sshTunnel) {
          conn.sshTunnel.end();
        }
        logger.info(`连接 [${name}] 已关闭`);
      } catch (error) {
        logger.error(`关闭连接 [${name}] 失败:`, error);
      }
    }
    this.connections.clear();
  }

  /**
   * 创建单个连接
   */
  private async createConnection(config: DatabaseConfig): Promise<void> {
    // 1. 创建 SSH 隧道
    const { tunnel, localPort } = await this.createSshTunnel(
      config.ssh,
      config.port
    );

    // 2. 合并连接池配置
    const poolConfig = { ...DEFAULT_POOL_CONFIG, ...config.pool };

    // 3. 创建适配器实例
    const adapter = this.createAdapter(config, localPort, poolConfig);

    // 4. 连接数据库
    await adapter.connect();

    // 5. 保存托管连接
    this.connections.set(config.name, {
      config,
      adapter,
      sshTunnel: tunnel,
      localPort,
      status: 'connected',
    });
  }

  /**
   * 创建 SSH 隧道
   * 将远程数据库端口映射到本地随机端口
   *
   * @returns 本地端口号
   */
  private async createSshTunnel(
    config: SshConfig,
    dbPort: number
  ): Promise<{ tunnel: Client; localPort: number }> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let localPort = 0;

      client.on('ready', () => {
        logger.debug(`SSH 连接 [${config.host}] 建立成功`);

        // 创建端口转发
        client.forwardOut(
          '127.0.0.1',  // 本地地址
          0,            // 本地端口（0 表示随机）
          '127.0.0.1',  // 远程地址（相对于 SSH 服务器）
          dbPort,       // 远程端口
          (err, stream) => {
            if (err) {
              logger.error(`端口转发失败:`, err);
              reject(new Error(`SSH 端口转发失败: ${err.message}`));
              return;
            }

            // 获取本地端口
            localPort = stream.localPort;
            logger.info(`SSH 隧道已建立: 本地端口 ${localPort} -> 远程端口 ${dbPort}`);

            // 设置心跳检测
            this.setupHeartbeat(client, config.host);

            // 设置自动重连
            this.setupReconnect(client, config);

            resolve({ tunnel: client, localPort });
          }
        );
      });

      client.on('error', (err) => {
        logger.error(`SSH 连接错误:`, err);
        reject(new Error(`SSH 连接失败: ${err.message}`));
      });

      // 读取私钥（支持文件路径或直接内容）
      const privateKey = this.loadPrivateKey(config.privateKey);

      // 建立 SSH 连接
      client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        privateKey,
        passphrase: config.passphrase,
        readyTimeout: 30000,
      });
    });
  }

  /**
   * 加载 SSH 私钥
   * 支持文件路径或直接内容
   */
  private loadPrivateKey(keyPathOrContent: string): string {
    // 如果是文件路径，读取文件内容
    if (keyPathOrContent.startsWith('~') || keyPathOrContent.startsWith('/')) {
      const fs = require('fs');
      const path = require('path');
      const expandedPath = keyPathOrContent.replace('~', process.env.HOME || '');
      return fs.readFileSync(path.resolve(expandedPath), 'utf-8');
    }
    // 否则直接返回（环境变量已展开的内容）
    return keyPathOrContent;
  }

  /**
   * 设置 SSH 心跳检测
   */
  private setupHeartbeat(client: Client, host: string): void {
    const heartbeatInterval = setInterval(() => {
      // 发送保活信号
      client.ping();
    }, 30000); // 30 秒心跳

    client.on('close', () => {
      clearInterval(heartbeatInterval);
      logger.warn(`SSH 连接 [${host}] 已关闭`);
    });
  }

  /**
   * 设置自动重连机制
   */
  private setupReconnect(client: Client, config: SshConfig): void {
    client.on('close', async () => {
      const attempts = this.reconnectAttempts.get(config.host) || 0;
      if (attempts < this.maxReconnectAttempts) {
        this.reconnectAttempts.set(config.host, attempts + 1);
        logger.info(`尝试重连 SSH [${config.host}]，第 ${attempts + 1} 次`);

        setTimeout(async () => {
          try {
            // 重新建立连接的逻辑
            // 注意：实际实现需要重新创建 ManagedConnection
            logger.info(`SSH [${config.host}] 重连成功`);
            this.reconnectAttempts.delete(config.host);
          } catch (error) {
            logger.error(`SSH [${config.host}] 重连失败:`, error);
          }
        }, this.reconnectDelayMs * Math.pow(2, attempts));
      } else {
        logger.error(`SSH [${config.host}] 重连次数已达上限`);
      }
    });
  }

  /**
   * 创建数据库适配器
   */
  private createAdapter(
    config: DatabaseConfig,
    localPort: number,
    poolConfig: ConnectionPoolConfig
  ): BaseDatabaseAdapter {
    // 修改配置，使用本地端口
    const localConfig = {
      ...config,
      host: '127.0.0.1',
      port: localPort,
      pool: poolConfig,
    };

    switch (config.type) {
      case 'mysql':
        return new MySqlAdapter(localConfig);
      case 'postgresql':
        return new PostgresAdapter(localConfig);
      default:
        throw new Error(`不支持的数据库类型: ${config.type}`);
    }
  }
}
```

### 6.2 SSH 隧道流程

```
1. 读取 SSH 配置（主机、端口、用户名、私钥）
2. 使用 ssh2 库建立 SSH 连接
3. 创建端口转发：本地随机端口 → 远程数据库端口
4. 返回本地端口供数据库客户端使用
5. 关闭时先关闭数据库连接，再关闭 SSH 隧道
```

### 6.3 错误处理策略

| 错误类型 | 处理方式 |
|----------|----------|
| SSH 连接失败 | 记录日志，抛出异常，由上层决定是否重试 |
| SSH 连接中断 | 触发自动重连，最多 3 次，指数退避 |
| 数据库连接失败 | 记录日志，标记连接状态为 error |
| 查询超时 | 返回超时错误，由调用方处理 |
| 查询失败 | 返回错误详情，不自动重试 |

---

## 7. 安全层设计

### 7.1 权限校验器

```typescript
// src/security/permission-checker.ts

/**
 * 权限校验器
 *
 * 实现组合控制：
 * 1. 连接级权限（默认权限）
 * 2. 表级权限覆盖（可选）
 * 3. 操作级黑名单（可选）
 */
export class PermissionChecker {
  /**
   * 检查 SQL 是否有权限执行
   */
  check(
    config: PermissionConfig,
    sql: string,
    tableName?: string
  ): CheckResult;

  /**
   * 获取指定表的实际权限级别
   * 优先级：表级覆盖 > 连接级默认
   */
  private getEffectivePermission(
    config: PermissionConfig,
    tableName?: string
  ): PermissionLevel;
}

interface CheckResult {
  allowed: boolean;
  reason?: string;
}
```

### 7.2 SQL 分析器

```typescript
// src/security/sql-analyzer.ts

import { Parser } from 'node-sql-parser';
import { getLogger } from '../logger';

const logger = getLogger();

/**
 * SQL 分析器
 *
 * 实现分层防护：
 * 1. 解析 SQL 语句
 * 2. 识别操作类型（SELECT/INSERT/UPDATE/DELETE/DDL）
 * 3. 检测危险操作
 */
export class SqlAnalyzer {
  private parser: Parser;

  constructor(private dbType: 'mysql' | 'postgresql') {
    this.parser = new Parser();
  }

  /**
   * 分析 SQL 语句
   */
  analyze(sql: string): AnalysisResult {
    try {
      const opt = { database: this.dbType === 'mysql' ? 'MySQL' : 'Postgresql' };
      const ast = this.parser.astify(sql, opt);
      const tableList = this.parser.tableList(sql, opt);

      const operation = this.extractOperation(ast);
      const isDangerous = this.checkDangerous(ast, operation);

      return {
        operation,
        tables: this.extractTableNames(tableList),
        isDangerous: isDangerous.isDangerous,
        dangerReason: isDangerous.reason,
      };
    } catch (error) {
      // SQL 解析失败，返回保守结果
      logger.warn('SQL 解析失败，采用保守策略:', error);
      return {
        operation: 'DDL', // 保守估计为最危险操作
        tables: [],
        isDangerous: true,
        dangerReason: 'SQL 解析失败，采用保守策略',
      };
    }
  }

  /**
   * 检测是否为危险操作
   * 危险操作包括：DROP、TRUNCATE、大批量 DELETE/UPDATE
   */
  isDangerous(sql: string): boolean {
    const result = this.analyze(sql);
    return result.isDangerous;
  }

  /**
   * 提取 SQL 中的表名
   */
  extractTableNamesFromSql(sql: string): string[] {
    try {
      const opt = { database: this.dbType === 'mysql' ? 'MySQL' : 'Postgresql' };
      const tableList = this.parser.tableList(sql, opt);
      return this.extractTableNames(tableList);
    } catch {
      return [];
    }
  }

  /**
   * 从 AST 提取操作类型
   */
  private extractOperation(ast: unknown): SqlOperation {
    const astArray = Array.isArray(ast) ? ast : [ast];
    const firstAst = astArray[0] as { type?: string };

    if (!firstAst?.type) {
      return 'SELECT';
    }

    const type = firstAst.type.toUpperCase();

    switch (type) {
      case 'SELECT':
        return 'SELECT';
      case 'INSERT':
        return 'INSERT';
      case 'UPDATE':
        return 'UPDATE';
      case 'DELETE':
        return 'DELETE';
      case 'DROP':
      case 'TRUNCATE':
      case 'ALTER':
      case 'CREATE':
      case 'RENAME':
        return 'DDL';
      default:
        return 'DDL'; // 未知类型按 DDL 处理
    }
  }

  /**
   * 从表列表提取表名
   */
  private extractTableNames(tableList: string[]): string[] {
    // node-sql-parser 返回格式为 ["select::null::table_name", ...]
    return tableList.map((t) => {
      const parts = t.split('::');
      return parts[parts.length - 1];
    });
  }

  /**
   * 检查危险操作
   */
  private checkDangerous(
    ast: unknown,
    operation: SqlOperation
  ): { isDangerous: boolean; reason?: string } {
    // DDL 操作全部标记为危险
    if (operation === 'DDL') {
      const astArray = Array.isArray(ast) ? ast : [ast];
      const firstAst = astArray[0] as { type?: string };
      return {
        isDangerous: true,
        reason: `DDL 操作 [${firstAst?.type}] 可能导致数据结构变更`,
      };
    }

    // DELETE 和 UPDATE 检查是否有 WHERE 条件
    if (operation === 'DELETE' || operation === 'UPDATE') {
      const astArray = Array.isArray(ast) ? ast : [ast];
      const firstAst = astArray[0] as { where?: unknown };

      if (!firstAst?.where) {
        return {
          isDangerous: true,
          reason: `${operation} 操作缺少 WHERE 条件，可能影响全表`,
        };
      }
    }

    return { isDangerous: false };
  }
}

interface AnalysisResult {
  /** 操作类型 */
  operation: SqlOperation;
  /** 涉及的表名 */
  tables: string[];
  /** 是否为危险操作 */
  isDangerous: boolean;
  /** 危险原因 */
  dangerReason?: string;
}
```

### 7.3 分层防护策略

| 操作类型 | 安全级别 | 处理方式 |
|----------|----------|----------|
| SELECT | 低风险 | 正常执行，需权限校验 |
| INSERT | 中风险 | 正常执行，需权限校验 |
| UPDATE | 中风险 | 正常执行，需权限校验 |
| DELETE | 高风险 | 需要 `readwrite` 权限 |
| DROP/TRUNCATE | 极高风险 | 需要 `admin` 权限 + 确认 |
| 大批量操作 | 高风险 | 需要确认 |

---

## 8. MCP 工具设计

### 8.1 工具列表

| 工具名称 | 功能 | 必需参数 | 可选参数 |
|---------|------|---------|---------|
| `db_query` | 执行 SQL 查询 | connection, sql | params |
| `db_metadata` | 查询数据库元数据 | connection | table |
| `db_list_connections` | 列出可用连接 | - | - |
| `db_test_connection` | 测试连接 | connection | - |
| `db_explain` | 分析执行计划 | connection, sql | - |
| `db_sample_data` | 获取样本数据 | connection, table | limit |

### 8.2 db_query 工具详细设计

```typescript
// src/tools/db-query.ts

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * db_query 工具
 * 执行 SQL 查询，支持 SELECT/INSERT/UPDATE/DELETE
 */
export function registerDbQueryTool(
  server: McpServer,
  connectionManager: ConnectionManager,
  permissionChecker: PermissionChecker,
  sqlAnalyzer: SqlAnalyzer
) {
  server.tool(
    'db_query',
    '执行 SQL 查询，支持 SELECT/INSERT/UPDATE/DELETE',
    {
      connection: z.string().describe('数据库连接名称'),
      sql: z.string().describe('SQL 查询语句'),
      params: z.array(z.string()).optional().describe('SQL 参数（用于参数化查询）'),
    },
    async (params) => {
      // 1. 获取连接
      const adapter = connectionManager.getAdapter(params.connection);

      // 2. 分析 SQL
      const analysis = sqlAnalyzer.analyze(params.sql);

      // 3. 权限校验
      const permissionCheck = permissionChecker.check(
        adapter.config.permissions,
        params.sql,
        analysis.tables[0]
      );

      if (!permissionCheck.allowed) {
        return {
          content: [
            { type: 'text', text: `权限拒绝: ${permissionCheck.reason}` }
          ],
          isError: true,
        };
      }

      // 4. 危险操作需要用户确认
      if (analysis.isDangerous) {
        // 使用 MCP elicitation 功能请求用户确认
        const confirmation = await server.elicit({
          message: `即将执行危险操作：${analysis.dangerReason}`,
          details: {
            sql: params.sql,
            operation: analysis.operation,
            tables: analysis.tables,
          },
          requestedSchema: z.object({
            confirmed: z.boolean().describe('是否确认执行此危险操作'),
          }),
        });

        if (!confirmation.confirmed) {
          return {
            content: [
              { type: 'text', text: '用户取消了危险操作' }
            ],
          };
        }
      }

      // 5. 执行查询
      try {
        const result = await adapter.query(params.sql, params.params);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: 'text', text: `查询失败: ${error instanceof Error ? error.message : String(error)}` }
          ],
          isError: true,
        };
      }
    }
  );
}
```

### 8.3 db_metadata 工具详细设计

```typescript
// src/tools/db-metadata.ts

export const dbMetadataTool = {
  name: 'db_metadata',
  description: '查询数据库元数据，包括表、字段、索引等信息',
  inputSchema: {
    type: 'object',
    properties: {
      connection: {
        type: 'string',
        description: '数据库连接名称'
      },
      table: {
        type: 'string',
        description: '表名（可选，不指定则返回所有表）'
      }
    },
    required: ['connection']
  },

  handler: async (params: DbMetadataParams) => {
    const adapter = connectionManager.getAdapter(params.connection);

    if (params.table) {
      return {
        table: params.table,
        columns: await adapter.getColumns(params.table),
        indexes: await adapter.getIndexes(params.table),
      };
    }

    return await adapter.getMetadata();
  }
};
```

---

## 9. 配置文件设计

```json
// config.example.json
{
  "databases": [
    {
      "name": "my-mysql-prod",
      "type": "mysql",
      "host": "remote-server.com",
      "port": 3306,
      "database": "production_db",
      "username": "app_user",
      "password": "${MYSQL_PASSWORD}",
      "ssh": {
        "host": "remote-server.com",
        "port": 22,
        "username": "ssh_user",
        "privateKey": "${SSH_PRIVATE_KEY_PATH}"
      },
      "permissions": {
        "level": "readonly"
      }
    },
    {
      "name": "my-postgres-dev",
      "type": "postgresql",
      "host": "dev-server.com",
      "port": 5432,
      "database": "dev_db",
      "username": "dev_user",
      "password": "${POSTGRES_PASSWORD}",
      "ssh": {
        "host": "dev-server.com",
        "port": 22,
        "username": "ssh_user",
        "privateKey": "~/.ssh/id_rsa"
      },
      "permissions": {
        "level": "readwrite",
        "tableOverrides": {
          "audit_logs": "readonly",
          "system_config": "readonly"
        },
        "forbiddenOperations": ["DELETE"]
      }
    }
  ]
}
```

**配置说明：**

| 配置项 | 说明 |
|--------|------|
| `name` | 连接名称，工具调用时使用 |
| `type` | 数据库类型：mysql / postgresql |
| `host` | 远程服务器地址 |
| `password` | 支持环境变量：`${ENV_VAR}` |
| `ssh.privateKey` | 支持路径（`~/.ssh/id_rsa`）或环境变量 |
| `permissions.level` | readonly / readwrite / admin |
| `permissions.tableOverrides` | 表级权限覆盖 |
| `permissions.forbiddenOperations` | 禁止的操作类型 |

---

## 10. 技术依赖

```json
{
  "name": "db-mcp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest"
  },
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

**依赖说明：**

| 包名 | 用途 | 选择理由 |
|------|------|---------|
| `@modelcontextprotocol/sdk` | MCP 官方 SDK | 官方支持，类型完整 |
| `mysql2` | MySQL 客户端 | 支持 Promise，性能好 |
| `pg` | PostgreSQL 客户端 | 官方推荐，生态成熟 |
| `ssh2` | SSH 隧道实现 | 纯 JS 实现，跨平台 |
| `node-sql-parser` | SQL 解析器 | 支持 MySQL/PostgreSQL 双方言，可精确提取 AST |
| `zod` | 参数校验 | 类型安全，可生成 JSON Schema，使用 v4 兼容模式 |
| `pino` | 日志框架 | 高性能，JSON 格式日志 |
| `pino-pretty` | 日志美化 | 开发环境友好输出 |

> **注意**：Zod 使用 `zod/v4` 导入方式以兼容 MCP SDK：
> ```typescript
> import { z } from 'zod';
> ```

---

## 11. 日志规范

### 11.1 日志配置

```typescript
// src/logger/index.ts

import pino from 'pino';

/**
 * 日志级别
 */
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * 创建日志实例
 */
export function getLogger(level: LogLevel = 'info') {
  return pino({
    level: process.env.LOG_LEVEL || level,
    // 生产环境使用纯 JSON，开发环境美化输出
    transport: process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
    // 敏感字段脱敏
    redact: {
      paths: ['password', '*.password', 'privateKey', '*.privateKey', 'passphrase', '*.passphrase'],
      censor: '[REDACTED]',
    },
  });
}
```

### 11.2 日志使用规范

| 级别 | 使用场景 |
|------|---------|
| `trace` | 详细的调试信息（生产环境禁用） |
| `debug` | 开发调试信息（SQL 语句、连接状态） |
| `info` | 常规操作日志（连接建立/断开、查询执行） |
| `warn` | 警告信息（重连尝试、降级操作） |
| `error` | 错误信息（连接失败、查询异常） |
| `fatal` | 致命错误（服务无法启动） |

---

## 13. 测试用例规划

### 13.1 单元测试

```markdown
### PermissionChecker 测试
- [ ] readonly 权限下 SELECT 应该允许
- [ ] readonly 权限下 INSERT 应该拒绝
- [ ] readonly 权限下 DELETE 应该拒绝
- [ ] readwrite 权限下 DELETE 应该允许
- [ ] 表级权限覆盖生效测试
- [ ] 操作级黑名单生效测试

### SqlAnalyzer 测试
- [ ] SELECT 语句解析
- [ ] INSERT 语句解析
- [ ] UPDATE 语句解析
- [ ] DELETE 语句解析
- [ ] DDL 语句解析（DROP/CREATE/ALTER）
- [ ] 多表 JOIN 语句表名提取
- [ ] 子查询表名提取
- [ ] 危险操作检测（DROP/TRUNCATE）

### ConnectionManager 测试
- [ ] 连接初始化成功
- [ ] 连接不存在时抛出异常
- [ ] 连接状态异常时抛出异常
- [ ] 连接列表返回正确
- [ ] 连接测试成功
- [ ] 连接测试失败返回错误信息
```

### 13.2 集成测试

```markdown
### MySQL 适配器测试
- [ ] 连接建立
- [ ] SELECT 查询
- [ ] INSERT 查询
- [ ] UPDATE 查询
- [ ] DELETE 查询
- [ ] 参数化查询（防止 SQL 注入）
- [ ] 获取表列表
- [ ] 获取列信息
- [ ] 获取索引信息
- [ ] 获取执行计划

### PostgreSQL 适配器测试
- [ ] 连接建立
- [ ] SELECT 查询
- [ ] INSERT 查询
- [ ] UPDATE 查询
- [ ] DELETE 查询
- [ ] 参数化查询
- [ ] 获取表列表
- [ ] 获取列信息（包含 Schema）
- [ ] 获取索引信息
- [ ] 获取执行计划

### SSH 隧道测试
- [ ] 隧道建立成功
- [ ] 隧道连接失败处理
- [ ] 隧道断开后重连
- [ ] 私钥文件加载
- [ ] 私钥内容直接使用
```

### 13.3 E2E 测试

```markdown
### MCP 工具调用测试
- [ ] db_query 完整链路
- [ ] db_metadata 完整链路
- [ ] db_list_connections 完整链路
- [ ] db_test_connection 完整链路
- [ ] db_explain 完整链路
- [ ] db_sample_data 完整链路

### 危险操作确认测试
- [ ] DROP 操作触发确认
- [ ] TRUNCATE 操作触发确认
- [ ] 用户确认后执行
- [ ] 用户取消后拒绝执行

### 权限控制测试
- [ ] readonly 连接拒绝写操作
- [ ] readwrite 连接允许写操作
- [ ] 表级权限覆盖生效
```

---

## 14. 部署架构

### 11.1 本地开发

```
本地开发机
├── db-mcp Server (MCP 服务)
├── Claude Desktop / 其他 MCP 客户端
└── SSH 私钥 (~/.ssh/id_rsa)
```

### 11.2 生产部署

```
生产服务器（内网）
├── db-mcp Server (systemd 托管)
├── 配置文件 (/etc/db-mcp/config.json)
├── SSH 私钥 (/etc/db-mcp/keys/)
└── 日志 (/var/log/db-mcp/)

            ↓ SSH 隧道

数据库服务器
├── MySQL (:3306)
└── PostgreSQL (:5432)
```

### 11.3 部署检查清单

- [ ] SSH 私钥权限设置为 600
- [ ] 配置文件权限设置为 600
- [ ] 数据库用户使用最小权限原则
- [ ] 生产环境使用 readonly 权限
- [ ] 配置日志轮转

---

## 15. 扩展指南

### 12.1 添加新数据库支持

1. 在 `src/types/index.ts` 中添加新类型
2. 创建 `src/database/xxx-adapter.ts` 继承 `BaseDatabaseAdapter`
3. 在 `ConnectionManager` 中注册新适配器
4. 添加相应的依赖包

### 12.2 添加新工具

1. 在 `src/tools/` 下创建新文件
2. 实现 `name`、`description`、`inputSchema`、`handler`
3. 在 `src/tools/index.ts` 中注册

---

## 16. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| SSH 连接中断 | 数据库不可用 | 自动重连机制 |
| SQL 注入 | 数据泄露/破坏 | 参数化查询 + SQL 分析 |
| 权限配置错误 | 越权操作 | 配置校验 + 最小权限原则 |
| 大查询 OOM | 服务崩溃 | 结果集大小限制 |
| 敏感数据泄露 | 安全风险 | 日志脱敏 + 查询审计 |

---

## 14. 验收标准

- [ ] 支持 MySQL 和 PostgreSQL 连接
- [ ] SSH 隧道正常工作
- [ ] 所有 6 个工具正常工作
- [ ] 权限控制生效
- [ ] SQL 注入防护有效
- [ ] 危险操作需要确认
- [ ] 单元测试覆盖率 > 80%
- [ ] 文档完整

---

## 15. 后续迭代计划

| 版本 | 功能 |
|------|------|
| v1.1 | SQLite 支持 |
| v1.2 | 查询结果缓存 |
| v1.3 | 慢查询日志 |
| v2.0 | Oracle / SQL Server 支持 |
