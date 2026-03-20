/**
 * 数据库 MCP 服务器 - PostgreSQL 适配器
 *
 * 实现 PostgreSQL 数据库的具体操作
 */

import { Pool as PgPool } from 'pg';
import {
  BaseDatabaseAdapter,
  type QueryResult,
  type TableInfo,
  type ColumnInfo,
  type IndexInfo,
  type ExplainResult,
} from './base-adapter.js';
import type { DatabaseConfig, ConnectionPoolConfig } from '../types/index.js';
import { getLogger } from '../logger/index.js';

const logger = getLogger();

/**
 * PostgreSQL 数据库适配器
 */
export class PostgresAdapter extends BaseDatabaseAdapter {
  private pool!: PgPool;
  private poolConfig: ConnectionPoolConfig;

  /**
   * 创建 PostgreSQL 适配器实例
   * @param config 数据库连接配置
   * @param poolConfig 连接池配置
   */
  constructor(config: DatabaseConfig, poolConfig: ConnectionPoolConfig) {
    super(config);
    this.poolConfig = poolConfig;
  }

  /**
   * 建立数据库连接
   */
  async connect(): Promise<void> {
    this.pool = new PgPool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      // 连接池配置
      max: this.poolConfig.max,
      min: this.poolConfig.min,
      // 连接超时配置
      connectionTimeoutMillis: this.poolConfig.acquireTimeoutMillis,
      idleTimeoutMillis: this.poolConfig.idleTimeoutMillis,
    });

    logger.info(`PostgreSQL 连接池已创建: ${this.config.host}:${this.config.port}/${this.config.database}`);
  }

  /**
   * 关闭数据库连接
   */
  async disconnect(): Promise<void> {
    await this.pool.end();
    logger.info(`PostgreSQL 连接池已关闭: ${this.config.host}:${this.config.port}/${this.config.database}`);
  }

  /**
   * 执行 SQL 查询
   */
  async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const startTime = Date.now();

    const result = await this.pool.query({
      text: sql,
      values: params,
    });

    const elapsed = Date.now() - startTime;
    logger.debug(`PostgreSQL 查询执行完成，耗时 ${elapsed}ms: ${sql.substring(0, 100)}...`);

    return {
      rows: result.rows as T[],
      affectedRows: result.rowCount ?? undefined,
      fields: result.fields?.map((f) => ({
        name: f.name,
        type: String(f.dataTypeID ?? 0),
      })),
      executionTime: elapsed,
    };
  }

  /**
   * 获取表列表
   */
  async getTables(): Promise<TableInfo[]> {
    const sql = `
      SELECT
        table_name as name,
        table_schema as schema,
        table_type as type,
        obj_description as comment
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_name
    `;

    const result = await this.pool.query(sql);
    return result.rows.map((row) => ({
      name: row.name,
      schema: row.schema,
      type: row.type === 'BASE TABLE' || row.type === 'BASE table' ? 'table' : 'view',
      comment: row.comment || undefined,
    }));
  }

  /**
   * 获取表的列信息
   */
  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const sql = `
      SELECT
        column_name as name,
        data_type as type,
        is_nullable as nullable,
        column_default as default_value,
        ordinal_position
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY ordinal_position
    `;

    const result = await this.pool.query(sql, [tableName]);

    // 获取主键信息
    const pkSql = `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = $1
        AND tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    `;
    const pkResult = await this.pool.query(pkSql, [tableName]);
    const pkColumns = new Set(pkResult.rows.map((r) => r.column_name));

    return result.rows.map((row) => ({
      name: row.name,
      type: row.type,
      nullable: row.nullable,
      defaultValue: row.default_value,
      primaryKey: pkColumns.has(row.name),
      comment: undefined,
    }));
  }

  /**
   * 获取表的索引信息
   */
  async getIndexes(tableName: string): Promise<IndexInfo[]> {
    const sql = `
      SELECT
        i.relname as name,
        array_agg(a.attname ORDER BY a.attnum) as columns,
        i.indisunique as unique,
        i.indisprimary as primary
      FROM pg_index i
      JOIN pg_class c ON i.indexrelid = c.oid
      WHERE c.relname = $1
      ORDER BY i.relname
    `;

    const result = await this.pool.query(sql, [tableName]);

    return result.rows.map((row) => ({
      name: row.name,
      columns: row.columns || [],
      unique: row.unique,
      primary: row.primary,
    }));
  }

  /**
   * 获取 SQL 执行计划
   */
  async explain(sql: string): Promise<ExplainResult> {
    const explainSql = `EXPLAIN (ANALYZE) ${sql}`;
    const result = await this.pool.query(explainSql);

    return {
      plan: result.rows,
      // PostgreSQL 的 EXPLAIN 输出格式不同
      // 尝试解析成本和行数信息
    };
  }
}
