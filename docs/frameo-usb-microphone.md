# Frameo USB Microphone Notes

This guide documents the Frameo/Android USB microphone path that worked on a
Rockchip-based B-141K frame running Fully Kiosk Browser.

The short version: the frame can support a USB microphone, but the USB port may
boot in charger/device mode. For microphone use, the port must be flipped into
USB host/OTG mode.

## Working Shape

- HA Light Panel is served over trusted HTTPS.
- Fully Kiosk Browser loads the panel.
- Fully has microphone permission.
- SimpleSSHD runs on the frame for debugging and fallback commands.
- The frame's USB OTG PHY is set to `host`.
- The USB microphone appears in Linux/ALSA as a second capture card.

Example working OS audio state:

```text
0 [rockchiprk809co]: rockchip_rk809- - rockchip,rk809-codec
                      rockchip,rk809-codec
1 [Device         ]: USB-Audio - USB PnP Sound Device
                      C-Media Electronics Inc. USB PnP Sound Device at usb-ff300000.usb-1, full speed
```

## Why ADB Alone Was Not Enough

ADB uses the USB port in device/gadget mode. When the frame is connected to a
computer for ADB, the same physical port may not enumerate a USB microphone.

Use ADB for setup, then use SSH or Fully's shell bridge to inspect and switch
the USB role after the frame is running normally on wall power.

## Enable ADB

Frameo has an official ADB flow. On many frames this is under beta or developer
features. After enabling ADB:

```sh
adb devices
adb shell getprop ro.product.model
adb shell ip addr show wlan0
```

Use ADB to install Fully Kiosk, SimpleSSHD, Taskbar, or other helper APKs.

## Enable Wireless ADB

Wireless ADB is useful while the USB port is being used for a microphone or OTG
adapter.

One common setup:

```sh
adb tcpip 5555
adb connect FRAME_IP:5555
```

Some frames also honor:

```sh
adb shell setprop persist.adb.tcp.port 5555
```

Reboot and confirm it reconnects:

```sh
adb connect FRAME_IP:5555
adb -s FRAME_IP:5555 get-state
```

## SimpleSSHD Setup

SimpleSSHD gives you a debugging shell without occupying USB.

Recommended local SSH config:

```sshconfig
Host frameo
  HostName FRAME_IP
  Port 2222
  User root
  IdentityFile ~/.ssh/frameo_ed25519
```

On this frame, the SSH username was `root`, but the initial shell ran as an
Android app UID. The bundled `/system/xbin/su` was still able to run commands
as UID 0.

Check:

```sh
ssh frameo 'id'
ssh frameo '/system/xbin/su 0 id'
```

## Force USB Host Mode

The working Rockchip OTG control was:

```text
/sys/devices/platform/ff2c0000.syscon/ff2c0000.syscon:usb2-phy@100/otg_mode
```

Set it to host:

```sh
ssh frameo "/system/xbin/su 0 sh -c 'echo host > /sys/devices/platform/ff2c0000.syscon/ff2c0000.syscon:usb2-phy@100/otg_mode'"
```

Or use the helper script:

```sh
FRAMEO_SSH_HOST=frameo scripts/frameo-usb-host.sh
```

Expected state:

```text
otg_mode: host
USB-HOST=1
USB_VBUS_EN=1
```

Then check the mic:

```sh
ssh frameo 'lsusb; cat /proc/asound/cards; cat /proc/asound/devices'
```

## Fully Kiosk Page-Load Bootstrap

HA Light Panel includes a Frameo bootstrap snippet in the served pages. When
Fully Kiosk exposes its JavaScript bridge, the page attempts to:

1. Start SimpleSSHD.
2. Set the Rockchip OTG mode to `host`.

This is intentionally best-effort. It makes normal wall-panel reloads recover
host mode after reboot, while the SSH script remains the manual fallback.

## Browser Privacy Mode

Android WebView/Fully may keep microphone device labels hidden even after the
Android app permission is granted. This is browser privacy behavior, not a sign
that the microphone is broken.

The mic test page works around this by:

- showing the browser's anonymous audio inputs,
- reading `/proc/asound/cards` through Fully's shell/file bridge,
- labeling browser candidates with OS card names when possible,
- providing a live input meter so each candidate can be tested.

The browser still owns the actual `deviceId` values used by `getUserMedia()`;
the OS list is only a friendly label source.

## HTTPS Requirement

Browser microphone access generally requires HTTPS or another trusted origin.
For a wall panel, use a trusted local HTTPS reverse proxy. A real certificate is
less painful than a self-signed one on Android WebView.

See [https.md](https.md).

## Push-To-Talk Behavior

On small frames, tap-to-toggle talk is more stable than press-and-hold. Holding
a touch event while the WebView decodes live video and captures microphone audio
can stall the page. HA Light Panel uses a toggle on the live camera page:

- `Talk On`
- `Warming up` with a spinner
- `Listening` with `press to stop`

If video stalls after talk ends, the page attempts a light live-view recovery.

## Troubleshooting

USB mic does not appear:

- Confirm the port is not connected to ADB over USB.
- Run the host-mode helper.
- Try a powered OTG adapter or hub.
- Check `USB-HOST=1` and `USB_VBUS_EN=1`.
- Check `lsusb` and `/proc/asound/cards`.

Browser mic works but labels are blank:

- This is normal on some WebViews.
- Use the OS audio device panel and the meter to identify the correct input.

Frame freezes during push-to-talk:

- Prefer tap-to-toggle talk.
- Keep live view short.
- Use the USB mic rather than a flaky built-in input.
- Reboot the frame if WebView becomes unresponsive:

```sh
ssh frameo '/system/xbin/su 0 reboot'
```
