import { WebSocket } from 'undici';
import { redactSensitiveText, redactWebSocketUrl } from './redact_url';

type OneBotEventHandler = (event: any) => void | Promise<void>;
type OneBotConnectedHandler = () => void | Promise<void>;
type OneBotWebSocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (type: string, listener: (event: any) => void, options?: { once?: boolean }) => void;
};

type PendingCall = {
  action: string;
  timer: NodeJS.Timeout;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

const WS_OPEN = 1;

export interface OneBotConnectionStatus {
  status: 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'stopped';
  connected: boolean;
  started: boolean;
  connecting: boolean;
  reconnectScheduled: boolean;
  reconnectAttempts: number;
  pendingCalls: number;
  connectedAt: number;
  disconnectedAt: number;
  lastActionAt: number;
  lastError: string;
}

export interface OneBotWsClientOptions {
  url: string;
  accessToken?: string;
  timeoutMs?: number;
  reconnectDelayMs?: number;
  webSocketFactory?: (url: string) => OneBotWebSocketLike;
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}

export class OneBotWsClient {
  private readonly options: OneBotWsClientOptions;
  private ws: OneBotWebSocketLike | null = null;
  private seq = 0;
  private started = false;
  private connecting = false;
  private manuallyClosed = false;
  private readonly pending = new Map<string, PendingCall>();
  private readonly handlers = new Set<OneBotEventHandler>();
  private readonly connectedHandlers = new Set<OneBotConnectedHandler>();
  private readonly timeoutMs: number;
  private readonly reconnectDelayMs: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectAttempts = 0;
  private connectedAt = 0;
  private disconnectedAt = 0;
  private lastActionAt = 0;
  private lastError = '';

  constructor(options: OneBotWsClientOptions) {
    this.options = options;
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000));
    this.reconnectDelayMs = Math.max(1000, Number(options.reconnectDelayMs || 3000));
  }

  onEvent(handler: OneBotEventHandler): void {
    this.handlers.add(handler);
  }

  offEvent(handler: OneBotEventHandler): void {
    this.handlers.delete(handler);
  }

  onConnected(handler: OneBotConnectedHandler): void {
    this.connectedHandlers.add(handler);
  }

  offConnected(handler: OneBotConnectedHandler): void {
    this.connectedHandlers.delete(handler);
  }

  getConnectionStatus(): OneBotConnectionStatus {
    const connected = Boolean(this.ws && this.ws.readyState === WS_OPEN);
    const status: OneBotConnectionStatus['status'] = !this.started || this.manuallyClosed
      ? 'stopped'
      : connected
        ? 'connected'
        : this.connecting
          ? 'connecting'
          : this.reconnectTimer
            ? 'reconnecting'
            : 'disconnected';
    return {
      status,
      connected,
      started: this.started,
      connecting: this.connecting,
      reconnectScheduled: Boolean(this.reconnectTimer),
      reconnectAttempts: this.reconnectAttempts,
      pendingCalls: this.pending.size,
      connectedAt: this.connectedAt,
      disconnectedAt: this.disconnectedAt,
      lastActionAt: this.lastActionAt,
      lastError: this.lastError
    };
  }

  async recover(): Promise<OneBotConnectionStatus> {
    if (this.ws?.readyState === WS_OPEN) return this.getConnectionStatus();
    if (!this.started || this.manuallyClosed) {
      this.started = true;
      this.manuallyClosed = false;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.connect();
    const status = this.getConnectionStatus();
    if (!status.connected) {
      throw new Error(`onebot_recovery_not_connected:${status.status}`);
    }
    return status;
  }

  async start(): Promise<void> {
    this.started = true;
    this.manuallyClosed = false;
    try {
      await this.connect();
    } catch {
      // connect() 已记录错误并安排重连。首次连接失败属于可恢复状态，
      // 不应让独立服务退出并连同重连定时器一起销毁。
      this.options.logger?.warn?.('OneBot WS unavailable at startup; service will keep reconnecting in background');
    }
  }

  close(): void {
    this.started = false;
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [echo, call] of this.pending.entries()) {
      clearTimeout(call.timer);
      call.reject(new Error(`onebot_client_closed:${call.action}`));
      this.pending.delete(echo);
    }
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
    this.disconnectedAt = Date.now();
  }

  async call(action: string, params: unknown = {}): Promise<any> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) {
      throw new Error(`onebot_ws_not_connected:${action}`);
    }

    const echo = `groupguard-${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
    const payload = { action, params: params || {}, echo };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`onebot_action_timeout:${action}`));
      }, this.timeoutMs);

      this.pending.set(echo, { action, timer, resolve, reject });

      try {
        ws.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(error);
      }
    });
  }

  private buildUrl(): string {
    const token = String(this.options.accessToken || '').trim();
    if (!token) return this.options.url;
    const url = new URL(this.options.url);
    if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
    return url.toString();
  }

  private async connect(): Promise<void> {
    if (this.ws?.readyState === WS_OPEN) return;
    if (this.connectPromise) return await this.connectPromise;
    if (!this.started || this.manuallyClosed) return;
    const task = this.connectOnce();
    this.connectPromise = task;
    try {
      await task;
    } finally {
      if (this.connectPromise === task) this.connectPromise = null;
    }
  }

  private async connectOnce(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connecting = true;

    try {
      const url = this.buildUrl();
      this.options.logger?.info?.(`OneBot WS connecting: ${redactWebSocketUrl(url)}`);

      await new Promise<void>((resolve, reject) => {
        const ws = this.options.webSocketFactory
          ? this.options.webSocketFactory(url)
          : new WebSocket(url) as unknown as OneBotWebSocketLike;
        let settled = false;
        const connectionTimer = setTimeout(
          () => settleErr(new Error('onebot_ws_connect_timeout')),
          this.timeoutMs
        );

        const settleOk = () => {
          if (settled) return;
          if (!this.started || this.manuallyClosed) {
            settleErr(new Error('onebot_client_closed'));
            return;
          }
          settled = true;
          clearTimeout(connectionTimer);
          this.ws = ws;
          this.connectedAt = Date.now();
          this.lastError = '';
          this.reconnectAttempts = 0;
          this.bindSocket(ws);
          this.options.logger?.info?.('OneBot WS connected');
          for (const handler of this.connectedHandlers) {
            void Promise.resolve(handler()).catch((error) => {
              this.options.logger?.warn?.(`OneBot connected handler failed: ${this.safeError(error)}`);
            });
          }
          resolve();
        };

        const settleErr = (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(connectionTimer);
          try { ws.close(); } catch { /* noop */ }
          reject(error instanceof Error ? error : new Error(String(error)));
        };

        ws.addEventListener('open', settleOk, { once: true });
        ws.addEventListener('error', (event: any) => settleErr(event?.error || 'websocket_error'), { once: true });
      });
    } catch (error) {
      this.lastError = this.safeError(error);
      this.reconnectAttempts += 1;
      this.options.logger?.error?.(`OneBot WS connect failed: ${this.lastError}`);
      this.scheduleReconnect();
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  private bindSocket(ws: OneBotWebSocketLike): void {
    ws.addEventListener('message', (event: any) => {
      void this.handleMessage(event?.data);
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.disconnectedAt = Date.now();
      this.rejectPending(new Error('onebot_ws_closed'));
      this.options.logger?.warn?.('OneBot WS closed');
      this.scheduleReconnect();
    });

    ws.addEventListener('error', (event: any) => {
      if (this.ws !== ws) return;
      this.handleSocketFailure(ws, event?.error || 'websocket_error');
    });
  }

  private handleSocketFailure(ws: OneBotWebSocketLike, error: unknown): void {
    if (this.ws !== ws) return;
    this.lastError = this.safeError(error);
    this.options.logger?.error?.(`OneBot WS error: ${this.lastError}`);
    this.ws = null;
    this.disconnectedAt = Date.now();
    this.rejectPending(new Error('onebot_ws_error'));
    try { ws.close(); } catch { /* noop */ }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.started || this.manuallyClosed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.started || this.manuallyClosed) return;
      void this.connect().catch(() => undefined);
    }, this.reconnectDelayMs);
  }

  private rejectPending(error: Error): void {
    for (const [echo, call] of this.pending.entries()) {
      clearTimeout(call.timer);
      call.reject(error);
      this.pending.delete(echo);
    }
  }

  private async handleMessage(data: unknown): Promise<void> {
    let payload: any;
    try {
      const text = typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf-8')
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString('utf-8')
            : String(data || '');
      payload = JSON.parse(text);
    } catch (error) {
      this.options.logger?.warn?.(`OneBot WS ignored non-json message: ${String(error)}`);
      return;
    }

    if (payload && payload.echo !== undefined && this.pending.has(String(payload.echo))) {
      const echo = String(payload.echo);
      const call = this.pending.get(echo)!;
      clearTimeout(call.timer);
      this.pending.delete(echo);

      const retcode = Number(payload.retcode ?? 0);
      const status = String(payload.status || (retcode === 0 ? 'ok' : 'failed'));
      if (status === 'ok' && (retcode === 0 || payload.retcode === undefined)) {
        this.lastActionAt = Date.now();
        call.resolve(payload.data ?? payload.result ?? payload);
      } else {
        const rawDetail = payload.message ?? payload.msg ?? payload.wording ?? status ?? 'failed';
        const failureDetail = redactSensitiveText(String(rawDetail || 'failed')).slice(0, 500);
        call.reject(new Error(`onebot_action_failed:${call.action}:${retcode}:${failureDetail}`));
      }
      return;
    }

    for (const handler of this.handlers) {
      try {
        await handler(payload);
      } catch (error) {
        this.options.logger?.error?.(`OneBot event handler failed: ${String(error)}`);
      }
    }
  }

  private safeError(error: unknown): string {
    return redactSensitiveText(error instanceof Error ? error.message : error || 'unknown')
      .slice(0, 300);
  }
}
