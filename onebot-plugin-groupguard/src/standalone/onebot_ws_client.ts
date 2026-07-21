import { WebSocket } from 'undici';

type OneBotEventHandler = (event: any) => void | Promise<void>;

type PendingCall = {
  action: string;
  timer: NodeJS.Timeout;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

const WS_OPEN = 1;

export interface OneBotWsClientOptions {
  url: string;
  accessToken?: string;
  timeoutMs?: number;
  reconnectDelayMs?: number;
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}

export class OneBotWsClient {
  private readonly options: OneBotWsClientOptions;
  private ws: WebSocket | null = null;
  private seq = 0;
  private started = false;
  private connecting = false;
  private manuallyClosed = false;
  private readonly pending = new Map<string, PendingCall>();
  private readonly handlers = new Set<OneBotEventHandler>();
  private readonly timeoutMs: number;
  private readonly reconnectDelayMs: number;
  private reconnectTimer: NodeJS.Timeout | null = null;

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
    if (this.connecting || !this.started || this.manuallyClosed) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connecting = true;

    try {
      const url = this.buildUrl();
      this.options.logger?.info?.(`OneBot WS connecting: ${url.replace(/access_token=[^&]+/g, 'access_token=***')}`);

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        let settled = false;

        const settleOk = () => {
          if (settled) return;
          settled = true;
          this.ws = ws;
          this.bindSocket(ws);
          this.options.logger?.info?.('OneBot WS connected');
          resolve();
        };

        const settleErr = (error: unknown) => {
          if (settled) return;
          settled = true;
          try { ws.close(); } catch { /* noop */ }
          reject(error instanceof Error ? error : new Error(String(error)));
        };

        ws.addEventListener('open', settleOk, { once: true });
        ws.addEventListener('error', (event: any) => settleErr(event?.error || 'websocket_error'), { once: true });
      });
    } catch (error) {
      this.options.logger?.error?.(`OneBot WS connect failed: ${String(error)}`);
      this.scheduleReconnect();
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  private bindSocket(ws: WebSocket): void {
    ws.addEventListener('message', (event: any) => {
      void this.handleMessage(event?.data);
    });

    ws.addEventListener('close', () => {
      if (this.ws === ws) this.ws = null;
      this.rejectPending(new Error('onebot_ws_closed'));
      this.options.logger?.warn?.('OneBot WS closed');
      this.scheduleReconnect();
    });

    ws.addEventListener('error', (event: any) => {
      this.options.logger?.error?.(`OneBot WS error: ${String(event?.error || 'unknown')}`);
    });
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
        call.resolve(payload.data ?? payload.result ?? payload);
      } else {
        call.reject(new Error(`onebot_action_failed:${call.action}:${retcode}:${payload.message || payload.msg || status}`));
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
}
