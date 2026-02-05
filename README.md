# React Native WebRTC with Face Detection

[![npm version](https://img.shields.io/npm/v/react-native-webrtc-face-detection)](https://www.npmjs.com/package/react-native-webrtc-face-detection)
[![npm downloads](https://img.shields.io/npm/dm/react-native-webrtc-face-detection)](https://www.npmjs.com/package/react-native-webrtc-face-detection)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A powerful WebRTC module for React Native with **real-time face detection**, **eye tracking**, and **blink detection** capabilities. Built on top of the excellent [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc) project with enhanced ML-powered features.

## ✨ New Features

This fork extends the original react-native-webrtc with powerful face detection capabilities:

### 🎯 Real-Time Face Detection
- **High-performance on-device processing** using Google ML Kit
- **Cross-platform consistency**: Same ML Kit engine on both iOS and Android
- Detect multiple faces simultaneously with bounding boxes

### 👁️ Eye Tracking
- Real-time eye position tracking
- Left and right eye detection with precise coordinates
- Eye openness probability for each eye

### 😉 Blink Detection
- Accurate blink detection with configurable thresholds
- Blink event callbacks for real-time interaction
- `useBlinkDetection` React hook for easy integration

### 📸 Frame Capture on Blink
- **Automatic frame capture** when blink is detected
- Optional **face cropping** with configurable padding
- Configurable **image quality** and **max dimensions**
- Returns **base64 JPEG** for easy display or upload

### 🎣 React Hooks
- `useFaceDetection` - Easy-to-use hook for face detection
- `useBlinkDetection` - Hook for blink detection with customizable settings

### 📐 Head Pose Estimation
- Yaw, pitch, and roll angles
- Head orientation tracking for advanced use cases

## Feature Overview

|  | Android | iOS | tvOS | macOS* | Expo* |
| :- | :-: | :-: | :-: | :-: | :-: |
| Audio/Video | ✅ | ✅ | ✅ | - | ✅ |
| Data Channels | ✅ | ✅ | - | - | ✅ |
| Screen Capture | ✅ | ✅ | - | - | ✅ |
| **Face Detection** | ✅ | ✅ | - | - | ✅ |
| **Eye Tracking** | ✅ | ✅ | - | - | ✅ |
| **Blink Detection** | ✅ | ✅ | - | - | ✅ |
| **Frame Capture** | ✅ | ✅ | - | - | ✅ |
| Unified Plan | ✅ | ✅ | - | - | ✅ |
| Simulcast | ✅ | ✅ | - | - | ✅ |

> **Expo** - This module includes native code and requires a development build. Use [expo-dev-client](https://docs.expo.dev/development/getting-started/) for Expo projects.

## WebRTC Revision

* Currently used revision: [M124](https://github.com/jitsi/webrtc/tree/M124)
* Supported architectures
  * Android: armeabi-v7a, arm64-v8a, x86, x86_64
  * iOS: arm64, x86_64
  * tvOS: arm64

## 🚀 Getting Started

### Installation

```bash
# npm
npm install react-native-webrtc-face-detection --save

# yarn
yarn add react-native-webrtc-face-detection

# pnpm
pnpm install react-native-webrtc-face-detection
```

### iOS Setup

```bash
cd ios && pod install
```

### Android Setup

No additional setup required - ML Kit is automatically included.

### Platform Requirements

| Platform | Minimum Version | Notes |
|----------|-----------------|-------|
| iOS | 15.5+ | Required by Google ML Kit |
| Android | API 21+ | Standard React Native requirement |
| macOS | 10.13+ | Limited support |
| tvOS | 16.0+ | Limited support |

> **Note**: Face detection features require iOS 15.5+ due to Google ML Kit dependencies. If your app targets older iOS versions, face detection will not be available on those devices.

## 📖 Usage

### Basic Face Detection

```typescript
import { useFaceDetection, RTCView } from 'react-native-webrtc-face-detection';

function VideoCall() {
  const { faces, isDetecting } = useFaceDetection({
    enabled: true,
    trackId: localStream?.getVideoTracks()[0]?.id,
  });

  return (
    <View>
      <RTCView streamURL={localStream?.toURL()} />
      {faces.map((face, index) => (
        <View key={index}>
          <Text>Face detected at: {JSON.stringify(face.boundingBox)}</Text>
          <Text>Left eye open: {face.leftEyeOpenProbability}</Text>
          <Text>Right eye open: {face.rightEyeOpenProbability}</Text>
        </View>
      ))}
    </View>
  );
}
```

### Blink Detection

```typescript
import { useBlinkDetection } from 'react-native-webrtc-face-detection';

function BlinkTracker() {
  const { blinkCount, lastBlinkTime } = useBlinkDetection({
    enabled: true,
    trackId: videoTrackId,
    onBlink: (event) => {
      console.log('Blink detected!', event);
    },
  });

  return <Text>Blinks: {blinkCount}</Text>;
}
```

### Face Detection Configuration

```typescript
import { configureWebRTC } from 'react-native-webrtc-face-detection';

// Enable face detection feature (call once at app startup)
configureWebRTC({
  enableFaceDetection: true,
});
```

### Blink Capture (Standalone Camera - No WebRTC)

Use face detection with just the camera, without WebRTC peer connections:

```typescript
import { useState, useEffect } from 'react';
import { View, Text, Image } from 'react-native';
import {
  mediaDevices,
  RTCView,
  MediaStream,
  useBlinkDetection,
  configureWebRTC,
} from 'react-native-webrtc-face-detection';

// Enable face detection (call once at app startup)
configureWebRTC({ enableFaceDetection: true });

function BlinkCaptureCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const videoTrack = stream?.getVideoTracks()[0] ?? null;

  // Blink detection with frame capture
  const { blinkCount, recentBlinks, enable, disable } = useBlinkDetection(videoTrack, {
    captureOnBlink: true,    // Capture frame on blink
    cropToFace: true,        // Crop to face region
    imageQuality: 0.8,       // JPEG quality (0.0-1.0)
    maxImageWidth: 480,      // Scale down if wider
  });

  // Start camera
  useEffect(() => {
    const startCamera = async () => {
      const mediaStream = await mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      setStream(mediaStream);
    };
    startCamera();
    return () => { stream?.release(); };
  }, []);

  // Enable detection when track is ready
  useEffect(() => {
    if (videoTrack) enable();
    return () => { disable(); };
  }, [videoTrack]);

  // Get latest captured image
  useEffect(() => {
    const latestBlink = recentBlinks[recentBlinks.length - 1];
    if (latestBlink?.faceImage) {
      setCapturedImage(latestBlink.faceImage);
    }
  }, [recentBlinks]);

  return (
    <View style={{ flex: 1 }}>
      {stream && (
        <RTCView
          streamURL={stream.toURL()}
          style={{ width: 300, height: 400 }}
          mirror={true}
        />
      )}
      <Text>Blinks: {blinkCount}</Text>
      {capturedImage && (
        <Image
          source={{ uri: `data:image/jpeg;base64,${capturedImage}` }}
          style={{ width: 120, height: 120, borderRadius: 8 }}
        />
      )}
    </View>
  );
}
```

### Video Calling with Face Detection

Full WebRTC video call with face detection overlay:

```typescript
import { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import {
  RTCPeerConnection,
  RTCView,
  mediaDevices,
  useFaceDetection,
  useBlinkDetection,
  configureWebRTC,
} from 'react-native-webrtc-face-detection';

configureWebRTC({ enableFaceDetection: true });

function VideoCallWithFaceDetection() {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);

  const localVideoTrack = localStream?.getVideoTracks()[0] ?? null;

  // Face detection on local video
  const { detectionResult } = useFaceDetection(localVideoTrack);

  // Blink detection with capture
  const { blinkCount, recentBlinks } = useBlinkDetection(localVideoTrack, {
    captureOnBlink: true,
    cropToFace: true,
  });

  useEffect(() => {
    const setupCall = async () => {
      // Get local media
      const stream = await mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      });
      setLocalStream(stream);

      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      // Add tracks to connection
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // Handle remote stream
      pc.ontrack = (event) => setRemoteStream(event.streams[0]);

      setPeerConnection(pc);
      // ... add signaling logic (offer/answer exchange)
    };

    setupCall();
    return () => {
      peerConnection?.close();
      localStream?.release();
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {/* Remote video (full screen) */}
      {remoteStream && (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={{ flex: 1 }}
          objectFit="cover"
        />
      )}

      {/* Local video (picture-in-picture) */}
      {localStream && (
        <RTCView
          streamURL={localStream.toURL()}
          style={{ width: 100, height: 150, position: 'absolute', top: 20, right: 20 }}
          mirror={true}
        />
      )}

      {/* Face detection info */}
      <View style={{ position: 'absolute', bottom: 20, left: 20 }}>
        <Text style={{ color: 'white' }}>
          Faces: {detectionResult?.faces.length ?? 0} | Blinks: {blinkCount}
        </Text>
      </View>
    </View>
  );
}
```

## 📚 Documentation

- [Android Installation](./Documentation/AndroidInstallation.md)
- [iOS Installation](./Documentation/iOSInstallation.md)
- [tvOS Installation](./Documentation/tvOSInstallation.md)
- [Basic Usage](./Documentation/BasicUsage.md)
- [Face Detection Guide](./Documentation/FaceDetection.md)
- [Step by Step Call Guide](./Documentation/CallGuide.md)
- [Improving Call Reliability](./Documentation/ImprovingCallReliability.md)

## 🔧 API Reference

### Configuration

```typescript
// Face detection options (passed to hooks)
interface FaceDetectionConfig {
  frameSkipCount?: number;    // Process every Nth frame (default: 3)
  blinkThreshold?: number;    // Eye open probability threshold (default: 0.3)
  captureOnBlink?: boolean;   // Capture frame on blink (default: false)
  cropToFace?: boolean;       // Crop to face bounds (default: true)
  imageQuality?: number;      // JPEG quality 0.0-1.0 (default: 0.7)
  maxImageWidth?: number;     // Max image width in pixels (default: 480)
}
```

### Types

```typescript
interface Face {
  bounds: BoundingBox;
  landmarks?: FaceLandmarks;
  confidence: number;
  trackingId?: number;
  headPose?: HeadPose;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FaceLandmarks {
  leftEye: EyeData;
  rightEye: EyeData;
}

interface EyeData {
  position: { x: number; y: number };
  isOpen: boolean;
  openProbability: number;  // 0.0 (closed) to 1.0 (open)
  blinkCount: number;
}

interface HeadPose {
  yaw: number;   // Left/right rotation
  pitch: number; // Up/down rotation
  roll: number;  // Tilt rotation
}

interface BlinkEvent {
  timestamp: number;          // Blink timestamp (ms)
  eye: 'left' | 'right';     // Which eye blinked
  trackingId?: number;        // Face tracking ID
  blinkCount?: number;        // Total blinks for this eye
  faceImage?: string;         // Base64 JPEG (if captureOnBlink: true)
  faceBounds?: BoundingBox;   // Face bounds at capture time
}

interface FaceDetectionResult {
  faces: Face[];
  timestamp: number;
  frameWidth: number;
  frameHeight: number;
}
```

### Hooks

| Hook | Description |
|------|-------------|
| `useFaceDetection` | Returns detected faces and detection state |
| `useBlinkDetection` | Tracks blinks with configurable callbacks |

### Components

| Component | Description |
|-----------|-------------|
| `RTCView` | Video rendering component |
| `RTCPIPView` | Picture-in-Picture video view |
| `ScreenCapturePickerView` | Screen capture picker (iOS) |

## 📁 Example Projects

Check out the [examples](./examples) directory for complete working examples:

- **ExpoTestApp** - Full-featured Expo example with face detection demo
- **GumTestApp** - Basic getUserMedia example

## 🙏 Acknowledgements

This project is a fork of [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc) by the React Native WebRTC Community. We are grateful for their excellent work in bringing WebRTC to React Native.

### Original Project Credits
- **Repository**: [react-native-webrtc/react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc)
- **Community**: [React Native WebRTC Discourse](https://react-native-webrtc.discourse.group/)
- **WebRTC**: Built on [Jitsi's WebRTC builds](https://github.com/jitsi/webrtc)

### What's Added in This Fork
- Real-time face detection using Google ML Kit (iOS & Android)
- Eye tracking with openness probability
- Blink detection with React hooks
- **Frame capture on blink** with face cropping
- Head pose estimation
- `useFaceDetection` and `useBlinkDetection` hooks
- Face detection processor architecture for Android and iOS

## 📄 License

MIT License - see the [LICENSE](./LICENSE) file for details.

This project is based on [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc) which is also MIT licensed.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📬 Support

- **Issues**: [GitHub Issues](https://github.com/arfuhad/react-native-webrtc/issues)
- **Original WebRTC Community**: [Discourse Forum](https://react-native-webrtc.discourse.group/)
