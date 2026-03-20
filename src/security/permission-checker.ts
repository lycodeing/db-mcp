/**
 * 数据库 MCP 服务器 - 权限校验器
 *
 * 实现组合控制：
 * 1. 连接级权限（默认权限）
 * 2. 表级权限覆盖（可选）
 * 3. 操作级黑名单（可选）
 */

import type {
  PermissionConfig,
  PermissionLevel,
  SqlOperation,
  CheckResult,
} from '../types/index.js';
import { SqlAnalyzer } from './sql-analyzer.js';
import { getLogger } from '../logger/index.js';

const logger = getLogger();

/**
 * 权限校验器
 *
 * 实现组合控制：
 * 1. 连接级权限（默认权限）
 * 2. 表级权限覆盖（可选）
 * 3. 操作级黑名单（可选）
 */
export class PermissionChecker {
  private sqlAnalyzer: SqlAnalyzer;

  constructor(dbType: 'mysql' | 'postgresql') {
    this.sqlAnalyzer = new SqlAnalyzer(dbType);
  }

  /**
   * 检查 SQL 是否有权限执行
   *
   * @param config 权限配置
   * @param sql SQL 语句
   * @param tableName 表名（可选，用于表级权限检查）
   * @returns 检查结果
   */
  check(config: PermissionConfig, sql: string, tableName?: string): CheckResult {
    // 1. 分析 SQL 操作类型
    const analysis = this.sqlAnalyzer.analyze(sql);
    const operation = analysis.operation;
    const effectiveTable = tableName || analysis.tables[0];

    // 2. 检查操作级黑名单
    if (config.forbiddenOperations?.includes(operation)) {
      logger.warn(`操作 [${operation}] 在黑名单中`);
      return {
        allowed: false,
        reason: `操作类型 [${operation}] 被禁止`,
      };
    }

    // 3. 获取有效权限级别
    const effectivePermission = this.getEffectivePermission(config, effectiveTable);

    // 4. 根据权限级别检查操作
    const result = this.checkByPermissionLevel(effectivePermission, operation);

    if (!result.allowed) {
      logger.warn(`权限拒绝: ${result.reason}, SQL: ${sql.substring(0, 100)}...`);
    } else {
      logger.debug(`权限通过: ${effectivePermission}, 操作: ${operation}`);
    }

    return result;
  }

  /**
   * 获取指定表的实际权限级别
   * 优先级：表级覆盖 > 连接级默认
   *
   * @param config 权限配置
   * @param tableName 表名
   * @returns 有效权限级别
   */
  private getEffectivePermission(
    config: PermissionConfig,
    tableName?: string
  ): PermissionLevel {
    // 如果有表级权限覆盖，使用表级权限
    if (tableName && config.tableOverrides?.[tableName]) {
      const tablePermission = config.tableOverrides[tableName];
      logger.debug(`表 [${tableName}] 使用表级权限覆盖: ${tablePermission}`);
      return tablePermission;
    }

    // 否则使用连接级默认权限
    return config.level;
  }

  /**
   * 根据权限级别检查操作
   *
   * @param permission 权限级别
   * @param operation 操作类型
   * @returns 检查结果
   */
  private checkByPermissionLevel(
    permission: PermissionLevel,
    operation: SqlOperation
  ): CheckResult {
    switch (permission) {
      case 'readonly':
        // 只读权限只允许 SELECT
        if (operation !== 'SELECT') {
          return {
            allowed: false,
            reason: `只读权限不允许执行 [${operation}] 操作`,
          };
        }
        return { allowed: true };

      case 'readwrite':
        // 读写权限允许 SELECT/INSERT/UPDATE/DELETE，不允许 DDL
        if (operation === 'DDL') {
          return {
            allowed: false,
            reason: `读写权限不允许执行 DDL 操作`,
          };
        }
        return { allowed: true };

      case 'admin':
        // 管理员权限允许所有操作
        return { allowed: true };

      default:
        return {
          allowed: false,
          reason: `未知权限级别: ${permission}`,
        };
    }
  }
}
