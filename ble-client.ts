import { decodeValue, withTimeout, ReadResult } from './ble-read';

export const SERVICE_UUID = 'aee04821-1973-4e1f-a590-e84b10d580e7';
export const CHAR_UUID = 'cde07b1a-889b-44b7-a99f-c888dddac729';
export const BUILD_VERSION = 'BLE-AUDIT-20260930-1';
export type Characteristic = {
  properties?: { read: boolean; write: boolean; writeWithoutResponse: boolean };
  readValue: () => Promise<DataView>;
  writeValueWithResponse?: (value: ArrayBuffer) => Promise<void>;
  writeValueWithoutResponse?: (value: ArrayBuffer) => Promise<void>;
  writeValue?: (value: ArrayBuffer) => Promise<void>;
};
type Server = {
  connected: boolean;
  connect: () => Promise<Server>;
  disconnect: () => void;
  getPrimaryService: (uuid: string) => Promise<{ getCharacteristic: (uuid: string) => Promise<Characteristic> }>;
};
export type Device = {
  name?: string | null;
  gatt?: Server;
  addEventListener: (event: 'gattserverdisconnected', listener: () => void) => void;
  removeEventListener: (event: 'gattserverdisconnected', listener: () => void) => void;
};
export type BrowserBluetooth = {
  requestDevice: (options: { acceptAllDevices: boolean; optionalServices: string[] }) => Promise<Device>;
};
export function errorText(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error || 'เกิดข้อผิดพลาดระหว่างสื่อสารกับอุปกรณ์');
}
export function makeWriteValue(student: string, buddy: string) {
  return `${student.trim()}, ${buddy.trim()}`;
}

export class BleClient {
  private device: Device | null = null;
  private characteristic: Characteristic | null = null;
  private listener: (() => void) | null = null;
  private generation = 0;
  private busy = false;

  constructor(private log: (message: string) => void, private onDisconnected: () => void, private timeoutMs = 10000) {}
  get connected() { return Boolean(this.device?.gatt?.connected && this.characteristic); }

  disconnect() {
    const device = this.device;
    if (device && this.listener) device.removeEventListener('gattserverdisconnected', this.listener);
    this.generation += 1;
    this.device = null;
    this.characteristic = null;
    this.listener = null;
    this.busy = false;
    try { if (device?.gatt?.connected) device.gatt.disconnect(); }
    finally { this.onDisconnected(); }
    this.log('DISCONNECTED');
  }

  private assertSession(session: number) {
    if (session !== this.generation) throw new Error('การเชื่อมต่อถูกยกเลิก ผลจากการเชื่อมต่อเดิมจะไม่ถูกนำมาแสดง');
  }
  private async run<T>(label: string, action: (session: number) => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('มีคำสั่ง Bluetooth กำลังทำงาน กรุณารอให้เสร็จก่อน');
    const session = this.generation;
    this.busy = true;
    this.log(`${label} START`);
    try {
      const result = await action(session);
      this.assertSession(session);
      this.log(`${label} OK`);
      return result;
    } catch (error) {
      this.log(`${label} ERROR ${errorText(error)}`);
      throw error;
    } finally {
      if (session === this.generation) this.busy = false;
    }
  }
  private timed<T>(label: string, session: number, operation: () => Promise<T>) {
    this.log(label);
    return withTimeout(async () => {
      this.assertSession(session);
      const result = await operation();
      this.assertSession(session);
      return result;
    }, label, () => { if (session === this.generation) this.disconnect(); }, this.timeoutMs);
  }

  async connect(bluetooth: BrowserBluetooth) {
    if (this.connected) throw new Error('เชื่อมต่ออยู่แล้ว กรุณาตัดการเชื่อมต่อก่อนเลือกอุปกรณ์ใหม่');
    return this.run('CONNECT', async session => {
      let selected: Device | null = null;
      try {
        // Preserve the browser's user gesture by opening the chooser directly.
        selected = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SERVICE_UUID] });
        this.assertSession(session);
        if (!selected.gatt) throw new Error('อุปกรณ์ไม่มี GATT server');
        this.device = selected;
        this.listener = () => { if (session === this.generation) this.disconnect(); };
        selected.addEventListener('gattserverdisconnected', this.listener);
        const server = await this.timed('GATT CONNECT', session, async () => {
          const connectedServer = await selected!.gatt!.connect();
          if (session !== this.generation && selected !== this.device && connectedServer.connected) connectedServer.disconnect();
          return connectedServer;
        });
        const service = await this.timed('GET SERVICE', session, () => server.getPrimaryService(SERVICE_UUID));
        this.characteristic = await this.timed('GET CHARACTERISTIC', session, () => service.getCharacteristic(CHAR_UUID));
        if (!server.connected) throw new Error('อุปกรณ์ตัดการเชื่อมต่อระหว่างค้นหาช่องข้อมูล');
        const p = this.characteristic.properties;
        const capabilities = p ? `Read=${p.read} · Write=${p.write} · WriteWithoutResponse=${p.writeWithoutResponse}` : 'อุปกรณ์ไม่ได้รายงาน Properties';
        this.log(capabilities);
        return { name: selected.name?.trim() || 'อุปกรณ์ BLE', capabilities };
      } catch (error) {
        if (session === this.generation && this.device) this.disconnect();
        if (selected && selected !== this.device && selected.gatt?.connected) selected.gatt.disconnect();
        throw error;
      }
    });
  }
  private requireCharacteristic() {
    if (!this.connected || !this.characteristic) throw new Error('กรุณาเชื่อมต่ออุปกรณ์ก่อนรับส่งข้อมูล');
    return this.characteristic;
  }
  async read(): Promise<ReadResult> {
    return this.run('READ', async session => {
      const characteristic = this.requireCharacteristic();
      if (characteristic.properties && !characteristic.properties.read) throw new Error('Characteristic ไม่เปิด Read กรุณาตรวจ Properties และ Read permission ใน nRF');
      const raw = await this.timed('READ REQUEST', session, () => characteristic.readValue());
      const result = decodeValue(raw);
      this.log(`READ ${result.byteLength} bytes · text=${JSON.stringify(result.text)} · hex=${result.hex || '(empty)'}`);
      return result;
    });
  }
  async write(student: string, buddy: string) {
    return this.run('WRITE', async session => {
      const characteristic = this.requireCharacteristic();
      if (!student.trim() || !buddy.trim()) throw new Error('กรอกชื่อของคุณและเพื่อนให้ครบก่อนส่ง');
      const text = makeWriteValue(student, buddy);
      const bytes = new TextEncoder().encode(text);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const p = characteristic.properties;
      let method: ((data: ArrayBuffer) => Promise<void>) | undefined;
      let methodName = '';
      if ((!p || p.write) && characteristic.writeValueWithResponse) {
        method = characteristic.writeValueWithResponse; methodName = 'WRITE WITH RESPONSE';
      } else if ((!p || p.writeWithoutResponse) && characteristic.writeValueWithoutResponse) {
        method = characteristic.writeValueWithoutResponse; methodName = 'WRITE WITHOUT RESPONSE';
      } else if ((!p || p.write) && characteristic.writeValue) {
        method = characteristic.writeValue; methodName = 'LEGACY WRITE';
      }
      if (!method) throw new Error('Characteristic ไม่รองรับการเขียน กรุณาตรวจ Write properties และสิทธิ์เขียนใน nRF');
      this.log(`WRITE ${bytes.byteLength} bytes · text=${JSON.stringify(text)}`);
      await this.timed(methodName, session, () => method!.call(characteristic, buffer));
      return text;
    });
  }
}
