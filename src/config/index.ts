/**
 * 数据库 MCP 服务器 - 配置加载器
 *
 * 支持 JSON 配置文件和环境变量展开
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AppConfig, DatabaseConfig } from '../types/index.js';
import { getLogger } from '../logger/index.js';

const logger = getLogger();

/**
 * 配置文件路径
 * 优先级：
 * 1. 环境变量 DB_MCP_CONFIG
 * 2. 命令行参数
 * 3. 当前目录下的 config.json
 * 4. ~/.db-mcp/config.json
 */
const CONFIG_PATHS = [
  process.env.DB_MCP_CONFIG,
  './config.json',
  path.join(process.env.HOME || '', '.db-mcp', 'config.json'),
];

/**
 * 加载配置
 *
 * @param configPath 配置文件路径（可选）
 * @returns 应用配置
 */
export function loadConfig(configPath?: string): AppConfig {
  // 确定配置文件路径
  const configFilePath = findConfigFile(configPath);

  if (!configFilePath) {
    throw new Error(
      '未找到配置文件。请设置环境变量 DB_MCP_CONFIG 或在以下位置创建 config.json:\n' +
      '  - ./config.json\n' +
      '  - ~/.db-mcp/config.json'
    );
  }

  logger.info(`加载配置文件: ${configFilePath}`);

  // 读取配置文件
  const configContent = fs.readFileSync(configFilePath, 'utf-8');

  // 展开环境变量
  const expandedConfig = expandEnvVars(configContent);

  // 解析 JSON
  const rawConfig = JSON.parse(expandedConfig) as AppConfig;

  // 验证必填字段
  if (!rawConfig.databases || rawConfig.databases.length === 0) {
    throw new Error('配置文件必须包含至少一个数据库连接');
  }

  // 验证每个数据库配置
  for (const db of rawConfig.databases) {
    if (!db.name) {
      throw new Error('数据库连接必须包含 name 字段');
    }
    if (!db.type) {
      throw new Error('数据库连接必须包含 type 字段');
    }
    if (!db.host) {
      throw new Error('数据库连接必须包含 host 字段');
    }
    if (!db.port) {
      throw new Error('数据库连接必须包含 port 字段');
    }
    if (!db.database) {
      throw new Error('数据库连接必须包含 database 字段');
    }
    if (!db.username) {
      throw new Error('数据库连接必须包含 username 字段');
    }
    if (!db.password) {
      throw new Error('数据库连接必须包含 password 字段');
    }
  }

  logger.info(`配置加载成功: ${rawConfig.databases.length} 个数据库连接`);

  return rawConfig;
}

/**
 * 查找配置文件
 */
function findConfigFile(customPath?: string): string | null {
  // 优先使用自定义路径
  if (customPath) {
    if (fs.existsSync(customPath)) {
      return customPath;
    }
    throw new Error(`配置文件不存在: ${customPath}`);
  }

  // 按优先级查找
  for (const configPath of CONFIG_PATHS) {
    if (configPath && fs.existsSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

/**
 * 展开配置文件中的环境变量
 *
 * 格式: ${ENV_VAR}
 */
function expandEnvVars(content: string): string {
  // 匹配 ${VAR_NAME} 格式的环境变量
  return content.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const value = process.env[varName];
    if (value === undefined) {
      logger.warn(`环境变量 ${varName} 未定义`);
      return match; // 保留原始字符串
    }
    return value;
  });
}
