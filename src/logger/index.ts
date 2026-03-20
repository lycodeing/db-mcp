/**
 * 数据库 MCP 服务器 - 日志模块
 *
 * 使用 pino 日志框架，提供高性能日志记录
 * 支持敏感字段脱敏，防止密码等信息泄露
 */

import * as pino from 'pino';
import type { Logger, LoggerOptions } from 'pino';

/**
 * 日志级别类型
 */
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * 日志实例缓存
 * 避免重复创建日志实例
 */
let loggerInstance: Logger | null = null;

/**
 * 获取日志实例
 *
 * @param level - 日志级别，默认 'info'
 * @returns pino 日志实例
 */
export function getLogger(level: LogLevel = 'info'): Logger {
  if (loggerInstance) {
    return loggerInstance;
  }

  // 从环境变量获取日志级别，优先级高于参数
  const logLevel = (process.env.LOG_LEVEL as LogLevel) || level;

  // 判断是否为生产环境
  const isProduction = process.env.NODE_ENV === 'production';

  // 创建日志配置
  const config: LoggerOptions = {
    level: logLevel,
    // 敏感字段脱敏配置
    redact: {
      paths: [
        'password',
        '*.password',
        'privateKey',
        '*.privateKey',
        'passphrase',
        '*.passphrase',
        '*.ssh.privateKey',
        '*.ssh.passphrase',
      ],
      censor: '[REDACTED]',
    },
  };

  // 开发环境使用 pino-pretty 美化输出
  if (!isProduction) {
    config.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  // 创建日志实例
  loggerInstance = (pino as any).default(config);

  return loggerInstance!;
}

/**
 * 重置日志实例
 * 主要用于测试场景
 */
export function resetLogger(): void {
  loggerInstance = null;
}
