/**
 * 数据库 MCP 服务器 - 核心类型定义
 *
 * 本文件定义了整个项目使用的核心类型接口
 * 确保类型安全，便于实现
 */

// ==================== 基础类型 ====================

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

// ==================== 配置接口 ====================

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

// ==================== 元数据接口 ====================

/**
 * 表信息
 */
export interface TableInfo {
  /** 表名 */
  name: string;
  /** Schema 名称（PostgreSQL 使用） */
  schema?: string;
  /** 表类型 */
  type: 'table' | 'view';
  /** 表注释 */
  comment?: string;
}

/**
 * 列信息
 */
export interface ColumnInfo {
  /** 列名 */
  name: string;
  /** 数据类型 */
  type: string;
  /** 是否可空 */
  nullable: boolean;
  /** 默认值 */
  defaultValue?: string;
  /** 是否主键 */
  primaryKey: boolean;
  /** 列注释 */
  comment?: string;
}

/**
 * 索引信息
 */
export interface IndexInfo {
  /** 索引名 */
  name: string;
  /** 索引列 */
  columns: string[];
  /** 是否唯一索引 */
  unique: boolean;
  /** 是否主键 */
  primary: boolean;
}

/**
 * 字段信息（查询结果）
 */
export interface FieldInfo {
  /** 字段名 */
  name: string;
  /** 字段类型 */
  type: string;
}

// ==================== 查询结果接口 ====================

/**
 * 查询结果通用类型
 */
export interface QueryResult<T = Record<string, unknown>> {
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

// ==================== 连接管理接口 ====================

/**
 * 托管的连接对象（内部使用）
 */
export interface ManagedConnection {
  /** 连接配置 */
  config: DatabaseConfig;
  /** 数据库适配器实例 */
  adapter: BaseDatabaseAdapter;
  /** SSH 隧道实例 */
  sshTunnel: import('ssh2').Client | null;
  /** 本地映射端口 */
  localPort: number;
  /** 连接状态 */
  status: 'connected' | 'disconnected' | 'error';
  /** 最后错误信息 */
  lastError?: string;
}

/**
 * 连接状态
 */
export interface ConnectionStatus {
  /** 连接名称 */
  name: string;
  /** 数据库类型 */
  type: DatabaseType;
  /** 连接状态 */
  status: 'connected' | 'disconnected' | 'error';
  /** 最后错误信息 */
  lastError?: string;
}

/**
 * 连接测试结果
 */
export interface TestResult {
  /** 是否成功 */
  success: boolean;
  /** 延迟（毫秒） */
  latency?: number;
  /** 错误信息 */
  error?: string;
}

// ==================== 安全检查接口 ====================

/**
 * 权限检查结果
 */
export interface CheckResult {
  /** 是否允许 */
  allowed: boolean;
  /** 拒绝原因 */
  reason?: string;
}

/**
 * SQL 分析结果
 */
export interface AnalysisResult {
  /** 操作类型 */
  operation: SqlOperation;
  /** 涉及的表名 */
  tables: string[];
  /** 是否为危险操作 */
  isDangerous: boolean;
  /** 危险原因 */
  dangerReason?: string;
}

// ==================== 应用配置接口 ====================

/**
 * 应用配置
 */
export interface AppConfig {
  /** 数据库连接配置列表 */
  databases: DatabaseConfig[];
  /** 日志级别 */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
}

// ==================== 抽象类占位 ====================

/**
 * 数据库适配器抽象基类
 * 定义在 src/database/base-adapter.ts 中
 *
 * 这里只作为类型引用的占位符
 */
export type BaseDatabaseAdapter = import('../database/base-adapter.js').BaseDatabaseAdapter;
