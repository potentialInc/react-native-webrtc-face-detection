# CLAUDE.md

## Project
react-native-webrtc-face-detection (v124.1.0) — React Native WebRTC library with ML Kit-powered face detection, eye tracking, and blink detection on iOS and Android.

## Commands
- `npm run build` — bob build (outputs commonjs, module, typescript to lib/)
- `npm run lint` — eslint + tsc --noEmit
- `npm run typecheck` — tsc --noEmit
- `npm run clean` — rm -rf lib
- `npm run format` — tools/format.sh (prettier)
- `npm run lintfix` — eslint --fix + tsc --noEmit

## Structure
```
src/                           43 TS/TSX files — JS/TS layer
  index.ts                     All public exports + registerGlobals()
  hooks/
    useFaceDetection.ts        Face detection React hook
    useBlinkDetection.ts       Blink detection React hook
  FaceDetection.types.ts       Face/Blink/Eye type definitions
  MediaStreamTrack.ts          Track class — enableFaceDetection/disableFaceDetection bridge
  WebRTCModuleConfig.ts        Feature flags (enableFaceDetection, enableScreenCapture)
  EventEmitter.ts              Native event relay (16 events)
  RTCPeerConnection.ts         Core peer connection wrapper
  RTCView.ts                   Video rendering component
  RTCPIPView.tsx               Picture-in-picture component
  MediaDevices.ts              getUserMedia, getDisplayMedia, enumerateDevices
ios/RCTWebRTC/                 53 Objective-C files — iOS native module
  WebRTCModule.m               RCTEventEmitter bridge
  WebRTCModule+*.m             Category files (RTCPeerConnection, RTCMediaStream, etc.)
  videoEffects/                FaceDetectionProcessor, VideoEffectProcessor, ProcessorProvider
  I420Converter.{h,m}         Accelerate-based I420->BGRA conversion
android/src/.../WebRTCModule/  35 Java files — Android native module
  WebRTCModule.java            ReactContextBaseJavaModule bridge
  videoEffects/                FaceDetectionProcessor, VideoEffectProcessor, ProcessorProvider
Documentation/                 8 guides (FaceDetection.md, BasicUsage.md, etc.)
examples/                      GumTestApp, GumTestApp_macOS, ExpoTestApp
```

## Architecture
```
JS hooks/classes -> NativeModules.WebRTCModule -> Native Bridge (RCT_EXPORT_METHOD / @ReactMethod)
  -> VideoEffectProcessor pipeline -> FaceDetectionProcessor -> ML Kit -> events back to JS
```
- `MediaStreamTrack.enableFaceDetection()` calls `WebRTCModule.enableFaceDetection(trackId, config)`
- Native configures FaceDetectionProcessor, registered via ProcessorProvider as "faceDetection"
- Detection results emitted as `faceDetected`/`blinkDetected` native events -> NativeEventEmitter -> JS

## Conventions
- TypeScript strict mode, 4-space indent, single quotes, semicolons, max 120 char lines
- ESLint: @typescript-eslint/recommended + import ordering
- iOS: Objective-C categories for WebRTCModule extensions (WebRTCModule+*.m)
- Android: @ReactMethod annotations, ReactBridgeUtil for type conversion
- Feature gating: `configureWebRTC({ enableFaceDetection: true })` must be called before use
- React hooks auto-cleanup on unmount
- Build: react-native-builder-bob -> lib/{commonjs,module,typescript}

## Native Events (16 total — see EventEmitter.ts)
peerConnectionSignalingStateChanged, peerConnectionStateChanged,
peerConnectionOnRenegotiationNeeded, peerConnectionIceConnectionChanged,
peerConnectionIceGatheringChanged, peerConnectionGotICECandidate,
peerConnectionDidOpenDataChannel, peerConnectionOnRemoveTrack,
peerConnectionOnTrack, dataChannelStateChanged, dataChannelReceiveMessage,
dataChannelDidChangeBufferedAmount, mediaStreamTrackMuteChanged,
mediaStreamTrackEnded, faceDetected, blinkDetected

## Dependencies
- WebRTC: JitsiWebRTC ~124.0.0 (iOS), org.jitsi:webrtc:124.+ (Android)
- ML Kit: GoogleMLKit/FaceDetection ~8.0.0 (iOS), com.google.mlkit:face-detection:16.1.6 (Android)
- JS: base64-js 1.5.1, debug 4.3.4, event-target-shim 6.0.2
- Peers: react >=16.8.0, react-native >=0.60.0

## CI (GitHub Actions)
- ci.yml — Lint on PRs (ubuntu, npm install, npm run lint)
- android_ci.yml — Compile GumTestApp Android (ubuntu, Java 17, gradlew assembleDebug)
- ios_ci.yml — Compile GumTestApp iOS (macos, pod install, xcodebuild)
