import type { Transport, UnaryResponse, StreamResponse, ContextValues } from "@connectrpc/connect";
import type {
  DescMessage,
  DescMethodUnary,
  DescMethodStreaming,
  MessageInitShape,
  MessageShape,
} from "@bufbuild/protobuf";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";

let nextId = 0;

/**
 * Response frame status byte, mirroring the wsStatus constants in
 * internal/bserver/ws_grpc_proxy.go.
 */
const STATUS_OK = 0;
const STATUS_ERROR = 1;
const STATUS_STREAM_MSG = 2;
const STATUS_STREAM_END = 3;
const STATUS_STREAM_READY = 4;

/** Control frame method name; real gRPC methods always contain a "/". */
const CANCEL = "cancel";

interface PendingCall {
  resolve: (data: Uint8Array) => void;
  reject: (err: Error) => void;
}

/**
 * A server stream in flight. Messages land in queue and are handed to the
 * iterator, which parks in wake while the queue is empty.
 */
interface PendingStream {
  queue: Uint8Array[];
  wake: (() => void) | null;
  done: boolean;
  error: Error | null;
  onReady: (() => void) | null;
  onReadyFailed: ((err: Error) => void) | null;
}

function wake(stream: PendingStream) {
  const pending = stream.wake;
  stream.wake = null;
  pending?.();
}

/**
 * Fails a stream so its iterator stops instead of parking forever. Passing a
 * null error ends it cleanly.
 */
function endStream(stream: PendingStream, err: Error | null) {
  stream.done = true;
  stream.error = err;
  wake(stream);
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private pending = new Map<number, PendingCall>();
  private streams = new Map<number, PendingStream>();
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

      const stream = this.streams.get(id);
      if (stream) {
        this.dispatchStreamFrame(id, stream, status, payload);
        return;
      }

      const call = this.pending.get(id);
      if (!call) return;
      this.pending.delete(id);

      if (status === STATUS_OK) {
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

      // Streams cannot survive the socket: the reconnect below is a fresh
      // connection the server knows nothing about. Callers that need to keep
      // reading resubscribe — for a network capture the capture itself stays
      // armed server-side, so only the gap is lost.
      const closed = new Error("WebSocket closed");
      for (const [, stream] of this.streams) {
        stream.onReadyFailed?.(closed);
        endStream(stream, closed);
      }
      this.streams.clear();

      setTimeout(() => this.connect(), 1000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private dispatchStreamFrame(
    id: number,
    stream: PendingStream,
    status: number,
    payload: Uint8Array,
  ) {
    switch (status) {
      case STATUS_STREAM_READY: {
        const ready = stream.onReady;
        stream.onReady = null;
        stream.onReadyFailed = null;
        ready?.();
        return;
      }
      case STATUS_STREAM_MSG:
        stream.queue.push(payload);
        wake(stream);
        return;
      case STATUS_STREAM_END:
        this.streams.delete(id);
        endStream(stream, null);
        return;
      default: {
        const err = new Error(new TextDecoder().decode(payload));
        this.streams.delete(id);
        stream.onReadyFailed?.(err);
        endStream(stream, err);
        return;
      }
    }
  }

  private send(data: Uint8Array) {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.queue.push(data);
    }
  }

  /** Builds a request frame: [4B id LE][2B method_len LE][method][payload]. */
  private static frame(id: number, method: string, payload: Uint8Array): Uint8Array {
    const methodBytes = new TextEncoder().encode(method);
    const frame = new Uint8Array(6 + methodBytes.length + payload.length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, id, true);
    view.setUint16(4, methodBytes.length, true);
    frame.set(methodBytes, 6);
    frame.set(payload, 6 + methodBytes.length);
    return frame;
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

    const responsePayload = await new Promise<Uint8Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(WebSocketTransport.frame(id, methodName, payload));

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

  /**
   * Runs a server-streaming call. Client-streaming is not supported: the frame
   * format carries exactly one request message, and no RPC needs more.
   *
   * Resolving means the server confirmed the subscription, so a caller may act
   * on it — arm a network capture, say — without racing the first message.
   */
  async stream<I extends DescMessage, O extends DescMessage>(
    method: DescMethodStreaming<I, O>,
    signal: AbortSignal | undefined,
    _timeoutMs: number | undefined,
    _header: HeadersInit | undefined,
    input: AsyncIterable<MessageInitShape<I>>,
    _contextValues?: ContextValues,
  ): Promise<StreamResponse<I, O>> {
    let request: MessageInitShape<I> | undefined;
    for await (const msg of input) {
      request = msg;
      break;
    }
    if (request === undefined) {
      throw new Error("WebSocket transport: server streaming needs one request message");
    }

    const id = ++nextId;
    const methodName = `${method.parent.typeName}/${method.name}`;
    const payload = toBinary(method.input, create(method.input, request));

    const stream: PendingStream = {
      queue: [],
      wake: null,
      done: false,
      error: null,
      onReady: null,
      onReadyFailed: null,
    };
    this.streams.set(id, stream);

    const ready = new Promise<void>((resolve, reject) => {
      stream.onReady = resolve;
      stream.onReadyFailed = reject;
    });

    this.send(WebSocketTransport.frame(id, methodName, payload));
    signal?.addEventListener("abort", () => this.cancelStream(id), { once: true });

    await ready;

    return {
      stream: true,
      service: method.parent,
      method,
      header: new Headers(),
      trailer: new Headers(),
      message: this.readStream(method, id, stream),
    } as StreamResponse<I, O>;
  }

  private async *readStream<I extends DescMessage, O extends DescMessage>(
    method: DescMethodStreaming<I, O>,
    id: number,
    stream: PendingStream,
  ): AsyncIterable<MessageShape<O>> {
    try {
      for (;;) {
        while (stream.queue.length === 0 && !stream.done) {
          await new Promise<void>((resolve) => {
            stream.wake = resolve;
          });
        }
        const buf = stream.queue.shift();
        if (buf === undefined) {
          // Queue drained; a failure only surfaces once nothing is left.
          if (stream.error) throw stream.error;
          return;
        }
        yield fromBinary(method.output, buf);
      }
    } finally {
      // Reached on break/return/throw in the consumer too, so abandoning the
      // loop stops the server rather than leaking the stream.
      this.cancelStream(id);
    }
  }

  /** Drops a stream locally and asks the server to stop producing. */
  private cancelStream(id: number) {
    const stream = this.streams.get(id);
    if (!stream) return;
    this.streams.delete(id);
    endStream(stream, null);
    this.send(WebSocketTransport.frame(id, CANCEL, new Uint8Array(0)));
  }

  close() {
    this.ws?.close();
  }
}
