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

The delimiter is a comma and a space. If the class device expects another format, update the `makeWriteValue` function in `App.tsx`.
