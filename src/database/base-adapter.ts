/**
 * 数据库 MCP 服务器 - 数据库适配器抽象基类
 *
 * 所有数据库适配器必须继承此类
 * 提供统一的数据库操作接口
 */

import type {
  DatabaseConfig,
  QueryResult,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ExplainResult,
  DatabaseMetadata,
} from '../types/index.js';
import { getLogger } from '../logger/index.js';

const logger = getLogger();

// 重新导出类型，方便其他模块使用
export type {
  QueryResult,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ExplainResult,
  DatabaseMetadata,
};

/**
 * 数据库适配器抽象基类
 *
 * 设计模式：模板方法 + 策略模式
 * - 基类定义通用流程
 * - 子类实现具体数据库差异
 */
export abstract class BaseDatabaseAdapter {
  /**
   * 数据库连接配置
   */
  protected config: DatabaseConfig;

  /**
   * 构造函数
   */
  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * 获取数据库配置（公开访问器）
   */
  public getConfig(): DatabaseConfig {
    return this.config;
  }

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
   *
   * @param sql SQL 语句
   * @param params 参数（防止 SQL 注入）
   * @returns 查询结果
   */
  abstract query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

  /**
   * 获取表列表
   */
  abstract getTables(): Promise<TableInfo[]>;

  /**
   * 获取表的列信息
   *
   * @param tableName 表名
   */
  abstract getColumns(tableName: string): Promise<ColumnInfo[]>;

  /**
   * 获取表的索引信息
   *
   * @param tableName 表名
   */
  abstract getIndexes(tableName: string): Promise<IndexInfo[]>;

  /**
   * 获取 SQL 执行计划
   *
   * @param sql SQL 语句
   */
  abstract explain(sql: string): Promise<ExplainResult>;

  /**
   * 获取数据库元数据（表、列、索引的聚合信息）
   * 子类可以重写以优化性能
   */
  async getMetadata(): Promise<DatabaseMetadata> {
    logger.debug('开始获取数据库元数据');
    const startTime = Date.now();

    const tables = await this.getTables();
    const metadata: DatabaseMetadata = { tables: {} };

    for (const table of tables) {
      try {
        metadata.tables[table.name] = {
          columns: await this.getColumns(table.name),
          indexes: await this.getIndexes(table.name),
        };
      } catch (error) {
        logger.warn(`获取表 [${table.name}] 的元数据失败:`, error);
        // 继续处理其他表
      }
    }

    const elapsed = Date.now() - startTime;
    logger.debug(`数据库元数据获取完成，耗时 ${elapsed}ms，共 ${tables.length} 个表`);

    return metadata;
  }
}
