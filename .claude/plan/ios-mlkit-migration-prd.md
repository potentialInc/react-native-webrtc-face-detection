# PRD: iOS Face Detection Migration to Google ML Kit

## Overview

This document describes the migration of iOS face detection from Apple's Vision framework to Google ML Kit, aligning the iOS implementation with Android for consistent blink detection behavior.

## Problem Statement

### Original Issue
iOS blink detection was unreliable - detecting only ~1 blink when users blinked multiple times, while Android worked correctly.

### Root Cause Analysis

| Aspect | Android (Working) | iOS (Broken) |
|--------|-------------------|--------------|
| Framework | Google ML Kit | Apple Vision |
| Eye Detection | Direct `openProbability` (0.0-1.0) | Manual EAR calculation from landmarks |
| Threshold | Simple: `probability > 0.3` | Complex: `EAR > avgEAR * 0.6` |
| Timing | None - any transition counts | Strict 50-400ms window |
| Calibration | None needed | 30-frame calibration period |

The Vision framework required manual Eye Aspect Ratio (EAR) calculation and had overly strict timing constraints that rejected most valid blinks.

## Solution

Replace Apple Vision with Google ML Kit on iOS to:
1. Use direct eye open probability (matching Android)
2. Remove manual EAR calculation complexity
3. Eliminate timing constraints
4. Remove calibration requirements

## Technical Implementation

### Files Modified

| File | Change |
|------|--------|
| `react-native-webrtc-face-detection.podspec` | Added ML Kit dependency, updated iOS minimum to 15.5 |
| `ios/RCTWebRTC/videoEffects/FaceDetectionProcessor.h` | Changed imports from Vision to MLKitFaceDetection |
| `ios/RCTWebRTC/videoEffects/FaceDetectionProcessor.m` | Complete rewrite using ML Kit APIs |
| `examples/ExpoTestApp/ios/Podfile.properties.json` | Updated iOS deployment target to 15.5 |

### Dependencies Added

```ruby
s.dependency 'GoogleMLKit/FaceDetection', '~> 8.0.0'
```

### iOS Version Requirement

- **Before**: iOS 12.0
- **After**: iOS 15.5 (required by ML Kit 8.0)

### Code Changes Summary

#### Before (Vision Framework)
```objc
// Complex EAR calculation
CGFloat ear = [self calculateEAR:eyeRegion.normalizedPoints count:eyeRegion.pointCount];
CGFloat adaptiveThreshold = eyeState.avgEAR * self.blinkThreshold;
BOOL isOpen = ear > adaptiveThreshold;

// Strict timing check
if (closedDuration > 0.05 && closedDuration < 0.4) {
    eyeState.blinkCount++;
}
```

#### After (ML Kit)
```objc
// Direct probability access
CGFloat openProbability = face.leftEyeOpenProbability;
BOOL isOpen = openProbability > self.blinkThreshold; // 0.3

// Simple transition detection
if (!eyeState.wasOpen && eyeState.isOpen) {
    eyeState.blinkCount++;
}
```

### Configuration

ML Kit FaceDetector initialized with:
```objc
MLKFaceDetectorOptions *options = [[MLKFaceDetectorOptions alloc] init];
options.performanceMode = MLKFaceDetectorPerformanceModeFast;
options.landmarkMode = MLKFaceDetectorLandmarkModeAll;
options.classificationMode = MLKFaceDetectorClassificationModeAll; // Enables eye probability
options.contourMode = MLKFaceDetectorContourModeNone;
options.minFaceSize = 0.15;
options.trackingEnabled = YES;
```

## API Consistency

Both iOS and Android now use identical:

| Property | Type | Default |
|----------|------|---------|
| `blinkThreshold` | Float | 0.3 |
| `frameSkipCount` | Integer | 2 (iOS) / 5 (Android) |
| `captureOnBlink` | Boolean | false |
| `cropToFace` | Boolean | true |
| `imageQuality` | Float | 0.7 |
| `maxImageWidth` | Integer | 480 |

## Events Emitted

### `faceDetected`
```javascript
{
  faces: [{
    bounds: { x, y, width, height },
    confidence: 1.0,
    trackingId: number,
    landmarks: {
      leftEye: { position, isOpen, openProbability, blinkCount },
      rightEye: { position, isOpen, openProbability, blinkCount }
    },
    headPose: { yaw, pitch, roll }
  }],
  timestamp: number,
  frameWidth: number,
  frameHeight: number
}
```

### `blinkDetected`
```javascript
{
  timestamp: number,
  eye: "left" | "right",
  trackingId: number,
  blinkCount: number,
  faceImage?: string,      // Base64 JPEG (if captureOnBlink enabled)
  faceBounds?: { x, y, width, height }
}
```

## Frame Capture Feature

When `captureOnBlink` is enabled:
1. Frame is captured when eye **closes** (not when it reopens)
2. Stored frame is used when blink event fires
3. Ensures captured image shows closed eyes
4. Optional face cropping with 15% padding
5. Configurable JPEG quality and max width

## Testing

1. Run `pod install` in iOS project
2. Build and deploy to device
3. Navigate to Blink Capture tab
4. Enable face detection
5. Blink multiple times
6. Verify each blink is detected
7. Compare blink counts between iOS and Android

## Migration Impact

### Breaking Changes
- iOS minimum version increased from 12.0 to 15.5
- Apps targeting iOS < 15.5 cannot use this version

### Benefits
- Consistent blink detection across platforms
- Simplified codebase (~300 lines removed)
- More reliable eye state detection
- No calibration delay on startup

## References

- [Google ML Kit Face Detection iOS](https://developers.google.com/ml-kit/vision/face-detection/ios)
- [Reference Implementation](https://github.com/luicfrr/react-native-vision-camera-face-detector)
