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

        <View style={[styles.hero, width < 760 && styles.heroMobile]}>
          {width >= 900 ? (
            <View pointerEvents="none" style={styles.heroArtwork}>
              <View style={styles.orbitOuter} />
              <View style={styles.orbitInner} />
              <View style={styles.signalCore}><Text style={styles.signalSymbol}>ᛒ</Text></View>
              <View style={styles.signalTag}><View style={styles.signalDot} /><Text style={styles.signalTagText}>A little signal. A big connection.</Text></View>
              <View style={styles.orbitNode} />
            </View>
          ) : null}
          <Text style={styles.eyebrow}>BUDDY UP. CONNECT. DISCOVER.</Text>
          <Text style={styles.heroTitle}>สองชื่อ หนึ่งทีม{ '\n' }เชื่อมต่อความเป็นไปได้</Text>
          <Text style={styles.heroText}>
            เชื่อมต่ออุปกรณ์ของอาจารย์ อ่านค่าเริ่มต้น ส่งชื่อคุณกับเพื่อน แล้วอ่านผลที่อุปกรณ์ตอบกลับ
          </Text>
          <View style={styles.uuidStrip}>
            <View style={styles.signalDot} />
            <Text style={styles.uuidValue}>Bluetooth Low Energy · Classroom edition</Text>
          </View>
        </View>

        <View style={styles.stepsRow}>
          <Step number="01" label="เชื่อมต่อ" active={connected} />
          <View style={styles.stepLine} />
          <Step number="02" label="อ่านค่า" active={Boolean(initialValue)} />
          <View style={styles.stepLine} />
          <Step number="03" label="ส่งชื่อ" active={Boolean(writtenValue)} />
          <View style={styles.stepLine} />
          <Step number="04" label="อ่านผล" active={Boolean(predictedValue)} />
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
              <View style={[styles.connectionRow, width < 430 && styles.connectionNarrow]}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.fieldLabel}>สถานะการเชื่อมต่อ</Text>
                  <Text style={styles.deviceName}>{connected ? deviceName : 'ยังไม่มีอุปกรณ์'}</Text>
                  <Text style={styles.helperText}>{notice}</Text>
                </View>
                <ActionButton
                  label={connected ? 'ตัดการเชื่อมต่อ' : 'ค้นหาอุปกรณ์'}
                  onPress={connected ? disconnectDevice : connectDevice}
                  disabled={isBusy || showNativeNotice || !secureContext || !bluetoothSupported}
                  loading={busyAction === 'connect'}
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
                <Text selectable style={styles.previewText}>{studentName.trim() || buddyName.trim() ? writeValue : 'ชื่อของคุณ, ชื่อเพื่อน'}</Text>
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
              <View style={styles.resultDecoration}><Text style={styles.resultDecorationText}>✦</Text></View>
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
      accessibilityState={{ disabled, busy: loading }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${tone}`],
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      {loading ? <ActivityIndicator color={tone === 'secondary' || tone === 'quiet' ? '#285C45' : '#FFFFFF'} size="small" /> : null}
      <Text style={[styles.buttonText, styles[`buttonText_${tone}`], disabled && styles.buttonTextDisabled]}>
        {loading ? 'กำลังทำรายการ…' : label}
      </Text>
    </Pressable>
  );
}

const baseStyles = StyleSheet.create({
  page: {
    flexGrow: 1,
    backgroundColor: '#F4F6FC',
    paddingHorizontal: 22,
    paddingVertical: 30,
  },
  content: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 22,
  },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: '#E7E9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  brandMarkText: { color: '#5148D8', fontSize: 16, fontWeight: '900' },
  brandName: { color: '#17213E', fontSize: 16, fontWeight: '800' },
  brandCaption: { color: '#8790A6', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginTop: 3 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusConnected: { backgroundColor: '#DDF8F0' },
  statusIdle: { backgroundColor: '#E9ECF4' },
  statusDot: { width: 7, height: 7, borderRadius: 5, marginRight: 7 },
  dotConnected: { backgroundColor: '#12A77A' },
  dotIdle: { backgroundColor: '#8992A8' },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  connectedText: { color: '#087A5A' },
  idleText: { color: '#68738C' },
  hero: {
    backgroundColor: '#192442',
    borderRadius: 28,
    padding: 34,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#263252',
    shadowColor: '#1B2850',
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  eyebrow: { color: '#65E1C9', fontSize: 10, fontWeight: '800', letterSpacing: 1.8, marginBottom: 12 },
  heroTitle: { color: '#FFFFFF', fontSize: 35, lineHeight: 43, fontWeight: '800', letterSpacing: -0.8 },
  heroText: { color: '#D2D9E9', fontSize: 14, lineHeight: 23, maxWidth: 590, marginTop: 12 },
  uuidStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: 'flex-start',
    marginTop: 20,
  },
  uuidLabel: { color: '#75E3CF', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginRight: 10 },
  uuidValue: { color: '#FFFFFF', fontSize: 11, fontVariant: ['tabular-nums'] },
  stepsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 22, paddingHorizontal: 4 },
  step: { flexDirection: 'row', alignItems: 'center' },
  stepNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#E7EAF3', alignItems: 'center', justifyContent: 'center' },
  stepNumberActive: { backgroundColor: '#E4E5FF' },
  stepNumberText: { color: '#7C859B', fontSize: 9, fontWeight: '800' },
  stepNumberTextActive: { color: '#5148D8' },
  stepLabel: { color: '#7B8499', fontSize: 11, fontWeight: '700', marginLeft: 8 },
  stepLabelActive: { color: '#5148D8' },
  stepLine: { height: 1, backgroundColor: '#DDE1EC', flex: 1, marginHorizontal: 12 },
  workspace: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  workspaceNarrow: { flexDirection: 'column' },
  mainColumn: { flex: 1.45, minWidth: 0, gap: 14 },
  resultColumn: { flex: 1, minWidth: 0, gap: 14 },
  columnNarrow: { width: '100%', flex: 0 },
  panel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 21,
    padding: 22,
    borderWidth: 1,
    borderColor: '#E6E9F1',
    shadowColor: '#26345E',
    shadowOpacity: 0.045,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 17 },
  sectionNumber: { color: '#5B55DC', fontSize: 11, fontWeight: '900', marginRight: 12, marginTop: 2 },
  sectionTitleGroup: { flex: 1 },
  sectionTitle: { color: '#1D2948', fontSize: 17, fontWeight: '800' },
  sectionCaption: { color: '#778198', fontSize: 11, lineHeight: 17, marginTop: 4 },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  deviceInfo: { flex: 1, minWidth: 0 },
  fieldLabel: { color: '#707B94', fontSize: 10, fontWeight: '800', letterSpacing: 0.7, marginBottom: 6 },
  deviceName: { color: '#1D2948', fontSize: 15, fontWeight: '800' },
  helperText: { color: '#778198', fontSize: 11, lineHeight: 16, marginTop: 4 },
  uuidRow: { borderTopWidth: 1, borderTopColor: '#EDF0F5', marginTop: 17, paddingTop: 12 },
  uuidSmall: { color: '#596681', fontSize: 10, fontVariant: ['tabular-nums'] },
  readoutBox: { backgroundColor: '#F5F6FB', borderRadius: 15, padding: 16, marginBottom: 13, minHeight: 86, justifyContent: 'center', borderWidth: 1, borderColor: '#ECEEF5' },
  readoutLabel: { color: '#818AA0', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 7 },
  readoutValue: { color: '#273452', fontSize: 16, fontWeight: '700' },
  readoutPlaceholder: { color: '#A4ABBA', fontWeight: '500' },
  inputGroup: { marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#DFE3ED',
    backgroundColor: '#FCFCFE',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: '#1D2948',
    fontSize: 14,
  },
  previewBox: { backgroundColor: '#F5F6FB', borderRadius: 13, padding: 14, marginTop: 1, marginBottom: 13, borderWidth: 1, borderColor: '#ECEEF5' },
  previewText: { color: '#4C5874', fontSize: 12, fontWeight: '600' },
  button: {
    minHeight: 45,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  button_primary: { backgroundColor: '#5B55DC' },
  button_secondary: { backgroundColor: '#ECECFF' },
  button_quiet: { backgroundColor: '#EEF0F6' },
  button_light: { backgroundColor: '#70E5CF' },
  buttonDisabled: { backgroundColor: '#ECEEF3' },
  buttonPressed: { opacity: 0.82 },
  buttonText: { fontSize: 12, fontWeight: '800' },
  buttonText_primary: { color: '#FFFFFF' },
  buttonText_secondary: { color: '#4E49C6' },
  buttonText_quiet: { color: '#4F5A75' },
  buttonText_light: { color: '#172442' },
  buttonTextDisabled: { color: '#A4AABB' },
  resultPanel: {
    backgroundColor: '#202B4B',
    borderRadius: 23,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2D3A5E',
    shadowColor: '#17213E',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  resultTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultEyebrow: { color: '#70E5CF', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  resultBadge: { backgroundColor: '#344264', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  resultBadgeText: { color: '#B9C5E0', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  resultTitle: { color: '#FFFFFF', fontSize: 26, lineHeight: 33, fontWeight: '800', marginTop: 18 },
  resultDescription: { color: '#B7C1D9', fontSize: 11, lineHeight: 18, marginTop: 8 },
  resultReadout: { backgroundColor: '#2A3658', borderRadius: 16, padding: 17, minHeight: 132, justifyContent: 'center', marginTop: 19, marginBottom: 13, borderWidth: 1, borderColor: '#39476A' },
  resultReadoutLabel: { color: '#AEBAD5', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  resultValue: { color: '#70E5CF', fontSize: 35, fontWeight: '900', marginTop: 6 },
  resultPlaceholder: { color: '#667391' },
  resultTeam: { color: '#BAC5DC', fontSize: 10, marginTop: 5 },
  resultHint: { color: '#B1BDD6', fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 10 },
  notePanel: { backgroundColor: '#FFFFFF', borderRadius: 19, padding: 20, borderWidth: 1, borderColor: '#E6E9F1', shadowColor: '#26345E', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  noteTitle: { color: '#1D2948', fontSize: 13, fontWeight: '800', marginBottom: 11 },
  noteItem: { color: '#66718A', fontSize: 10, lineHeight: 17, marginTop: 6 },
  noteNumber: { color: '#5B55DC', fontWeight: '900' },
  infoBanner: { backgroundColor: '#FFF7E5', borderColor: '#F2E3BA', borderWidth: 1, padding: 15, borderRadius: 15, marginBottom: 14 },
  bannerTitle: { color: '#715720', fontSize: 12, fontWeight: '800' },
  bannerText: { color: '#806D43', fontSize: 11, lineHeight: 17, marginTop: 4 },
  errorBanner: { backgroundColor: '#FFF1F0', borderColor: '#F3D4D1', borderWidth: 1, padding: 15, borderRadius: 15, marginTop: 14 },
  errorTitle: { color: '#A13D3B', fontSize: 12, fontWeight: '800' },
  errorText: { color: '#805354', fontSize: 11, lineHeight: 17, marginTop: 4 },
  footer: { borderTopWidth: 1, borderTopColor: '#DEE2EC', marginTop: 24, paddingTop: 15, gap: 5 },
  footerText: { color: '#8790A6', fontSize: 9, fontVariant: ['tabular-nums'] },
});

const styles = StyleSheet.create({
  ...baseStyles,
  page: { ...baseStyles.page, backgroundColor: '#F7F6F2', paddingVertical: 28, paddingHorizontal: 20 },
  brandRow: { ...baseStyles.brandRow, flexWrap: 'wrap', rowGap: 12 },
  brandMark: { ...baseStyles.brandMark, backgroundColor: '#173E3C', borderRadius: 16 },
  brandMarkText: { ...baseStyles.brandMarkText, color: '#C6F4CD' },
  brandName: { ...baseStyles.brandName, color: '#173E3C', fontSize: 18 },
  brandCaption: { ...baseStyles.brandCaption, color: '#697C75' },
  statusIdle: { backgroundColor: '#ECEDE6' },
  hero: { ...baseStyles.hero, backgroundColor: '#153D3B', borderColor: '#244C46', padding: 38, borderRadius: 30, shadowColor: '#173E3C' },
  heroMobile: { padding: 25, borderRadius: 24 },
  eyebrow: { ...baseStyles.eyebrow, color: '#B9E9BD', fontSize: 11, letterSpacing: 1.6 },
  heroTitle: { ...baseStyles.heroTitle, fontSize: 38, lineHeight: 49, maxWidth: 530 },
  heroText: { ...baseStyles.heroText, color: '#C7DCD4', maxWidth: 460, fontSize: 14, lineHeight: 25 },
  uuidStrip: { ...baseStyles.uuidStrip, borderRadius: 99, backgroundColor: '#254E46', borderColor: '#426359', gap: 8, paddingVertical: 10 },
  uuidValue: { ...baseStyles.uuidValue, color: '#D1ECD6', fontSize: 11, flexShrink: 1 },
  heroArtwork: { position: 'absolute', right: 34, top: 20, width: 270, height: 285, alignItems: 'center', justifyContent: 'center' },
  orbitOuter: { position: 'absolute', width: 254, height: 254, borderRadius: 127, borderWidth: 1, borderColor: '#41665B' },
  orbitInner: { position: 'absolute', width: 192, height: 192, borderRadius: 96, borderWidth: 1, borderColor: '#527366', backgroundColor: '#234A43' },
  signalCore: { width: 122, height: 122, borderRadius: 36, backgroundColor: '#C8ECA7', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-10deg' }], shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 9 } },
  signalSymbol: { fontSize: 83, lineHeight: 104, color: '#153D3B', fontWeight: '400', transform: [{ rotate: '10deg' }] },
  signalTag: { position: 'absolute', bottom: 12, backgroundColor: '#F6F6ED', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 7, transform: [{ rotate: '-4deg' }] },
  signalTagText: { color: '#254C43', fontSize: 10, fontWeight: '700' },
  signalDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#A4D88A', flexShrink: 0 },
  orbitNode: { position: 'absolute', right: 21, top: 40, width: 18, height: 18, borderRadius: 9, backgroundColor: '#F6BA90', borderWidth: 4, borderColor: '#153D3B' },
  stepsRow: { ...baseStyles.stepsRow, paddingVertical: 25 },
  step: { flex: 1, alignItems: 'center', gap: 8 },
  stepNumber: { ...baseStyles.stepNumber, backgroundColor: '#E8ECE3', width: 32, height: 32, borderRadius: 11 },
  stepNumberActive: { backgroundColor: '#D6E8CA' },
  stepNumberText: { ...baseStyles.stepNumberText, fontSize: 10, color: '#697C75' },
  stepNumberTextActive: { color: '#285A43' },
  stepLabel: { ...baseStyles.stepLabel, marginLeft: 0, color: '#68796F', fontSize: 12 },
  stepLabelActive: { color: '#285A43' },
  stepLine: { height: 1, backgroundColor: '#D8DFD3', flex: 0.35, marginHorizontal: 4, marginBottom: 22 },
  panel: { ...baseStyles.panel, borderColor: '#E4E8DF', borderRadius: 23, padding: 24, shadowColor: '#274B35' },
  sectionNumber: { color: '#3E6545', fontSize: 11, fontWeight: '800', marginRight: 12, backgroundColor: '#E8F0DF', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 7 },
  sectionTitle: { ...baseStyles.sectionTitle, color: '#213D36', fontSize: 19 },
  sectionCaption: { ...baseStyles.sectionCaption, color: '#6E8076', fontSize: 12, lineHeight: 20 },
  fieldLabel: { ...baseStyles.fieldLabel, color: '#637C6E', fontSize: 11 },
  deviceName: { ...baseStyles.deviceName, color: '#254C3C', fontSize: 17 },
  helperText: { ...baseStyles.helperText, color: '#6E8076', fontSize: 12, lineHeight: 20 },
  connectionNarrow: { flexDirection: 'column', alignItems: 'stretch' },
  deviceInfo: { ...baseStyles.deviceInfo, flexBasis: 'auto' },
  uuidSmall: { ...baseStyles.uuidSmall, color: '#788A7D', fontSize: 11, flexShrink: 1 },
  readoutBox: { ...baseStyles.readoutBox, backgroundColor: '#F2F5EE', borderColor: '#E5ECDE', minHeight: 94 },
  readoutLabel: { ...baseStyles.readoutLabel, color: '#738572', fontSize: 10 },
  readoutValue: { ...baseStyles.readoutValue, color: '#29493B', fontSize: 18 },
  input: { ...baseStyles.input, backgroundColor: '#FBFCF9', borderColor: '#DDE5D6', borderRadius: 14, paddingVertical: 14, fontSize: 15, color: '#254C3C' },
  previewBox: { ...baseStyles.previewBox, backgroundColor: '#F2F5EE', borderColor: '#E5ECDE' },
  previewText: { ...baseStyles.previewText, color: '#526C57', fontSize: 14 },
  button: { ...baseStyles.button, minHeight: 49, borderRadius: 14 },
  button_primary: { backgroundColor: '#285C45' },
  button_secondary: { backgroundColor: '#E9F1E0', borderWidth: 1, borderColor: '#D7E6C8' },
  button_quiet: { backgroundColor: '#EDF0E8' },
  button_light: { backgroundColor: '#173E3C' },
  buttonText: { ...baseStyles.buttonText, fontSize: 13 },
  buttonText_secondary: { color: '#3F6440' },
  buttonText_light: { color: '#FFFFFF' },
  buttonDisabled: { backgroundColor: '#E9ECE5', borderColor: '#E9ECE5' },
  buttonTextDisabled: { color: '#6D7A6E' },
  resultPanel: { ...baseStyles.resultPanel, backgroundColor: '#F8E5D6', borderColor: '#EBD5C3', shadowColor: '#875D3D', borderRadius: 25, padding: 27 },
  resultEyebrow: { ...baseStyles.resultEyebrow, color: '#91633E', fontSize: 10 },
  resultBadge: { ...baseStyles.resultBadge, backgroundColor: '#ECD2BA' },
  resultBadgeText: { ...baseStyles.resultBadgeText, color: '#805C3E' },
  resultDecoration: { width: 51, height: 51, borderRadius: 16, backgroundColor: '#FDF5EB', justifyContent: 'center', alignItems: 'center', marginTop: 24, transform: [{ rotate: '8deg' }] },
  resultDecorationText: { fontSize: 31, color: '#986237' },
  resultTitle: { ...baseStyles.resultTitle, color: '#3E4433', fontSize: 28, lineHeight: 37, marginTop: 14 },
  resultDescription: { ...baseStyles.resultDescription, color: '#806F5B', fontSize: 13, lineHeight: 22 },
  resultReadout: { ...baseStyles.resultReadout, backgroundColor: '#FFFAF4', borderColor: '#EBDAC8', minHeight: 158, padding: 22 },
  resultReadoutLabel: { ...baseStyles.resultReadoutLabel, color: '#947C62', fontSize: 10 },
  resultValue: { ...baseStyles.resultValue, color: '#285C45', fontSize: 43 },
  resultPlaceholder: { color: '#CDBFAE' },
  resultTeam: { ...baseStyles.resultTeam, color: '#7D785F', fontSize: 12, lineHeight: 20 },
  resultHint: { ...baseStyles.resultHint, color: '#806F5B', fontSize: 11, lineHeight: 18 },
  notePanel: { ...baseStyles.notePanel, borderColor: '#E4E8DF', padding: 22 },
  noteTitle: { ...baseStyles.noteTitle, color: '#29493B', fontSize: 15 },
  noteItem: { ...baseStyles.noteItem, color: '#6E8076', fontSize: 12, lineHeight: 21 },
  noteNumber: { color: '#285C45', fontWeight: '900' },
  footer: { ...baseStyles.footer, borderTopColor: '#DCE3D6' },
  footerText: { ...baseStyles.footerText, color: '#7E8D7C', fontSize: 10 },
});
