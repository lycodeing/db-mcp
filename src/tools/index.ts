/**
 * 数据库 MCP 服务器 - MCP 工具注册
 *
 * 注册所有 MCP 工具到服务器
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ConnectionManager } from '../database/connection-manager.js';
import { PermissionChecker } from '../security/permission-checker.js';
import { SqlAnalyzer } from '../security/sql-analyzer.js';
import type { DatabaseConfig } from '../types/index.js';
import { getLogger } from '../logger/index.js';

const logger = getLogger();

/**
 * 定义工具返回类型
 */
interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * 注册所有 MCP 工具
 *
 * @param server MCP 服务器实例
 * @param connectionManager 连接管理器
 * @param permissionChecker 权限校验器
 */
export function registerTools(
  server: McpServer,
  connectionManager: ConnectionManager,
  permissionChecker: PermissionChecker
): void {
  // 注册 db_query 工具
  registerDbQueryTool(server, connectionManager, permissionChecker);

  // 注册 db_metadata 工具
  registerDbMetadataTool(server, connectionManager);

  // 注册 db_list_connections 工具
  registerDbListConnectionsTool(server, connectionManager);

  // 注册 db_test_connection 工具
  registerDbTestConnectionTool(server, connectionManager);

  // 注册 db_explain 工具
  registerDbExplainTool(server, connectionManager, permissionChecker);

  // 注册 db_sample_data 工具
  registerDbSampleDataTool(server, connectionManager, permissionChecker);

  logger.info('所有 MCP 工具已注册');
}

/**
 * db_query 工具
 * 执行 SQL 查询
 */
function registerDbQueryTool(
  server: McpServer,
  connectionManager: ConnectionManager,
  permissionChecker: PermissionChecker
): void {
  server.tool(
    'db_query',
    '执行 SQL 查询，支持 SELECT/INSERT/UPDATE/DELETE',
    {
      connection: z.string().describe('数据库连接名称'),
      sql: z.string().describe('SQL 查询语句'),
      params: z.array(z.any()).optional().describe('SQL 参数（用于参数化查询）'),
    },
    async (params, _extra): Promise<ToolResult> => {
      const startTime = Date.now();

      try {
        // 1. 获取连接
        const adapter = connectionManager.getAdapter(params.connection);
        const dbType = adapter.getConfig().type;

        // 2. 创建 SQL 分析器
        const sqlAnalyzer = new SqlAnalyzer(dbType);

        // 3. 分析 SQL
        const analysis = sqlAnalyzer.analyze(params.sql);

        // 4. 权限校验
        const permissionCheck = permissionChecker.check(
          adapter.getConfig().permissions,
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

        // 5. 执行查询
        const result = await adapter.query(params.sql, params.params);

        const elapsed = Date.now() - startTime;
        logger.info(`查询执行完成，耗时 ${elapsed}ms, 影响 ${result.affectedRows || result.rows.length} 行`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`查询执行失败:`, error);

        return {
          content: [
            { type: 'text', text: `查询失败: ${errorMessage}` }
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * db_metadata 工具
 * 查询数据库元数据
 */
function registerDbMetadataTool(
  server: McpServer,
  connectionManager: ConnectionManager
): void {
  server.tool(
    'db_metadata',
    '查询数据库元数据，包括表、字段、索引等信息',
    {
      connection: z.string().describe('数据库连接名称'),
      table: z.string().optional().describe('表名（可选，不指定则返回所有表）'),
    },
    async (params, _extra): Promise<ToolResult> => {
      try {
        const adapter = connectionManager.getAdapter(params.connection);

        if (params.table) {
          // 返回指定表的元数据
          const [columns, indexes] = await Promise.all([
            adapter.getColumns(params.table),
            adapter.getIndexes(params.table),
          ]);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  table: params.table,
                  columns,
                  indexes,
                }, null, 2),
              }
            ],
          };
        } else {
          // 返回所有表的元数据
          const metadata = await adapter.getMetadata();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(metadata, null, 2),
              }
            ],
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`获取元数据失败:`, error);

        return {
          content: [
            { type: 'text', text: `获取元数据失败: ${errorMessage}` }
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * db_list_connections 工具
 * 列出所有可用的数据库连接
 */
function registerDbListConnectionsTool(
  server: McpServer,
  connectionManager: ConnectionManager
): void {
  server.tool(
    'db_list_connections',
    '列出所有可用的数据库连接及其状态',
    {},
    async (_params, _extra): Promise<ToolResult> => {
      const connections = connectionManager.listConnections();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(connections, null, 2),
          }
        ],
      };
    }
  );
}

/**
 * db_test_connection 工具
 * 测试数据库连接
 */
function registerDbTestConnectionTool(
  server: McpServer,
  connectionManager: ConnectionManager
): void {
  server.tool(
    'db_test_connection',
    '测试数据库连接是否正常',
    {
      connection: z.string().describe('数据库连接名称'),
    },
    async (params, _extra): Promise<ToolResult> => {
      try {
        const result = await connectionManager.testConnection(params.connection);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: 'text', text: `测试失败: ${errorMessage}` }
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * db_explain 工具
 * 分析 SQL 执行计划
 */
function registerDbExplainTool(
  server: McpServer,
  connectionManager: ConnectionManager,
  permissionChecker: PermissionChecker
): void {
  server.tool(
    'db_explain',
    '分析 SQL 执行计划',
    {
      connection: z.string().describe('数据库连接名称'),
      sql: z.string().describe('SQL 语句'),
    },
    async (params, _extra): Promise<ToolResult> => {
      try {
        const adapter = connectionManager.getAdapter(params.connection);
        const result = await adapter.explain(params.sql);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: 'text', text: `分析失败: ${errorMessage}` }
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * db_sample_data 工具
 * 获取表的样本数据
 */
function registerDbSampleDataTool(
  server: McpServer,
  connectionManager: ConnectionManager,
  permissionChecker: PermissionChecker
): void {
  server.tool(
    'db_sample_data',
    '获取表的样本数据',
    {
      connection: z.string().describe('数据库连接名称'),
      table: z.string().describe('表名'),
      limit: z.number().optional().default(10).describe('返回行数'),
    },
    async (params, _extra): Promise<ToolResult> => {
      try {
        const adapter = connectionManager.getAdapter(params.connection);
        const limit = params.limit ?? 10;
        const sql = `SELECT * FROM ${params.table} LIMIT ${limit}`;
        const result = await adapter.query(sql);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.rows, null, 2),
            }
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: 'text', text: `获取样本数据失败: ${errorMessage}` }
          ],
          isError: true,
        };
      }
    }
  );
}
