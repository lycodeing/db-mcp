#!/usr/bin/env node

/**
 * 数据库 MCP 服务器
 *
 * 入口文件
 * 启动 MCP 服务器，处理进程信号
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config/index.js';
import { ConnectionManager } from './database/connection-manager.js';
import { PermissionChecker } from './security/permission-checker.js';
import { registerTools } from './tools/index.js';
import { getLogger } from './logger/index.js';

const logger = getLogger();

/**
 * 主函数
 */
async function main() {
  try {
    logger.info('正在启动数据库 MCP 服务器...');

    // 1. 加载配置
    const config = loadConfig();

    // 2. 创建连接管理器
    const connectionManager = new ConnectionManager();

    // 3. 初始化数据库连接
    await connectionManager.initialize(config.databases);

    // 4. 创建 MCP 服务器
    const server = new McpServer({
      name: 'db-mcp',
      version: '1.0.0',
    });

    // 5. 注册所有工具
    // 为每个数据库类型创建权限校验器
    // 这里简化处理，使用第一个数据库的类型
    const firstDbType = config.databases[0]?.type;
    if (!firstDbType) {
      throw new Error('配置文件中没有定义数据库连接');
    }
    const permissionChecker = new PermissionChecker(firstDbType);

    registerTools(server, connectionManager, permissionChecker);

    // 6. 连接 MCP 服务器传输层 (使用 stdio)
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('数据库 MCP 服务器已启动');

    // 7. 复制进程信号处理（优雅关闭)
    process.on('SIGINT', async () => {
      logger.info('收到 SIGINT 信号，正在关闭服务器...');
      await shutdown(connectionManager);
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('收到 SIGTERM 信号,正在关闭服务器...');
      await shutdown(connectionManager);
      process.exit(0);
    });

  } catch (error) {
    logger.error('启动服务器失败:', error);
    process.exit(1);
  }
}

/**
 * 优雅关闭
 */
async function shutdown(connectionManager: ConnectionManager): Promise<void> {
  try {
    await connectionManager.shutdown();
    logger.info('服务器已关闭');
  } catch (error) {
    logger.error('关闭服务器时出错:', error);
  }
}

// 启动服务器
main();
