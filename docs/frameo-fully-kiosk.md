# Frameo / Fully Kiosk Browser Setup

This guide is for using HA Light Panel on a Frameo-style Android picture frame
with Fully Kiosk Browser as the dashboard browser.

The exact menus vary by frame vendor and Frameo version. The broad setup is:

1. Enable Frameo beta features.
2. Enable ADB access.
3. Sideload Fully Kiosk Browser and optional helper apps.
4. Point Fully Kiosk Browser at HA Light Panel.
5. Use HTTPS if you want microphone push-to-talk.
6. Keep the server URL simple and stable.

Frameo has an official help article for enabling ADB: [How to Enable ADB on Your Frame](https://help.buyframeo.com/hc/en-nz/articles/37886522007961-How-to-Enable-ADB-on-Your-Frame).

Fully Kiosk Browser: [fully-kiosk.com](https://www.fully-kiosk.com/)

Taskbar project: [farmerbb/Taskbar](https://github.com/farmerbb/Taskbar)

## Server URL

Use the server IP first:

```text
http://192.168.1.20:8890/
```

Avoid this until you have confirmed Android resolves it:

```text
http://ha-server.local:8890/
```

Many Android WebViews do not resolve `.local` mDNS names reliably. If the page
works from your laptop but Fully Kiosk cannot connect, try the IP address.

For microphone or push-to-talk, use a trusted HTTPS URL:

```text
https://192.168.1.20:8891/
```

or a local DNS name with a trusted certificate:

```text
https://panel.example.com/
```

## Enable ADB on Frameo

On the frame:

1. Open Frameo settings.
2. Enable beta features or join the beta program.
3. Enable ADB access.
4. Connect the frame to your computer with a USB data cable.
5. Accept the "Allow USB debugging" prompt on the frame.

On your computer:

```sh
adb devices
```

You should see the frame listed as `device`.

If it says `unauthorized`, unlock or wake the frame and accept the prompt. If
nothing appears, try another USB cable; many USB cables are power-only.

## Useful ADB Commands

Install APKs:

```sh
adb install Fully-Kiosk-Browser.apk
adb install SimpleSSHD.apk
adb install Taskbar.apk
```

Reinstall an APK:

```sh
adb install -r Fully-Kiosk-Browser.apk
```

List packages:

```sh
adb shell pm list packages | grep -Ei 'fully|sshd|taskbar'
```

Start an app when you know its package:

```sh
adb shell monkey -p de.ozerov.fully 1
```

Check display size:

```sh
adb shell wm size
adb shell wm density
```

Check network:

```sh
adb shell ip addr show wlan0
adb shell ping -c 3 192.168.1.20
```

## Fully Kiosk Browser Setup

In Fully Kiosk Browser:

1. Set the Start URL to HA Light Panel.
2. Enable fullscreen or immersive mode.
3. Enable JavaScript.
4. Enable the Fully JavaScript interface.
5. Grant microphone permission if using push-to-talk.
6. Keep the screen awake if your frame power/thermal behavior allows it.
7. If `.local` fails, use the server IP.

Recommended URL shapes:

```text
http://SERVER_IP:8890/
https://SERVER_IP:8891/
```

Use HTTPS for microphone features. Plain HTTP is fine for a dashboard without
mic access.

For very slow frames, avoid loading the full Home Assistant frontend in Fully.
The whole point of HA Light Panel is that Fully only renders a small SVG/HTML
surface.

## Fully JavaScript Bridge

HA Light Panel uses Fully's JavaScript bridge when available to help Frameo
devices recover after reboot:

- start SimpleSSHD,
- flip the tested Rockchip USB OTG PHY into host mode,
- read OS audio device names for the mic test page.

The bridge is best-effort. The panel still works without it, but USB microphone
diagnostics and automatic host-mode recovery are much better with it enabled.

## Taskbar Setup

Taskbar is useful when the frame is still running the photo-frame app and you
want a simple edge launcher to switch between Frameo and Fully Kiosk Browser.

Suggested setup:

- Enable Taskbar's floating or edge handle.
- Put Fully Kiosk Browser and Frameo in the quick app list.
- Keep the handle small and near an edge that does not cover panel buttons.
- Avoid heavy launchers if the frame is underpowered.

## Frameo + Fully Workflow

One practical arrangement:

- Frameo remains the normal photo-frame app.
- Fully Kiosk Browser opens HA Light Panel.
- Taskbar gives you a small edge handle to jump between them.
- HA Light Panel runs on your HA server or another always-on local box.

## Camera Notes

Static camera snapshots are cheap and usually work well on slow frames.

Live camera view is heavier:

- It may wake battery cameras.
- It may use a local live-view proxy.
- It may fail if the camera integration refuses embedding or requires auth.
- It can increase CPU/network use while the stream is active.

Use snapshots for the main camera grid, then tap through to live view only when
needed.

## Microphone / Push-To-Talk Notes

USB microphones are not guaranteed on photo frames.

Things that must all work:

- The frame must support USB host/OTG, not just USB device mode for ADB.
- Android must expose the mic as an audio input.
- Fully Kiosk Browser must have microphone permission.
- The panel URL usually needs HTTPS for browser microphone APIs.
- Fully's JavaScript bridge should be enabled for OS-level mic diagnostics.

ADB checks after plugging in a mic:

```sh
adb shell cat /proc/asound/cards
adb shell dumpsys audio
```

See [HTTPS](https.md) before trying browser-based push-to-talk.

For the tested Frameo USB-host workflow, SimpleSSHD setup, Fully Kiosk bridge,
and `/proc/asound` microphone diagnostics, see
[frameo-usb-microphone.md](frameo-usb-microphone.md).

## Troubleshooting

Page works on laptop but not on frame:

- Use `http://SERVER_IP:8890/` or `https://SERVER_IP:8891/` instead of `.local`.
- Make sure the frame and server are on the same Wi-Fi/VLAN.
- Confirm the server is listening on `0.0.0.0`, not only `127.0.0.1`.
- Try opening `/plain-test` or `/health` if configured.

ADB does not see the frame:

- Try a known data-capable USB cable.
- Revoke and re-allow USB debugging on the frame if available.
- Toggle ADB access off/on in Frameo settings.
- Run `adb kill-server && adb start-server`.

Fully loads but feels slow:

- Do not point it at Lovelace for this use case.
- Use HA Light Panel directly.
- Reduce camera live-view use.
- Keep animated browser effects minimal.

HTTPS certificate warning:

- Use HTTP on LAN for non-mic dashboards, or use a real trusted certificate.
- Avoid self-signed certs unless you know Fully/Android WebView trusts them.
