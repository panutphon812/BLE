import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

const SERVICE_UUID = 'aee04821-1973-4e1f-a590-e84b10d580e7';
const CHAR_UUID = 'cde07b1a-889b-44b7-a99f-c888dddac729';

type BusyAction = 'connect' | 'read-initial' | 'write' | 'read-result' | null;

type BluetoothCharacteristic = {
  readValue: () => Promise<DataView>;
  writeValueWithResponse?: (value: ArrayBuffer) => Promise<void>;
  writeValueWithoutResponse?: (value: ArrayBuffer) => Promise<void>;
  writeValue?: (value: ArrayBuffer) => Promise<void>;
};

type BluetoothServer = {
  connected: boolean;
  connect: () => Promise<BluetoothServer>;
  disconnect: () => void;
  getPrimaryService: (serviceUuid: string) => Promise<{
    getCharacteristic: (characteristicUuid: string) => Promise<BluetoothCharacteristic>;
  }>;
};

type BluetoothDevice = {
  id: string;
  name?: string | null;
  gatt?: BluetoothServer;
  addEventListener: (event: 'gattserverdisconnected', listener: () => void) => void;
  removeEventListener: (event: 'gattserverdisconnected', listener: () => void) => void;
};

type BrowserBluetooth = {
  requestDevice: (options: {
    acceptAllDevices: boolean;
    optionalServices: string[];
  }) => Promise<BluetoothDevice>;
};

function getBrowserBluetooth(): BrowserBluetooth | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { bluetooth?: BrowserBluetooth }).bluetooth;
}

function makeWriteValue(studentName: string, buddyName: string) {
  return `${studentName.trim()}, ${buddyName.trim()}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function decodeCharacteristicValue(value: DataView) {
  return new TextDecoder('utf-8').decode(value).replace(/\u0000+$/g, '').trim();
}

function friendlyError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'เกิดข้อผิดพลาดระหว่างสื่อสารกับอุปกรณ์ ลองเชื่อมต่อใหม่อีกครั้ง';
}

export default function App() {
  const { width } = useWindowDimensions();
  const characteristicRef = useRef<BluetoothCharacteristic | null>(null);
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const disconnectListenerRef = useRef<(() => void) | null>(null);

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

  const writeValue = useMemo(
    () => makeWriteValue(studentName, buddyName),
    [studentName, buddyName],
  );

  const bluetoothSupported = Platform.OS === 'web' && Boolean(getBrowserBluetooth());

  useEffect(() => {
    if (typeof window !== 'undefined') setSecureContext(window.isSecureContext);
  }, []);

  useEffect(() => {
    return () => {
      const device = deviceRef.current;
      const listener = disconnectListenerRef.current;
      if (device && listener) device.removeEventListener('gattserverdisconnected', listener);
      if (device?.gatt?.connected) device.gatt.disconnect();
    };
  }, []);

  const clearError = () => setErrorMessage('');

  const handleDisconnected = () => {
    characteristicRef.current = null;
    deviceRef.current = null;
    disconnectListenerRef.current = null;
    setConnected(false);
    setDeviceName('');
    setHasWrittenSinceRead(false);
    setNotice('การเชื่อมต่อสิ้นสุดแล้ว');
  };

  const connectDevice = async () => {
    clearError();
    if (Platform.OS !== 'web') {
      setErrorMessage('Expo Go แสดงหน้าจอได้ แต่เชื่อม BLE จากในแอปไม่ได้ กรุณาเปิดเวอร์ชันเว็บใน Chrome');
      return;
    }
    if (!secureContext) {
      setErrorMessage('Web Bluetooth ต้องใช้ HTTPS หรือ localhost กรุณาเปิดแอปจากที่อยู่ที่ปลอดภัย');
      return;
    }

    const bluetooth = getBrowserBluetooth();
    if (!bluetooth) {
      setErrorMessage('เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth กรุณาเปิดด้วย Chrome บนอุปกรณ์ที่มี Bluetooth');
      return;
    }

    setBusyAction('connect');
    setNotice('กำลังค้นหาอุปกรณ์ BLE');
    let connectingDevice: BluetoothDevice | null = null;
    try {
      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID],
      });
      connectingDevice = device;
      if (!device.gatt) throw new Error('อุปกรณ์นี้ไม่มี GATT server');

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristic = await service.getCharacteristic(CHAR_UUID);

      const onDisconnected = () => handleDisconnected();
      device.addEventListener('gattserverdisconnected', onDisconnected);
      characteristicRef.current = characteristic;
      deviceRef.current = device;
      disconnectListenerRef.current = onDisconnected;
      setDeviceName(device.name?.trim() || 'อุปกรณ์ BLE');
      setConnected(true);
      setInitialValue('');
      setWrittenValue('');
      setPredictedValue('');
      setHasWrittenSinceRead(false);
      setNotice('เชื่อมต่อแล้ว อ่านค่าเริ่มต้นจากอุปกรณ์ได้เลย');
    } catch (error) {
      if (connectingDevice?.gatt?.connected) connectingDevice.gatt.disconnect();
      setNotice('ยังไม่ได้เชื่อมต่ออุปกรณ์');
      setErrorMessage(friendlyError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const disconnectDevice = () => {
    clearError();
    const device = deviceRef.current;
    if (device) {
      const listener = disconnectListenerRef.current;
      if (listener) device.removeEventListener('gattserverdisconnected', listener);
      if (device.gatt?.connected) device.gatt.disconnect();
    }
    handleDisconnected();
  };

  const readInitialValue = async () => {
    clearError();
    const characteristic = characteristicRef.current;
    if (!characteristic) {
      setErrorMessage('กรุณาเชื่อมต่ออุปกรณ์ก่อนอ่านค่า');
      return;
    }

    setBusyAction('read-initial');
    try {
      const value = decodeCharacteristicValue(await characteristic.readValue());
      setInitialValue(value || '(อุปกรณ์ส่งค่าว่าง)');
      setPredictedValue('');
      setNotice('อ่านค่าเริ่มต้นแล้ว');
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const writeNames = async () => {
    clearError();
    const characteristic = characteristicRef.current;
    if (!characteristic) {
      setErrorMessage('กรุณาเชื่อมต่ออุปกรณ์ก่อนเขียนค่า');
      return;
    }

    const cleanStudentName = studentName.trim();
    const cleanBuddyName = buddyName.trim();
    if (!cleanStudentName || !cleanBuddyName) {
      setErrorMessage('กรอกชื่อของคุณและชื่อเพื่อนให้ครบก่อนส่ง');
      return;
    }

    const value = makeWriteValue(cleanStudentName, cleanBuddyName);
    const bytes = toArrayBuffer(new TextEncoder().encode(value));
    setBusyAction('write');
    setPredictedValue('');
    setHasWrittenSinceRead(false);
    try {
      if (characteristic.writeValueWithResponse) {
        await characteristic.writeValueWithResponse(bytes);
      } else if (characteristic.writeValue) {
        await characteristic.writeValue(bytes);
      } else if (characteristic.writeValueWithoutResponse) {
        await characteristic.writeValueWithoutResponse(bytes);
      } else {
        throw new Error('Characteristic นี้ไม่รองรับการเขียนค่า');
      }
      setWrittenValue(value);
      setHasWrittenSinceRead(true);
      setNotice('ส่งชื่อแล้ว กดอ่านผลทำนายเพื่ออ่านค่าจากอุปกรณ์อีกครั้ง');
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const readPrediction = async () => {
    clearError();
    const characteristic = characteristicRef.current;
    if (!characteristic) {
      setErrorMessage('กรุณาเชื่อมต่ออุปกรณ์ก่อนอ่านผล');
      return;
    }
    if (!hasWrittenSinceRead) {
      setErrorMessage('เขียนชื่อของคุณและเพื่อนก่อนอ่านผลทำนาย');
      return;
    }

    setBusyAction('read-result');
    try {
      const value = decodeCharacteristicValue(await characteristic.readValue());
      setPredictedValue(value || '(อุปกรณ์ส่งค่าว่าง)');
      setHasWrittenSinceRead(false);
      setNotice('อ่านผลจากอุปกรณ์แล้ว');
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const isBusy = busyAction !== null;
  const showNativeNotice = Platform.OS !== 'web';

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>BG</Text></View>
          <View>
            <Text style={styles.brandName}>BuddyGrade BLE</Text>
            <Text style={styles.brandCaption}>BLE CLASS PROJECT</Text>
          </View>
          <View style={[styles.statusPill, connected ? styles.statusConnected : styles.statusIdle]}>
            <View style={[styles.statusDot, connected ? styles.dotConnected : styles.dotIdle]} />
            <Text style={[styles.statusPillText, connected ? styles.connectedText : styles.idleText]}>
              {connected ? 'CONNECTED' : 'NOT CONNECTED'}
            </Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>YOUR BLE GRADE CHECK</Text>
          <Text style={styles.heroTitle}>ส่งชื่อทีม{ '\n' }แล้วอ่านผลไปพร้อมกัน</Text>
          <Text style={styles.heroText}>
            เชื่อมต่ออุปกรณ์ของอาจารย์ อ่านค่าเริ่มต้น ส่งชื่อคุณกับเพื่อน แล้วอ่านผลที่อุปกรณ์ตอบกลับ
          </Text>
          <View style={styles.uuidStrip}>
            <Text style={styles.uuidLabel}>SERVICE</Text>
            <Text selectable style={styles.uuidValue}>{SERVICE_UUID}</Text>
          </View>
        </View>

        <View style={styles.stepsRow}>
          <Step number="01" label="เชื่อมต่อ" active={connected} />
          <View style={styles.stepLine} />
          <Step number="02" label="ส่งชื่อทีม" active={Boolean(writtenValue)} />
          <View style={styles.stepLine} />
          <Step number="03" label="อ่านผล" active={Boolean(predictedValue)} />
        </View>

        {showNativeNotice ? (
          <View style={styles.infoBanner}>
            <Text style={styles.bannerTitle}>กำลังดูตัวอย่างหน้าจอใน Expo Go</Text>
            <Text style={styles.bannerText}>
              การเชื่อมต่ออุปกรณ์จริงใช้ Web Bluetooth กรุณาเปิดเวอร์ชันเว็บใน Chrome ผ่าน HTTPS
            </Text>
          </View>
        ) : !secureContext ? (
          <View style={styles.infoBanner}>
            <Text style={styles.bannerTitle}>ต้องเปิดผ่าน HTTPS</Text>
            <Text style={styles.bannerText}>
              ใช้ localhost ระหว่างพัฒนา หรือเปิดลิงก์ HTTPS เมื่อใช้เว็บแอปบนโทรศัพท์
            </Text>
          </View>
        ) : !bluetoothSupported ? (
          <View style={styles.infoBanner}>
            <Text style={styles.bannerTitle}>เบราว์เซอร์นี้ยังใช้ BLE ไม่ได้</Text>
            <Text style={styles.bannerText}>เปิดด้วย Chrome บนอุปกรณ์ที่มี Bluetooth แล้วลองอีกครั้ง</Text>
          </View>
        ) : null}

        <View style={[styles.workspace, width < 760 && styles.workspaceNarrow]}>
          <View style={[styles.mainColumn, width < 760 && styles.columnNarrow]}>
            <View style={styles.panel}>
              <SectionHeading number="01" title="เชื่อมต่ออุปกรณ์" caption="เลือกอุปกรณ์ BLE ที่กำลังเปิดอยู่ใกล้คุณ" />
              <View style={styles.connectionRow}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.fieldLabel}>สถานะการเชื่อมต่อ</Text>
                  <Text style={styles.deviceName}>{connected ? deviceName : 'ยังไม่มีอุปกรณ์'}</Text>
                  <Text style={styles.helperText}>{notice}</Text>
                </View>
                <ActionButton
                  label={connected ? 'ตัดการเชื่อมต่อ' : 'ค้นหาอุปกรณ์'}
                  onPress={connected ? disconnectDevice : connectDevice}
                  disabled={isBusy || showNativeNotice || !secureContext || !bluetoothSupported}
                  tone={connected ? 'quiet' : 'primary'}
                />
              </View>
              <View style={styles.uuidRow}>
                <Text style={styles.fieldLabel}>CHARACTERISTIC</Text>
                <Text selectable style={styles.uuidSmall}>{CHAR_UUID}</Text>
              </View>
            </View>

            <View style={styles.panel}>
              <SectionHeading number="02" title="อ่านค่าเริ่มต้น" caption="อ่านข้อความแรกที่อุปกรณ์ส่งมา ก่อนเขียนชื่อ" />
              <View style={styles.readoutBox}>
                <Text style={styles.readoutLabel}>INITIAL VALUE</Text>
                <Text selectable style={[styles.readoutValue, !initialValue && styles.readoutPlaceholder]}>
                  {initialValue || 'ยังไม่ได้อ่านค่า'}
                </Text>
              </View>
              <ActionButton
                label="อ่านค่าจากอุปกรณ์"
                onPress={readInitialValue}
                disabled={!connected || isBusy}
                loading={busyAction === 'read-initial'}
                tone="secondary"
              />
            </View>

            <View style={styles.panel}>
              <SectionHeading number="03" title="ส่งชื่อของทีม" caption="กรอกชื่อทั้งสองคน ข้อมูลจะถูกส่งเป็นข้อความ UTF-8" />
              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>ชื่อของคุณ</Text>
                <TextInput
                  accessibilityLabel="ชื่อของคุณ"
                  value={studentName}
                  onChangeText={setStudentName}
                  placeholder="เช่น Somchai"
                  placeholderTextColor="#91A0AE"
                  style={styles.input}
                  editable={!isBusy}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>ชื่อเพื่อน</Text>
                <TextInput
                  accessibilityLabel="ชื่อเพื่อน"
                  value={buddyName}
                  onChangeText={setBuddyName}
                  placeholder="เช่น Siriporn"
                  placeholderTextColor="#91A0AE"
                  style={styles.input}
                  editable={!isBusy}
                  autoCapitalize="words"
                  returnKeyType="done"
                />
              </View>
              <View style={styles.previewBox}>
                <Text style={styles.readoutLabel}>VALUE TO WRITE</Text>
                <Text selectable style={styles.previewText}>{writeValue || 'ชื่อของคุณ, ชื่อเพื่อน'}</Text>
              </View>
              <ActionButton
                label="เขียนชื่อไปยังอุปกรณ์"
                onPress={writeNames}
                disabled={!connected || isBusy || !studentName.trim() || !buddyName.trim()}
                loading={busyAction === 'write'}
                tone="primary"
              />
            </View>
          </View>

          <View style={[styles.resultColumn, width < 760 && styles.columnNarrow]}>
            <View style={styles.resultPanel}>
              <View style={styles.resultTopline}>
                <Text style={styles.resultEyebrow}>TEAM RESULT</Text>
                <View style={styles.resultBadge}><Text style={styles.resultBadgeText}>BLE</Text></View>
              </View>
              <Text style={styles.resultTitle}>ผลทำนาย{ '\n' }จากอุปกรณ์</Text>
              <Text style={styles.resultDescription}>
                หลังเขียนชื่อแล้ว กดปุ่มด้านล่างเพื่ออ่านค่า Characteristic อีกครั้ง
              </Text>
              <View style={styles.resultReadout}>
                <Text style={styles.resultReadoutLabel}>PREDICTED GRADE</Text>
                <Text selectable style={[styles.resultValue, !predictedValue && styles.resultPlaceholder]}>
                  {predictedValue || '—'}
                </Text>
                {writtenValue ? <Text style={styles.resultTeam}>ทีม: {writtenValue}</Text> : null}
              </View>
              <ActionButton
                label="อ่านผลทำนาย"
                onPress={readPrediction}
                disabled={!connected || isBusy || !hasWrittenSinceRead}
                loading={busyAction === 'read-result'}
                tone="light"
              />
              <Text style={styles.resultHint}>
                {hasWrittenSinceRead ? 'พร้อมอ่านผลจากอุปกรณ์แล้ว' : 'ปุ่มจะพร้อมหลังเขียนชื่อสำเร็จ'}
              </Text>
            </View>

            <View style={styles.notePanel}>
              <Text style={styles.noteTitle}>ลำดับสำหรับส่งงาน</Text>
              <Text style={styles.noteItem}><Text style={styles.noteNumber}>1</Text> อ่านค่าเริ่มต้นและจับภาพหน้าจอ</Text>
              <Text style={styles.noteItem}><Text style={styles.noteNumber}>2</Text> กรอกชื่อทั้งสองคนแล้วเขียนค่า</Text>
              <Text style={styles.noteItem}><Text style={styles.noteNumber}>3</Text> อ่านผลทำนายและจับภาพหน้าจอ</Text>
            </View>
          </View>
        </View>

        {errorMessage ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorTitle}>ทำรายการไม่สำเร็จ</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.footerText}>SERVICE UUID · {SERVICE_UUID}</Text>
          <Text style={styles.footerText}>CHAR UUID · {CHAR_UUID}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function Step({ number, label, active }: { number: string; label: string; active: boolean }) {
  return (
    <View style={styles.step}>
      <View style={[styles.stepNumber, active && styles.stepNumberActive]}>
        <Text style={[styles.stepNumberText, active && styles.stepNumberTextActive]}>{number}</Text>
      </View>
      <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
    </View>
  );
}

function SectionHeading({ number, title, caption }: { number: string; title: string; caption: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionNumber}>{number}</Text>
      <View style={styles.sectionTitleGroup}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCaption}>{caption}</Text>
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  tone,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone: 'primary' | 'secondary' | 'quiet' | 'light';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${tone}`],
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      {loading ? <ActivityIndicator color={tone === 'light' ? '#17394B' : '#FFFFFF'} size="small" /> : null}
      <Text style={[styles.buttonText, styles[`buttonText_${tone}`], disabled && styles.buttonTextDisabled]}>
        {loading ? 'กำลังทำรายการ…' : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    backgroundColor: '#F2F5F3',
    paddingHorizontal: 20,
    paddingVertical: 26,
  },
  content: {
    width: '100%',
    maxWidth: 1060,
    alignSelf: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: '#CFF3DD',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  brandMarkText: { color: '#145D43', fontSize: 16, fontWeight: '900' },
  brandName: { color: '#19394B', fontSize: 16, fontWeight: '800' },
  brandCaption: { color: '#7A8A96', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginTop: 3 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusConnected: { backgroundColor: '#DDF5E7' },
  statusIdle: { backgroundColor: '#E5EBEF' },
  statusDot: { width: 7, height: 7, borderRadius: 5, marginRight: 7 },
  dotConnected: { backgroundColor: '#168355' },
  dotIdle: { backgroundColor: '#7A8994' },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  connectedText: { color: '#146743' },
  idleText: { color: '#627480' },
  hero: {
    backgroundColor: '#17394B',
    borderRadius: 28,
    padding: 30,
    overflow: 'hidden',
  },
  eyebrow: { color: '#9FE2C1', fontSize: 10, fontWeight: '800', letterSpacing: 1.8, marginBottom: 12 },
  heroTitle: { color: '#FFFFFF', fontSize: 34, lineHeight: 41, fontWeight: '800', letterSpacing: -0.8 },
  heroText: { color: '#D7E3E8', fontSize: 14, lineHeight: 22, maxWidth: 590, marginTop: 12 },
  uuidStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: 'flex-start',
    marginTop: 20,
  },
  uuidLabel: { color: '#A6DAC2', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginRight: 10 },
  uuidValue: { color: '#FFFFFF', fontSize: 11, fontVariant: ['tabular-nums'] },
  stepsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 22, paddingHorizontal: 4 },
  step: { flexDirection: 'row', alignItems: 'center' },
  stepNumber: { width: 29, height: 29, borderRadius: 15, backgroundColor: '#E1E8E7', alignItems: 'center', justifyContent: 'center' },
  stepNumberActive: { backgroundColor: '#D5F2E0' },
  stepNumberText: { color: '#71828C', fontSize: 9, fontWeight: '800' },
  stepNumberTextActive: { color: '#146743' },
  stepLabel: { color: '#778791', fontSize: 11, fontWeight: '700', marginLeft: 8 },
  stepLabelActive: { color: '#176A4A' },
  stepLine: { height: 1, backgroundColor: '#D4DDDC', flex: 1, marginHorizontal: 12 },
  workspace: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  workspaceNarrow: { flexDirection: 'column' },
  mainColumn: { flex: 1.45, minWidth: 0, gap: 14 },
  resultColumn: { flex: 1, minWidth: 0, gap: 14 },
  columnNarrow: { width: '100%', flex: 0 },
  panel: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 21, borderWidth: 1, borderColor: '#E3EAE7' },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 17 },
  sectionNumber: { color: '#168355', fontSize: 11, fontWeight: '900', marginRight: 12, marginTop: 2 },
  sectionTitleGroup: { flex: 1 },
  sectionTitle: { color: '#1B3A4A', fontSize: 17, fontWeight: '800' },
  sectionCaption: { color: '#74848F', fontSize: 11, lineHeight: 17, marginTop: 4 },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  deviceInfo: { flex: 1, minWidth: 0 },
  fieldLabel: { color: '#687D88', fontSize: 10, fontWeight: '800', letterSpacing: 0.7, marginBottom: 6 },
  deviceName: { color: '#183A4B', fontSize: 15, fontWeight: '800' },
  helperText: { color: '#74848F', fontSize: 11, lineHeight: 16, marginTop: 4 },
  uuidRow: { borderTopWidth: 1, borderTopColor: '#ECF0EE', marginTop: 17, paddingTop: 12 },
  uuidSmall: { color: '#536D78', fontSize: 10, fontVariant: ['tabular-nums'] },
  readoutBox: { backgroundColor: '#F3F7F5', borderRadius: 14, padding: 15, marginBottom: 13, minHeight: 82, justifyContent: 'center' },
  readoutLabel: { color: '#7A8A91', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 7 },
  readoutValue: { color: '#1D414F', fontSize: 16, fontWeight: '700' },
  readoutPlaceholder: { color: '#98A6AA', fontWeight: '500' },
  inputGroup: { marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#DCE5E2',
    backgroundColor: '#FAFCFB',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: '#1B3A4A',
    fontSize: 14,
  },
  previewBox: { backgroundColor: '#F3F7F5', borderRadius: 12, padding: 13, marginTop: 1, marginBottom: 13 },
  previewText: { color: '#48646E', fontSize: 12, fontWeight: '600' },
  button: {
    minHeight: 45,
    borderRadius: 13,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  button_primary: { backgroundColor: '#168355' },
  button_secondary: { backgroundColor: '#E5F4EA' },
  button_quiet: { backgroundColor: '#EDF1F1' },
  button_light: { backgroundColor: '#CFF3DD' },
  buttonDisabled: { backgroundColor: '#E7ECEA' },
  buttonPressed: { opacity: 0.82 },
  buttonText: { fontSize: 12, fontWeight: '800' },
  buttonText_primary: { color: '#FFFFFF' },
  buttonText_secondary: { color: '#176A4A' },
  buttonText_quiet: { color: '#385561' },
  buttonText_light: { color: '#155A42' },
  buttonTextDisabled: { color: '#96A29F' },
  resultPanel: { backgroundColor: '#EAF5EE', borderRadius: 22, padding: 23, borderWidth: 1, borderColor: '#D6EADF' },
  resultTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultEyebrow: { color: '#35805E', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  resultBadge: { backgroundColor: '#D2EBDD', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 },
  resultBadgeText: { color: '#26724F', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  resultTitle: { color: '#183B4C', fontSize: 25, lineHeight: 31, fontWeight: '800', marginTop: 17 },
  resultDescription: { color: '#607A83', fontSize: 11, lineHeight: 17, marginTop: 8 },
  resultReadout: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 16, minHeight: 124, justifyContent: 'center', marginTop: 18, marginBottom: 13 },
  resultReadoutLabel: { color: '#7B8D91', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  resultValue: { color: '#16764C', fontSize: 33, fontWeight: '900', marginTop: 6 },
  resultPlaceholder: { color: '#BCC9C5' },
  resultTeam: { color: '#6D8285', fontSize: 10, marginTop: 5 },
  resultHint: { color: '#6C8580', fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 10 },
  notePanel: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 19, borderWidth: 1, borderColor: '#E3EAE7' },
  noteTitle: { color: '#1B3A4A', fontSize: 13, fontWeight: '800', marginBottom: 11 },
  noteItem: { color: '#617580', fontSize: 10, lineHeight: 16, marginTop: 6 },
  noteNumber: { color: '#168355', fontWeight: '900' },
  infoBanner: { backgroundColor: '#FFF5D9', borderColor: '#F0E0AC', borderWidth: 1, padding: 14, borderRadius: 14, marginBottom: 14 },
  bannerTitle: { color: '#6D5416', fontSize: 12, fontWeight: '800' },
  bannerText: { color: '#796A40', fontSize: 11, lineHeight: 17, marginTop: 4 },
  errorBanner: { backgroundColor: '#FFF0EE', borderColor: '#F4D0CA', borderWidth: 1, padding: 14, borderRadius: 14, marginTop: 14 },
  errorTitle: { color: '#9A3D32', fontSize: 12, fontWeight: '800' },
  errorText: { color: '#804F49', fontSize: 11, lineHeight: 17, marginTop: 4 },
  footer: { borderTopWidth: 1, borderTopColor: '#DCE4E1', marginTop: 22, paddingTop: 14, gap: 5 },
  footerText: { color: '#839199', fontSize: 9, fontVariant: ['tabular-nums'] },
});
