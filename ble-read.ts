export type ReadResult = { text: string; hex: string; byteLength: number };
export function decodeValue(value: DataView): ReadResult {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return {
    text: new TextDecoder('utf-8').decode(bytes).replace(/\u0000+$/g, '').trim(),
    hex: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(' '),
    byteLength: bytes.byteLength,
  };
}

// Disconnect on timeout: a browser GATT request cannot otherwise be cancelled.
export async function withTimeout<T>(
  operation: () => Promise<T>, label: string, onTimeout: () => void, timeoutMs = 10000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label}: อุปกรณ์ไม่ตอบภายใน ${timeoutMs / 1000} วินาที การเชื่อมต่อถูกยกเลิก กรุณาเชื่อมต่อใหม่`));
        try { onTimeout(); } catch { /* Preserve the timeout error. */ }
      }, timeoutMs);
      Promise.resolve().then(operation).then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
