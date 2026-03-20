/**
 * 数据库 MCP 服务器 - MySQL 适配器
 *
 * 实现 MySQL 数据库的具体操作
 */

import mysql from 'mysql2/promise';
import type { RowDataPacket, FieldPacket, OkPacket } from 'mysql2/promise';
import {
  BaseDatabaseAdapter,
  type QueryResult,
  type TableInfo,
  type ColumnInfo,
  type IndexInfo,
  type ExplainResult,
} from './base-adapter.js';
import type { DatabaseConfig, ConnectionPoolConfig, FieldInfo } from '../types/index.js';
import { getLogger } from '../logger/index.js';

const logger = getLogger();

/**
 * MySQL 数据库适配器
 */
export class MySqlAdapter extends BaseDatabaseAdapter {
  private pool!: mysql.Pool;
  private poolConfig: ConnectionPoolConfig;

  /**
   * 创建 MySQL 适配器实例
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
    this.pool = mysql.createPool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      // 连接池配置
      connectionLimit: this.poolConfig.max,
      waitForConnections: true,
      queueLimit: 0,
      // 连接超时配置
      connectTimeout: this.poolConfig.acquireTimeoutMillis,
      // 其他配置
      multipleStatements: true,
    });

    // 测试连接
    try {
      const conn = await this.pool.getConnection();
      await conn.ping();
      conn.release();
      logger.info(`MySQL 连接 [${this.config.name}] 建立成功`);
    } catch (error) {
      logger.error(`MySQL 连接 [${this.config.name}] 测试失败:`, error);
      throw error;
    }
  }

  /**
   * 关闭数据库连接
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      logger.info(`MySQL 连接 [${this.config.name}] 已关闭`);
    }
  }

  /**
   * 执行 SQL 查询
   * @param sql SQL 语句
   * @param params 参数（防止 SQL 注入）
   */
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const startTime = Date.now();

    try {
      // 使用 any 类型绕过复杂的 mysql2 类型定义
      const [rows, fields] = await (this.pool as any).execute(sql, params);
      const executionTime = Date.now() - startTime;

      // 判断是否为 SELECT 查询
      const isSelect = sql.trim().toUpperCase().startsWith('SELECT');

      const result: QueryResult<T> = {
        rows: (rows || []) as T[],
        executionTime,
        fields: (fields || []).map((f: FieldPacket) => ({
          name: f.name,
          type: String(f.type || ''),
        })),
      };

      // 非 SELECT 查询需要获取影响行数
      if (!isSelect && Array.isArray(rows) && rows.length > 0) {
        const firstRow = rows[0] as Record<string, unknown>;
        if (firstRow && 'affectedRows' in firstRow) {
          result.affectedRows = Number(firstRow.affectedRows) || 0;
        }
      }

      logger.debug(`SQL 查询执行成功，耗时 ${executionTime}ms`);
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error(`SQL 查询执行失败 [${executionTime}ms]:`, error);
      throw error;
    }
  }

  /**
   * 获取表列表
   */
  async getTables(): Promise<TableInfo[]> {
    const sql = `
      SELECT
        TABLE_NAME as name,
        TABLE_SCHEMA as \`schema\`,
        TABLE_TYPE as type,
        TABLE_COMMENT as \`comment\`
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `;

    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [this.config.database]);
    return rows.map((row) => ({
      name: row.name,
      schema: row.schema,
      type: row.type === 'VIEW' ? 'view' : 'table',
      comment: row.comment,
    }));
  }

  /**
   * 获取表的列信息
   */
  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const sql = `
      SELECT
        COLUMN_NAME as name,
        COLUMN_TYPE as type,
        IS_NULLABLE as \`nullable\`,
        COLUMN_DEFAULT as \`defaultValue\`,
        COLUMN_KEY as \`primaryKey\`,
        COLUMN_COMMENT as \`comment\`
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `;

    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [this.config.database, tableName]);
    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      nullable: row.nullable === 'YES',
      defaultValue: row.defaultValue,
      primaryKey: row.primaryKey === 'PRI',
      comment: row.comment,
    }));
  }

  /**
   * 获取表的索引信息
   */
  async getIndexes(tableName: string): Promise<IndexInfo[]> {
    const sql = `
      SELECT
        INDEX_NAME as name,
        GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as columns,
        NOT NON_UNIQUE as \`unique\`,
        INDEX_NAME = 'PRIMARY' as \`primary\`
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      GROUP BY INDEX_NAME, NON_UNIQUE
    `;

    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [this.config.database, tableName]);
    return rows.map((row) => ({
      name: row.name,
      columns: row.columns ? row.columns.split(',') : [],
      unique: row.unique === 0,
      primary: row.primary === 1,
    }));
  }

  /**
   * 获取 SQL 执行计划
   */
  async explain(sql: string): Promise<ExplainResult> {
    const explainSql = `EXPLAIN ${sql}`;
    const [rows] = await this.pool.execute<RowDataPacket[]>(explainSql);

    return {
      plan: rows,
      // MySQL EXPLAIN 不直接提供成本和行数
      // 需要从结果中解析
    };
  }
}
