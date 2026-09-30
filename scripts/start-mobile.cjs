const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const addresses = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
  (entries || []).filter(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
    .map(entry => ({ name, address: entry.address })),
);
const preferred = addresses.find(entry => /wi-?fi|wlan|wireless|^en0$/i.test(entry.name))
  || addresses.find(entry => !/virtual|vethernet|wsl|docker|vpn|loopback/i.test(entry.name));
const env = { ...process.env };
if (!env.REACT_NATIVE_PACKAGER_HOSTNAME && preferred) env.REACT_NATIVE_PACKAGER_HOSTNAME = preferred.address;
console.log(`Expo Go Wi-Fi host: ${env.REACT_NATIVE_PACKAGER_HOSTNAME || 'automatic'}`);
const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');
const child = spawn(process.execPath, [cli, 'start', '--go', '--lan', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
