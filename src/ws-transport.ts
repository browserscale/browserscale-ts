import type { Transport, UnaryResponse, StreamResponse, ContextValues } from "@connectrpc/connect";
import type {
  DescMessage,
  DescMethodUnary,
  DescMethodStreaming,
  MessageInitShape,
} from "@bufbuild/protobuf";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";

let nextId = 0;

interface PendingCall {
  resolve: (data: Uint8Array) => void;
  reject: (err: Error) => void;
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private pending = new Map<number, PendingCall>();
  private queue: Uint8Array[] = [];
  private connected = false;
  private url: string;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.connected = true;
      for (const msg of this.queue) {
        this.ws!.send(msg);
      }
      this.queue = [];
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      const buf = new Uint8Array(ev.data as ArrayBuffer);
      if (buf.length < 5) return;
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const id = view.getUint32(0, true);
      const status = buf[4];
      const payload = buf.slice(5);

      const call = this.pending.get(id);
      if (!call) return;
      this.pending.delete(id);

      if (status === 0) {
        call.resolve(payload);
      } else {
        call.reject(new Error(new TextDecoder().decode(payload)));
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      for (const [, call] of this.pending) {
        call.reject(new Error("WebSocket closed"));
      }
      this.pending.clear();
      setTimeout(() => this.connect(), 1000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private send(data: Uint8Array) {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.queue.push(data);
    }
  }

  async unary<I extends DescMessage, O extends DescMessage>(
    method: DescMethodUnary<I, O>,
    signal: AbortSignal | undefined,
    _timeoutMs: number | undefined,
    _header: HeadersInit | undefined,
    input: MessageInitShape<I>,
    _contextValues?: ContextValues,
  ): Promise<UnaryResponse<I, O>> {
    const id = ++nextId;
    const methodName = `${method.parent.typeName}/${method.name}`;
    const inputMsg = create(method.input, input);
    const payload = toBinary(method.input, inputMsg);

    const methodBytes = new TextEncoder().encode(methodName);
    const frame = new Uint8Array(6 + methodBytes.length + payload.length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, id, true);
    view.setUint16(4, methodBytes.length, true);
    frame.set(methodBytes, 6);
    frame.set(payload, 6 + methodBytes.length);

    const responsePayload = await new Promise<Uint8Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(frame);

      if (signal) {
        signal.addEventListener("abort", () => {
          this.pending.delete(id);
          reject(signal.reason ?? new Error("aborted"));
        }, { once: true });
      }
    });

    const output = fromBinary(method.output, responsePayload);

    return {
      stream: false,
      service: method.parent,
      method,
      header: new Headers(),
      trailer: new Headers(),
      message: output,
    } as UnaryResponse<I, O>;
  }

  async stream<I extends DescMessage, O extends DescMessage>(
    _method: DescMethodStreaming<I, O>,
    _signal: AbortSignal | undefined,
    _timeoutMs: number | undefined,
    _header: HeadersInit | undefined,
    _input: AsyncIterable<MessageInitShape<I>>,
    _contextValues?: ContextValues,
  ): Promise<StreamResponse<I, O>> {
    throw new Error("Streaming not supported over WebSocket transport");
  }

  close() {
    this.ws?.close();
  }
}
