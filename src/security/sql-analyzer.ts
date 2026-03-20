/**
 * 数据库 MCP 服务器 - SQL 分析器
 *
 * 实现分层防护：
 * 1. 解析 SQL 语句
 * 2. 识别操作类型（SELECT/INSERT/UPDATE/DELETE/DDL）
 * 3. 检测危险操作
 */

import nodeSqlParser from 'node-sql-parser';
import type { AST } from 'node-sql-parser';
import type { SqlOperation, AnalysisResult } from '../types/index.js';
import { getLogger } from '../logger/index.js';

const logger = getLogger();

// 从 CommonJS 模块中提取 Parser
const { Parser } = nodeSqlParser as any;

/**
 * SQL 分析器
 *
 * 实现分层防护：
 * 1. 解析 SQL 语句
 * 2. 识别操作类型（SELECT/INSERT/UPDATE/DELETE/DDL）
 * 3. 检测危险操作
 */
export class SqlAnalyzer {
  private parser: typeof Parser;
  private dbType: 'mysql' | 'postgresql';

  /**
   * 创建 SQL 分析器实例
   * @param dbType 数据库类型
   */
  constructor(dbType: 'mysql' | 'postgresql') {
    this.dbType = dbType;
    this.parser = new Parser();
  }

  /**
   * 分析 SQL 语句
   *
   * @param sql SQL 语句
   * @returns 分析结果
   */
  analyze(sql: string): AnalysisResult {
    try {
      const opt = { database: this.dbType === 'mysql' ? 'MySQL' : 'Postgresql' };

      // 解析 SQL 为 AST
      const ast = this.parser.astify(sql, opt);

      // 获取涉及的表列表
      const tableList = this.parser.tableList(sql, opt);

      // 提取操作类型
      const operation = this.extractOperation(ast);

      // 提取表名
      const tables = this.extractTableNames(tableList);

      // 检查危险操作
      const dangerCheck = this.checkDangerous(ast, operation);

      logger.debug(`SQL 分析完成: 操作=${operation}, 表=${tables.join(',')}, 危险=${dangerCheck.isDangerous}`);

      return {
        operation,
        tables,
        isDangerous: dangerCheck.isDangerous,
        dangerReason: dangerCheck.reason,
      };
    } catch (error) {
      // SQL 解析失败，返回保守结果
      logger.warn('SQL 解析失败，采用保守策略:', error);

      // 尝试简单分析
      const simpleOperation = this.simpleOperationDetection(sql);

      return {
        operation: simpleOperation,
        tables: [],
        isDangerous: true,
        dangerReason: 'SQL 解析失败，采用保守策略',
      };
    }
  }

  /**
   * 检测是否为危险操作
   * 危险操作包括：DROP、TRUNCATE、大批量 DELETE/UPDATE
   *
   * @param sql SQL 语句
   * @returns 是否为危险操作
   */
  isDangerous(sql: string): boolean {
    const result = this.analyze(sql);
    return result.isDangerous;
  }

  /**
   * 提取 SQL 中的表名
   *
   * @param sql SQL 语句
   * @returns 表名列表
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
  private extractOperation(ast: AST | AST[]): SqlOperation {
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
        // 未知类型按 DDL 处理（最保守）
        return 'DDL';
    }
  }

  /**
   * 从表列表提取表名
   * node-sql-parser 返回格式为 ["select::null::table_name", ...]
   */
  private extractTableNames(tableList: string[]): string[] {
    return tableList.map((t) => {
      const parts = t.split('::');
      return parts[parts.length - 1] || '';
    }).filter((name): name is string => name.length > 0);
  }

  /**
   * 检查危险操作
   */
  private checkDangerous(
    ast: AST | AST[],
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

  /**
   * 简单操作检测（当解析失败时使用）
   */
  private simpleOperationDetection(sql: string): SqlOperation {
    const upperSql = sql.trim().toUpperCase();

    if (upperSql.startsWith('SELECT')) return 'SELECT';
    if (upperSql.startsWith('INSERT')) return 'INSERT';
    if (upperSql.startsWith('UPDATE')) return 'UPDATE';
    if (upperSql.startsWith('DELETE')) return 'DELETE';
    if (upperSql.startsWith('DROP')) return 'DDL';
    if (upperSql.startsWith('CREATE')) return 'DDL';
    if (upperSql.startsWith('ALTER')) return 'DDL';
    if (upperSql.startsWith('TRUNCATE')) return 'DDL';

    // 默认按最危险的操作处理
    return 'DDL';
  }
}
