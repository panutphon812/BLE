type ReadableCharacteristic = {
  properties?: { read: boolean };
  readValue: () => Promise<DataView>;
};

export async function readCharacteristicValue(
  characteristic: ReadableCharacteristic,
  onTimeout: () => void,
  timeoutMs = 8000,
): Promise<string> {
  if (characteristic.properties && !characteristic.properties.read) {
    throw new Error('Characteristic ไม่เปิด Read กรุณาตรวจ Properties และสิทธิ์อ่านใน nRF');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      characteristic.readValue(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('อุปกรณ์ไม่ตอบคำสั่งอ่านภายใน 8 วินาที กรุณาตรวจ Read permission ใน nRF แล้วเชื่อมต่อใหม่'));
          onTimeout();
        }, timeoutMs);
      }),
    ]);
    return new TextDecoder('utf-8').decode(value).replace(/\u0000+$/g, '').trim();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
