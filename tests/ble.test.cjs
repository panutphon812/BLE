const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { BleClient, SERVICE_UUID, CHAR_UUID } = require('../ble-client.ts');
const { decodeValue } = require('../ble-read.ts');
const encode = text => { const bytes = new TextEncoder().encode(text); return new DataView(bytes.buffer); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(timeout = 1000) {
  let stored = 'Hello';
  const listeners = new Set(), logs = [];
  const calls = { read: 0, response: 0, without: 0, legacy: 0, disconnected: 0 };
  const characteristic = {
    properties: { read: true, write: true, writeWithoutResponse: false },
    readValue: async () => { calls.read++; return encode(stored); },
    writeValueWithResponse: async buffer => { calls.response++; stored = new TextDecoder().decode(buffer); },
    writeValueWithoutResponse: async buffer => { calls.without++; stored = new TextDecoder().decode(buffer); },
    writeValue: async buffer => { calls.legacy++; stored = new TextDecoder().decode(buffer); },
  };
  const server = {
    connected: false,
    connect: async () => { server.connected = true; return server; },
    disconnect: () => { server.connected = false; for (const fn of [...listeners]) fn(); },
    getPrimaryService: async uuid => {
      assert.equal(uuid, SERVICE_UUID);
      return { getCharacteristic: async id => { assert.equal(id, CHAR_UUID); return characteristic; } };
    },
  };
  const device = { name: 'Test BLE', gatt: server,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  const bluetooth = { requestDevice: async options => {
    assert.deepEqual(options, { acceptAllDevices: true, optionalServices: [SERVICE_UUID] });
    return device;
  } };
  const client = new BleClient(message => logs.push(message), () => { calls.disconnected++; }, timeout);
  return { client, characteristic, server, bluetooth, device, listeners, logs, calls,
    setValue: text => { stored = text; }, value: () => stored };
}
const tests = [];
const test = (name, body) => tests.push([name, body]);

test('UTF-8 decoding respects DataView offset, null suffix, and raw hex', () => {
  const raw = new TextEncoder().encode('xxเกรด A\0yy');
  const view = new DataView(raw.buffer, 2, raw.length - 4);
  const result = decodeValue(view);
  assert.equal(result.text, 'เกรด A');
  assert.equal(result.byteLength, view.byteLength);
  assert.ok(result.hex.endsWith('00'));
  assert.equal(decodeValue(new DataView(new ArrayBuffer(0))).text, '');
});
test('connect, initial read, write, and changed grade read without reconnecting', async () => {
  const f = fixture(); await f.client.connect(f.bluetooth);
  assert.equal((await f.client.read()).text, 'Hello');
  await f.client.write(' Noon ', ' Kuy ');
  assert.equal(f.value(), 'Noon, Kuy');
  f.setValue('Grade A');
  assert.equal((await f.client.read()).text, 'Grade A');
  assert.equal((await f.client.read()).text, 'Grade A');
  assert.ok(f.logs.some(line => line.includes('READ 7 bytes')));
  f.client.disconnect(); assert.equal(f.listeners.size, 0);
});
test('echoed names and empty response are returned without filtering or fake grading', async () => {
  const f = fixture(); await f.client.connect(f.bluetooth); await f.client.write('A', 'B');
  assert.equal((await f.client.read()).text, 'A, B');
  f.setValue(''); assert.equal((await f.client.read()).byteLength, 0); f.client.disconnect();
});
test('actual properties choose write without response despite both methods existing', async () => {
  const f = fixture(); f.characteristic.properties.write = false; f.characteristic.properties.writeWithoutResponse = true;
  await f.client.connect(f.bluetooth); await f.client.write('A', 'B');
  assert.equal(f.calls.response, 0); assert.equal(f.calls.without, 1); f.client.disconnect();
});
test('legacy write remains supported when response method is unavailable', async () => {
  const f = fixture(); delete f.characteristic.writeValueWithResponse;
  await f.client.connect(f.bluetooth); await f.client.write('A', 'B');
  assert.equal(f.calls.legacy, 1); f.client.disconnect();
});
test('unsupported read fails without sending a read request', async () => {
  const f = fixture(); f.characteristic.properties.read = false;
  await f.client.connect(f.bluetooth); await assert.rejects(f.client.read(), /Read/);
  assert.equal(f.calls.read, 0); f.client.disconnect();
});
test('unsupported write and blank names cannot modify the server', async () => {
  const f = fixture(); await f.client.connect(f.bluetooth);
  await assert.rejects(f.client.write(' ', 'Buddy'), /กรอกชื่อ/);
  f.characteristic.properties.write = false;
  await assert.rejects(f.client.write('A', 'B'), /ไม่รองรับ/);
  assert.equal(f.value(), 'Hello'); f.client.disconnect();
});
test('read and write require a connected device', async () => {
  const f = fixture(); await assert.rejects(f.client.read(), /เชื่อมต่อ/); await assert.rejects(f.client.write('A','B'), /เชื่อมต่อ/);
});
test('read errors preserve their cause and release the operation lock', async () => {
  const f = fixture(); await f.client.connect(f.bluetooth);
  f.characteristic.readValue = async () => { throw new Error('GATT read not permitted'); };
  await assert.rejects(f.client.read(), /not permitted/);
  f.characteristic.readValue = async () => encode('Recovered');
  assert.equal((await f.client.read()).text, 'Recovered'); f.client.disconnect();
});
test('write failure is not automatically replayed using another write method', async () => {
  const f = fixture(); await f.client.connect(f.bluetooth);
  f.characteristic.writeValueWithResponse = async () => { throw new Error('write failed'); };
  await assert.rejects(f.client.write('A','B'), /write failed/);
  assert.equal(f.calls.without, 0); assert.equal(f.calls.legacy, 0); f.client.disconnect();
});
test('concurrent GATT commands are rejected before reaching the server', async () => {
  const f = fixture(); await f.client.connect(f.bluetooth); const pending = deferred();
  f.characteristic.readValue = () => pending.promise;
  const read = f.client.read();
  await assert.rejects(f.client.write('A','B'), /กำลังทำงาน/);
  pending.resolve(encode('A')); await read; assert.equal(f.calls.response, 0); f.client.disconnect();
});
test('read timeout disconnects and permits a clean reconnect', async () => {
  const f = fixture(20); await f.client.connect(f.bluetooth);
  f.characteristic.readValue = () => new Promise(() => {});
  await assert.rejects(f.client.read(), /READ REQUEST.*ไม่ตอบ/);
  assert.equal(f.client.connected, false); assert.equal(f.listeners.size, 0);
  f.characteristic.readValue = async () => encode('After reconnect');
  await f.client.connect(f.bluetooth); assert.equal((await f.client.read()).text, 'After reconnect'); f.client.disconnect();
});
test('write timeout disconnects instead of leaving the UI blocked indefinitely', async () => {
  const f = fixture(20); await f.client.connect(f.bluetooth);
  f.characteristic.writeValueWithResponse = () => new Promise(() => {});
  await assert.rejects(f.client.write('A','B'), /WRITE WITH RESPONSE.*ไม่ตอบ/);
  assert.equal(f.client.connected, false); assert.equal(f.listeners.size, 0);
});
test('service discovery timeout identifies the failed connection phase', async () => {
  const f = fixture(20); f.server.getPrimaryService = () => new Promise(() => {});
  await assert.rejects(f.client.connect(f.bluetooth), /GET SERVICE.*ไม่ตอบ/);
  assert.equal(f.server.connected, false); assert.equal(f.listeners.size, 0);
});
test('cancelled chooser and missing service leave no connected session', async () => {
  const f = fixture();
  await assert.rejects(f.client.connect({ requestDevice: async () => { throw new Error('User cancelled'); } }), /cancelled/);
  f.server.getPrimaryService = async () => { throw new Error('Service not found'); };
  await assert.rejects(f.client.connect(f.bluetooth), /not found/);
  assert.equal(f.client.connected, false); assert.equal(f.listeners.size, 0);
});
test('late read from old connection cannot replace a new session result', async () => {
  const f = fixture(); await f.client.connect(f.bluetooth); const pending = deferred();
  f.characteristic.readValue = () => pending.promise;
  const oldRead = f.client.read(); const failure = assert.rejects(oldRead, /ยกเลิก/); await tick();
  f.client.disconnect(); f.characteristic.readValue = async () => encode('New session');
  await f.client.connect(f.bluetooth); pending.resolve(encode('Old result')); await failure;
  assert.equal((await f.client.read()).text, 'New session'); f.client.disconnect();
});
test('late GATT connect after timeout is closed without leaking a connection', async () => {
  const f = fixture(20), pending = deferred();
  f.server.connect = async () => { await pending.promise; f.server.connected = true; return f.server; };
  await assert.rejects(f.client.connect(f.bluetooth), /GATT CONNECT.*ไม่ตอบ/);
  pending.resolve(); await tick();
  assert.equal(f.server.connected, false); assert.equal(f.listeners.size, 0);
});
test('unexpected disconnect removes its listener and invalidates pending operations', async () => {
  const f = fixture(); await f.client.connect(f.bluetooth); f.server.disconnect();
  assert.equal(f.client.connected, false); assert.equal(f.listeners.size, 0); assert.equal(f.calls.disconnected, 1);
  await assert.rejects(f.client.read(), /เชื่อมต่อ/);
});

// Minimal hook harness exercises UI state transitions using the actual hook.
let harness;
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'react') return {
    useState: initial => { const h = harness, index = h.cursor++; if (!(index in h.cells)) h.cells[index] = initial; return [h.cells[index], value => { h.cells[index] = typeof value === 'function' ? value(h.cells[index]) : value; }]; },
    useRef: initial => { const h = harness, index = h.cursor++; return h.cells[index] ||= { current: initial }; },
    useMemo: fn => { harness.cursor++; return fn(); },
    useEffect: fn => { const h = harness, index = h.cursor++; if (!(index in h.cells)) h.cells[index] = { cleanup: fn() }; },
  };
  if (request === 'react-native') return { Platform: { OS: 'web' } };
  return originalLoad.call(this, request, parent, isMain);
};
const { useBleApp } = require('../useBleApp.ts');
function mount(bluetooth) {
  const h = { cells: [], cursor: 0 };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth } });
  globalThis.window = { isSecureContext: true };
  const render = () => { harness = h; h.cursor = 0; return useBleApp(); };
  render();
  return { render, dispose: () => { for (const cell of h.cells) cell?.cleanup?.(); } };
}
test('UI full flow displays initial value, echoed names, new grade, and repeated reads', async () => {
  const f = fixture(), h = mount(f.bluetooth); let app = h.render(); await app.connectDevice();
  app = h.render(); assert.equal(app.connected, true); await app.readInitialValue();
  app = h.render(); assert.equal(app.initialValue, 'Hello');
  app.setStudentName('Noon'); app.setBuddyName('Kuy'); app = h.render(); await app.writeNames();
  app = h.render(); assert.equal(app.hasWrittenSinceRead, true); await app.readPrediction();
  app = h.render(); assert.equal(app.predictedValue, 'Noon, Kuy'); assert.equal(app.initialValue, 'Hello');
  f.setValue('Grade A'); await app.readPrediction(); app = h.render(); assert.equal(app.predictedValue, 'Grade A');
  assert.equal(app.hasWrittenSinceRead, true); await app.readInitialValue(); app = h.render();
  assert.equal(app.initialValue, 'Grade A'); assert.equal(app.predictedValue, 'Grade A');
  assert.equal(app.busyAction, null); h.dispose();
});
test('UI exposes read error and releases busy state for retry', async () => {
  const f = fixture(), h = mount(f.bluetooth); let app = h.render(); await app.connectDevice(); app = h.render();
  f.characteristic.readValue = async () => { throw new Error('Read permission denied'); }; await app.readInitialValue();
  app = h.render(); assert.match(app.errorMessage, /permission denied/); assert.equal(app.diagnosticsOpen, true); assert.equal(app.busyAction, null);
  f.characteristic.readValue = async () => encode('Success'); await app.readInitialValue(); app = h.render();
  assert.equal(app.errorMessage, ''); assert.equal(app.initialValue, 'Success'); h.dispose();
});
test('UI same-render double-click sends one write operation', async () => {
  const f = fixture(), h = mount(f.bluetooth); let app = h.render(); await app.connectDevice(); app = h.render();
  app.setStudentName('A'); app.setBuddyName('B'); app = h.render();
  let writes = 0; const pending = deferred(); f.characteristic.writeValueWithResponse = () => { writes++; return pending.promise; };
  const first = app.writeNames(), second = app.writeNames(); await tick(); assert.equal(writes, 1);
  pending.resolve(); await Promise.all([first, second]); app = h.render(); assert.equal(app.writtenValue, 'A, B'); h.dispose();
});
test('UI cancellation prevents a late read from changing a new connection', async () => {
  const f = fixture(), h = mount(f.bluetooth); let app = h.render(); await app.connectDevice(); app = h.render();
  const pending = deferred(); f.characteristic.readValue = () => pending.promise; const old = app.readInitialValue(); await tick();
  app.disconnectDevice(); app = h.render(); assert.equal(app.busyAction, null);
  f.characteristic.readValue = async () => encode('New'); await app.connectDevice(); pending.resolve(encode('Old')); await old;
  app = h.render(); assert.equal(app.initialValue, ''); assert.equal(app.errorMessage, '');
  await app.readInitialValue(); app = h.render(); assert.equal(app.initialValue, 'New'); h.dispose();
});

(async () => {
  let failures = 0;
  for (const [name, body] of tests) {
    try { await body(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}`, error); }
  }
  console.log(`${tests.length - failures}/${tests.length} checks passed`);
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
