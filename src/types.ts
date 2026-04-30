export class BridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export interface BridgeEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export function tool_success(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

export function tool_error(code: string, message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error ${code}: ${message}` }],
    isError: true,
  };
}

export function handle_tool_error(err: unknown): ToolResult {
  if (err instanceof BridgeError) {
    return tool_error(err.code, err.message);
  }
  throw err;
}
