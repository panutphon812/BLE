import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { BleClient, BrowserBluetooth, errorText, makeWriteValue } from './ble-client';

type BusyAction = 'connect' | 'read-initial' | 'write' | 'read-result' | null;
function getBluetooth(): BrowserBluetooth | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { bluetooth?: BrowserBluetooth }).bluetooth;
}

export function useBleApp() {
  const [deviceName, setDeviceName] = useState('');
  const [connected, setConnected] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [buddyName, setBuddyName] = useState('');
  const [initialValue, setInitialValue] = useState('');
  const [writtenValue, setWrittenValue] = useState('');
  const [predictedValue, setPredictedValue] = useState('');
  const [hasWrittenSinceRead, setHasWrittenSinceRead] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [notice, setNotice] = useState('ยังไม่ได้เชื่อมต่ออุปกรณ์');
  const [errorMessage, setErrorMessage] = useState('');
  const [secureContext, setSecureContext] = useState(false);
  const [capabilities, setCapabilities] = useState('');
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const disposed = useRef(false);
  const sequence = useRef(0);
  const activeOperation = useRef<number | null>(null);
  const clientRef = useRef<BleClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new BleClient(message => {
      if (!disposed.current) setDiagnostics(previous => [...previous.slice(-24), `${new Date().toLocaleTimeString()} ${message}`]);
    }, () => {
      if (disposed.current) return;
      setConnected(false);
      setDeviceName('');
      setCapabilities('');
      setHasWrittenSinceRead(false);
      setNotice('การเชื่อมต่อสิ้นสุดแล้ว');
    });
  }
  const client = clientRef.current;

  useEffect(() => {
    disposed.current = false;
    if (Platform.OS === 'web' && typeof window !== 'undefined') setSecureContext(window.isSecureContext);
    return () => {
      disposed.current = true;
      activeOperation.current = null;
      client.disconnect();
    };
  }, [client]);

  const runAction = async (action: BusyAction, task: (active: () => boolean) => Promise<void>) => {
    // State updates alone do not prevent two clicks in the same render.
    if (activeOperation.current !== null) return;
    const id = ++sequence.current;
    activeOperation.current = id;
    const active = () => !disposed.current && activeOperation.current === id;
    setBusyAction(action);
    setErrorMessage('');
    try {
      await task(active);
    } catch (error) {
      if (active()) {
        setErrorMessage(errorText(error));
        setNotice('ทำรายการไม่สำเร็จ กรุณาดูข้อความแจ้งและบันทึกคำสั่ง');
        setDiagnosticsOpen(true);
      }
    } finally {
      if (active()) {
        activeOperation.current = null;
        setBusyAction(null);
      }
    }
  };

  const connectDevice = () => runAction('connect', async active => {
    if (Platform.OS !== 'web') throw new Error('Expo Go ใช้ดูหน้าจอ กรุณาเปิดเวอร์ชันเว็บเพื่อเชื่อม BLE');
    if (!secureContext) throw new Error('Web Bluetooth ต้องเปิดผ่าน HTTPS หรือ localhost');
    const bluetooth = getBluetooth();
    if (!bluetooth) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth');
    setNotice('เลือกอุปกรณ์ในหน้าต่าง Bluetooth');
    const connection = await client.connect(bluetooth);
    if (!active()) return;
    setDeviceName(connection.name);
    setCapabilities(connection.capabilities);
    setConnected(true);
    setInitialValue('');
    setWrittenValue('');
    setPredictedValue('');
    setHasWrittenSinceRead(false);
    setNotice('เชื่อมต่อแล้ว กดอ่านค่าเริ่มต้นได้');
  });

  const disconnectDevice = () => {
    activeOperation.current = null;
    sequence.current += 1;
    setBusyAction(null);
    setErrorMessage('');
    client.disconnect();
  };

  const readInitialValue = () => runAction('read-initial', async active => {
    setNotice('กำลังอ่านค่าจากอุปกรณ์');
    const result = await client.read();
    if (!active()) return;
    const display = result.text || '(อุปกรณ์ส่งค่าว่าง)';
    setInitialValue(display);
    // The regular read button also shows the latest response after a successful write.
    if (hasWrittenSinceRead) setPredictedValue(display);
    setNotice(`อ่านสำเร็จ ${result.byteLength} ไบต์${result.text === writtenValue ? ' · อุปกรณ์ยังตอบเป็นชื่อที่ส่งไป' : ''}`);
  });

  const writeNames = () => runAction('write', async active => {
    setNotice('กำลังส่งชื่อให้อุปกรณ์');
    const text = await client.write(studentName, buddyName);
    if (!active()) return;
    setWrittenValue(text);
    setPredictedValue('');
    setHasWrittenSinceRead(true);
    setNotice('ส่งชื่อสำเร็จ กดอ่านผลจากอุปกรณ์ได้');
  });

  const readPrediction = () => runAction('read-result', async active => {
    if (!hasWrittenSinceRead) throw new Error('กรุณาส่งชื่อสำเร็จก่อนอ่านผล');
    setNotice('กำลังอ่านคำตอบจากอุปกรณ์');
    const result = await client.read();
    if (!active()) return;
    setPredictedValue(result.text || '(อุปกรณ์ส่งค่าว่าง)');
    setNotice(result.text === writtenValue
      ? 'อ่านสำเร็จ อุปกรณ์ตอบเป็นชื่อที่ส่งไป ยังไม่ได้ตอบผลทำนาย'
      : `อ่านสำเร็จ ${result.byteLength} ไบต์ สามารถกดอ่านซ้ำได้`);
  });

  const writeValue = useMemo(() => makeWriteValue(studentName, buddyName), [studentName, buddyName]);
  return {
    deviceName, connected, studentName, setStudentName, buddyName, setBuddyName,
    initialValue, writtenValue, predictedValue, hasWrittenSinceRead, busyAction,
    notice, errorMessage, secureContext, writeValue, capabilities, diagnostics,
    diagnosticsOpen, setDiagnosticsOpen, connectDevice, disconnectDevice,
    readInitialValue, writeNames, readPrediction, isBusy: busyAction !== null,
    showNativeNotice: Platform.OS !== 'web',
    bluetoothSupported: Platform.OS === 'web' && Boolean(getBluetooth()),
  };
}
