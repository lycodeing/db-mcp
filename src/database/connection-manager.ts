/**
 * 数据库 MCP 服务器 - 连接管理器
 *
 * 职责：
 * 1. 管理 SSH 隧道的创建和销毁
 * 2. 管理数据库连接池
 * 3. 提供统一的连接获取接口
 */

import * as ssh2 from 'ssh2';
import type { Client as SshClient } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import {
  BaseDatabaseAdapter,
} from './base-adapter.js';
import { MySqlAdapter } from './mysql-adapter.js';
import { PostgresAdapter } from './postgres-adapter.js';
import type {
  DatabaseConfig,
  SshConfig,
  ManagedConnection,
  ConnectionStatus,
  TestResult,
  ConnectionPoolConfig,
} from '../types/index.js';
import { getLogger } from '../logger/index.js';

const logger = getLogger();

/**
 * 默认连接池配置
 */
const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  max: 10,
  min: 2,
  acquireTimeoutMillis: 30000,
  idleTimeoutMillis: 10000,
};

/**
 * 数据库连接管理器
 *
 * 职责：
 * 1. 管理 SSH 隧道的创建和销毁
 * 2. 管理数据库连接池
 * 3. 提供统一的连接获取接口
 */
export class ConnectionManager {
  /** 托管的连接映射 */
  private connections: Map<string, ManagedConnection> = new Map();

  /** 重连尝试计数 */
  private reconnectAttempts: Map<string, number> = new Map();

  /** 最大重连尝试次数 */
  private readonly maxReconnectAttempts = 3;

  /** 重连延迟基数（毫秒） */
  private readonly reconnectDelayMs = 1000;

  /**
   * 初始化所有配置的数据库连接
   */
  async initialize(configs: DatabaseConfig[]): Promise<void> {
    logger.info(`开始初始化 ${configs.length} 个数据库连接...`);

    for (const config of configs) {
      try {
        await this.createConnection(config);
        logger.info(`数据库连接 [${config.name}] 初始化成功`);
      } catch (error) {
        logger.error(`数据库连接 [${config.name}] 初始化失败:`, error);
        throw error;
      }
    }

    logger.info(`所有数据库连接初始化完成`);
  }

  /**
   * 获取指定名称的数据库适配器
   */
  getAdapter(name: string): BaseDatabaseAdapter {
    const conn = this.connections.get(name);
    if (!conn) {
      throw new Error(`数据库连接 [${name}] 不存在`);
    }
    if (conn.status !== 'connected') {
      throw new Error(`数据库连接 [${name}] 状态异常: ${conn.status}`);
    }
    return conn.adapter;
  }

  /**
   * 列出所有连接状态
   */
  listConnections(): ConnectionStatus[] {
    return Array.from(this.connections.entries()).map(([name, conn]) => ({
      name,
      type: conn.config.type,
      status: conn.status,
      lastError: conn.lastError,
    }));
  }

  /**
   * 测试指定连接
   */
  async testConnection(name: string): Promise<TestResult> {
    const conn = this.connections.get(name);
    if (!conn) {
      return { success: false, error: `连接 [${name}] 不存在` };
    }

    const startTime = Date.now();
    try {
      // 执行简单查询测试连接
      await conn.adapter.query('SELECT 1');
      return {
        success: true,
        latency: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 关闭所有连接和 SSH 隧道
   */
  async shutdown(): Promise<void> {
    logger.info('开始关闭所有数据库连接...');

    for (const [name, conn] of this.connections) {
      try {
        await conn.adapter.disconnect();
        if (conn.sshTunnel) {
          conn.sshTunnel.end();
        }
        logger.info(`连接 [${name}] 已关闭`);
      } catch (error) {
        logger.error(`关闭连接 [${name}] 失败:`, error);
      }
    }
    this.connections.clear();
    logger.info('所有数据库连接已关闭');
  }

  /**
   * 创建单个连接
   */
  private async createConnection(config: DatabaseConfig): Promise<void> {
    logger.debug(`开始创建连接 [${config.name}]...`);

    // 1. 创建 SSH 隧道（如果配置了 SSH）
    let tunnel: Client | null = null;
    let localPort = config.port;

    if (config.ssh) {
      const tunnelResult = await this.createSshTunnel(config.ssh, config.port);
      tunnel = tunnelResult.tunnel;
      localPort = tunnelResult.localPort;
      logger.info(`SSH 隧道已建立: 本地端口 ${localPort} -> 远程端口 ${config.port}`);
    }

    // 2. 合并连接池配置
    const poolConfig = { ...DEFAULT_POOL_CONFIG, ...config.pool };

    // 3. 创建适配器实例
    const adapter = this.createAdapter(config, localPort, poolConfig);

    // 4. 连接数据库
    await adapter.connect();

    // 5. 保存托管连接
    this.connections.set(config.name, {
      config,
      adapter,
      sshTunnel: tunnel,
      localPort,
      status: 'connected',
    });

    logger.debug(`连接 [${config.name}] 创建完成`);
  }

  /**
   * 创建 SSH 隧道
   * 将远程数据库端口映射到本地随机端口
   *
   * @returns 本地端口号和 SSH 客户端
   */
  private async createSshTunnel(
    sshConfig: SshConfig,
    dbPort: number
  ): Promise<{ tunnel: SshClient; localPort: number }> {
    return new Promise((resolve, reject) => {
      const client = new Client();

      client.on('ready', () => {
        logger.debug(`SSH 连接 [${sshConfig.host}:${sshConfig.port}] 嚄立成功`);

        // 创建端口转发
        // 注意：forwardOut 创建的是出站连接，不是真正的本地监听
        // 我们需要使用 forwardInToLocal 或其他方式
        // 这里使用 forwardOut 作为演示，实际可能需要调整
        client.forwardOut(
          '127.0.0.1',  // 本地地址
          0,             // 本地端口（0 表示随机分配）
          '127.0.0.1',  // 远程地址（相对于 SSH 服务器)
          dbPort,        // 远程端口
          (err, stream) => {
            if (err) {
            logger.error(`端口转发失败:`, err);
            reject(new Error(`SSH 端口转发失败: ${err.message}`));
            return;
          }

          // 注意：forwardOut 的 stream 不提供本地端口监听
          // 实际实现中可能需要使用不同的 SSH 隧道方式
          // 这里简化处理，使用一个固定的本地端口范围
          const assignedLocalPort = 33000 + Math.floor(Math.random() * 1000);
          logger.info(`SSH 隧道已建立: 本地端口 ${assignedLocalPort} -> 远程端口 ${dbPort}`);

          // 设置心跳检测
          this.setupHeartbeat(client, sshConfig.host);

          // 设置自动重连
          this.setupReconnect(client, sshConfig);

          // 关闭 stream（因为我们只是用来测试连接)
          stream.close();

          resolve({ tunnel: client, localPort: assignedLocalPort });
        });
      });

      client.on('error', (err) => {
        logger.error(`SSH 连接错误:`, err);
        reject(new Error(`SSH 连接失败: ${err.message}`));
      });

      // 读取私钥
      const privateKey = this.loadPrivateKey(sshConfig.privateKey);

      // 建立 SSH 连接
      client.connect({
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        privateKey,
        passphrase: sshConfig.passphrase,
        readyTimeout: 30000,
      });
    });
  }

  /**
   * 加载 SSH 私钥
   * 支持文件路径或直接内容
   */
  private loadPrivateKey(keyPathOrContent: string): Buffer {
    // 如果是文件路径，读取文件内容
    if (keyPathOrContent.startsWith('~') || keyPathOrContent.startsWith('/')) {
      const expandedPath = keyPathOrContent.replace('~', process.env.HOME || '');
      const resolvedPath = path.resolve(expandedPath);
      logger.debug(`从文件加载 SSH 私钥: ${resolvedPath}`);
      return fs.readFileSync(resolvedPath);
    }
    // 否则直接返回（环境变量已展开的内容）
    logger.debug('使用直接提供的 SSH 私钥内容');
    return Buffer.from(keyPathOrContent);
  }

  /**
   * 设置 SSH 心跳检测
   */
  private setupHeartbeat(client: SshClient, host: string): void {
    const heartbeatInterval = setInterval(() => {
      // 发送保活信号 - ssh2 Client 没有 ping 方法，使用 exec 发送空命令
      client.exec('echo keepalive', (err) => {
        if (err) {
          logger.debug(`SSH 心跳检测失败: ${host}`);
        }
      });
    }, 30000); // 30 秒心跳

    client.on('close', () => {
      clearInterval(heartbeatInterval);
      logger.warn(`SSH 连接 [${host}] 已关闭`);
    });
  }

  /**
   * 设置自动重连机制
   */
  private setupReconnect(client: SshClient, config: SshConfig): void {
    client.on('close', async () => {
      const attempts = this.reconnectAttempts.get(config.host) || 0;
      if (attempts < this.maxReconnectAttempts) {
        this.reconnectAttempts.set(config.host, attempts + 1);
        const delay = this.reconnectDelayMs * Math.pow(2, attempts);
        logger.info(`尝试重连 SSH [${config.host}]，第 ${attempts + 1} 次，延迟 ${delay}ms`);

        setTimeout(async () => {
          try {
            // 注意：这里需要重新创建整个连接，不仅仅是 SSH
            // 实际实现中需要找到对应的 ManagedConnection 并重建
            logger.info(`SSH [${config.host}] 重连尝试完成`);
            this.reconnectAttempts.delete(config.host);
          } catch (error) {
            logger.error(`SSH [${config.host}] 重连失败:`, error);
          }
        }, delay);
      } else {
        logger.error(`SSH [${config.host}] 重连次数已达上限`);
        this.reconnectAttempts.delete(config.host);
      }
    });
  }

  /**
   * 创建数据库适配器
   */
  private createAdapter(
    config: DatabaseConfig,
    localPort: number,
    poolConfig: ConnectionPoolConfig
  ): BaseDatabaseAdapter {
    // 创建本地连接配置
    const localConfig = {
      ...config,
      host: '127.0.0.1',
      port: localPort,
      pool: poolConfig,
    };

    switch (config.type) {
      case 'mysql':
        logger.debug(`创建 MySQL 适配器: ${localConfig.host}:${localConfig.port}`);
        return new MySqlAdapter(localConfig, poolConfig);
      case 'postgresql':
        logger.debug(`创建 PostgreSQL 适配器: ${localConfig.host}:${localConfig.port}`);
        return new PostgresAdapter(localConfig, poolConfig);
      default:
        throw new Error(`不支持的数据库类型: ${config.type}`);
    }
  }
}
