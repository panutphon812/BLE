# BuddyGrade BLE

A small Expo project for the Bluetooth class assignment. It reads a BLE characteristic, writes the student's name and buddy's name, then reads the predicted result.

## Run the web app

1. Install Node.js 22.13 or newer.
2. Run `npm install` in this folder.
3. Run `npm run web` and open the local address in Chrome.
4. Connect to the class device, read the starting value, enter both names, write them, then read the prediction.

The app uses the Web Bluetooth API on the web. Use Chrome or another browser that supports Web Bluetooth. The page must be in a secure context: `localhost` is suitable for local development, while a hosted version must use HTTPS. To use the app from Chrome on a phone, host it at an HTTPS address.

Expo Go can display the app interface, but it cannot access the BLE device from inside Expo Go. The real BLE workflow runs in the web version in a compatible browser. A native BLE version would need an Expo development build.

## Device settings

- Service UUID: `aee04821-1973-4e1f-a590-e84b10d580e7`
- Characteristic UUID: `cde07b1a-889b-44b7-a99f-c888dddac729`
- Value written: `Student name, Buddy name` (UTF-8)

The delimiter is a comma and a space. If the class device expects another format, update the `makeWriteValue` function in `ble-client.ts`.

## Troubleshooting live BLE

The current build identifier is `BLE-AUDIT-20260930-1`, shown under the app name.
If it is missing, hard-refresh the browser or restart the Expo server with `npm run web -- --clear`.

Open the Bluetooth command log above the connection cards. It records service discovery,
the actual characteristic properties, write method, read response text, raw bytes, and errors.
Each GATT operation has a 10-second timeout and disconnects the session on timeout.
Cancel/disconnect remains available during an operation. Commands from an old session
cannot update the new session, and simultaneous commands are blocked.

For nRF Connect testing, enable Read and Write properties **and** their corresponding
permissions on the same characteristic. Start the GATT server and advertising.
Read an initial `Hello`, write two names, and read them back. To simulate a grade response,
change the server's characteristic value to `Grade A`, then read again without writing
the names a second time. A plain GATT server does not calculate a grade automatically.

The app always displays the actual response, including echoed names or empty data.
The initial read and result read are separate actions; result reads remain repeatable.

Run `npm test` for simulated BLE and UI-state regression checks. These checks do not
replace testing on the teacher's device or the actual nRF server.
