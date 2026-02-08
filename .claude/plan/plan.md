Blink Frame Capture Feature - Implementation Plan
Overview
Add native frame capture capability to react-native-webrtc-face-detection so that when a blink is detected, the video frame (optionally cropped to face region) is captured and sent to JavaScript as base64 JPEG.

Pre-Implementation Fix Required
Issue Found: iOS sends blinkCount in blink events (line 352), but:

TypeScript BlinkEvent type doesn't declare it
Android doesn't send it (lines 478-482)
This must be fixed first to ensure consistency.

Files to Modify
File	Changes
FaceDetection.types.ts	Add config options + BlinkEvent fields
FaceDetectionProcessor.m	Add frame capture on blink
FaceDetectionProcessor.java	Add frame capture on blink
WebRTCModule.m	Parse new config options
WebRTCModule.java	Parse new config options
Step 1: Update TypeScript Types
File: src/FaceDetection.types.ts

1.1 Add config fields to FaceDetectionConfig (after line 16)

export interface FaceDetectionConfig {
    frameSkipCount?: number;
    blinkThreshold?: number;

    /** Enable capturing video frame when blink is detected. @default false */
    captureOnBlink?: boolean;

    /** Crop captured image to face bounding box. @default true */
    cropToFace?: boolean;

    /** JPEG compression quality (0.0-1.0). @default 0.7 */
    imageQuality?: number;

    /** Max width of captured image in pixels. @default 480 */
    maxImageWidth?: number;
}
1.2 Update BlinkEvent interface (after line 183)

export interface BlinkEvent {
    timestamp: number;
    eye?: 'left' | 'right';
    trackingId?: number;

    /** Total blink count for this eye (already sent by iOS, add to Android) */
    blinkCount?: number;

    /** Base64 encoded JPEG (when captureOnBlink=true) */
    faceImage?: string;

    /** Face bounding box in original frame */
    faceBounds?: BoundingBox;
}
Step 2: iOS Implementation
File: ios/RCTWebRTC/videoEffects/FaceDetectionProcessor.m

2.1 Add instance variables (after line 42)

@property (nonatomic, assign) BOOL captureOnBlink;
@property (nonatomic, assign) BOOL cropToFace;
@property (nonatomic, assign) CGFloat imageQuality;
@property (nonatomic, assign) NSInteger maxImageWidth;
@property (nonatomic, assign) CVPixelBufferRef currentPixelBuffer;
@property (nonatomic, assign) CGSize currentFrameSize;
@property (nonatomic, strong) CIContext *ciContext;  // Cache for performance
2.2 Initialize defaults (in initWithEventEmitter:, after line 58)

_captureOnBlink = NO;
_cropToFace = YES;
_imageQuality = 0.7;
_maxImageWidth = 480;
_ciContext = [CIContext contextWithOptions:nil];
2.3 Store pixel buffer reference (in processFrame:, after line 104)

// Store for capture if enabled
if (_captureOnBlink) {
    _currentPixelBuffer = pixelBuffer;
    _currentFrameSize = CGSizeMake(frame.width, frame.height);
}
2.4 Add frame capture method (new method after line 478)

- (NSString *)captureFrameAsBase64WithFaceBounds:(CGRect)normalizedBounds {
    if (!_currentPixelBuffer) return nil;

    CVPixelBufferLockBaseAddress(_currentPixelBuffer, kCVPixelBufferLock_ReadOnly);
    CIImage *ciImage = [CIImage imageWithCVPixelBuffer:_currentPixelBuffer];
    CVPixelBufferUnlockBaseAddress(_currentPixelBuffer, kCVPixelBufferLock_ReadOnly);

    if (_cropToFace && !CGRectIsEmpty(normalizedBounds)) {
        CGFloat padding = 0.15;
        CGRect cropRect = CGRectMake(
            (normalizedBounds.origin.x - padding) * _currentFrameSize.width,
            ((1.0 - normalizedBounds.origin.y - normalizedBounds.size.height) - padding) * _currentFrameSize.height,
            (normalizedBounds.size.width + padding * 2) * _currentFrameSize.width,
            (normalizedBounds.size.height + padding * 2) * _currentFrameSize.height
        );
        cropRect = CGRectIntersection(cropRect, CGRectMake(0, 0, _currentFrameSize.width, _currentFrameSize.height));
        ciImage = [ciImage imageByCroppingToRect:cropRect];
    }

    // Scale if needed
    CGFloat width = ciImage.extent.size.width;
    if (width > _maxImageWidth) {
        CGFloat scale = _maxImageWidth / width;
        ciImage = [ciImage imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
    }

    CGImageRef cgImage = [_ciContext createCGImage:ciImage fromRect:ciImage.extent];
    UIImage *image = [UIImage imageWithCGImage:cgImage];
    CGImageRelease(cgImage);

    NSData *jpegData = UIImageJPEGRepresentation(image, _imageQuality);
    return [jpegData base64EncodedStringWithOptions:0];
}
2.5 Modify blink event emission (lines 347-354)
Add frame capture before emitting event:


// Inside the valid blink block (after line 344)
NSMutableDictionary *blinkBody = [@{
    @"timestamp": @(now * 1000),
    @"eye": eyeSide,
    @"trackingId": @(trackingId),
    @"blinkCount": @(eyeState.blinkCount)
} mutableCopy];

if (_captureOnBlink) {
    NSString *base64Image = [self captureFrameAsBase64WithFaceBounds:boundingBox];
    if (base64Image) {
        blinkBody[@"faceImage"] = base64Image;
        blinkBody[@"faceBounds"] = @{
            @"x": @(boundingBox.origin.x * _currentFrameSize.width),
            @"y": @((1.0 - boundingBox.origin.y - boundingBox.size.height) * _currentFrameSize.height),
            @"width": @(boundingBox.size.width * _currentFrameSize.width),
            @"height": @(boundingBox.size.height * _currentFrameSize.height)
        };
    }
}

[self.eventEmitter sendEventWithName:@"blinkDetected" body:blinkBody];
2.6 Update WebRTCModule.m config parsing
Add parsing for new config options in enableFaceDetection: method.

Step 3: Android Implementation
File: android/src/main/java/com/oney/WebRTCModule/videoEffects/FaceDetectionProcessor.java

3.1 Add fields (after line 50)

private boolean captureOnBlink = false;
private boolean cropToFace = true;
private float imageQuality = 0.7f;
private int maxImageWidth = 480;
private byte[] lastNv21Data = null;
private int lastFrameWidth = 0;
private int lastFrameHeight = 0;
3.2 Add setters (after line 145)

public void setCaptureOnBlink(boolean capture) { this.captureOnBlink = capture; }
public void setCropToFace(boolean crop) { this.cropToFace = crop; }
public void setImageQuality(float quality) { this.imageQuality = quality; }
public void setMaxImageWidth(int width) { this.maxImageWidth = width; }
3.3 Store NV21 data (in createInputImageFromI420Buffer, after line 376)

// Store for capture if enabled
if (captureOnBlink) {
    lastNv21Data = nv21.clone();
    lastFrameWidth = width;
    lastFrameHeight = height;
}
3.4 Add frame capture method (new method)

private String captureFrameAsBase64(android.graphics.Rect faceBounds) {
    if (lastNv21Data == null) return null;

    try {
        // Convert NV21 to Bitmap via YuvImage
        android.graphics.YuvImage yuvImage = new android.graphics.YuvImage(
            lastNv21Data, android.graphics.ImageFormat.NV21,
            lastFrameWidth, lastFrameHeight, null);

        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        yuvImage.compressToJpeg(new android.graphics.Rect(0, 0, lastFrameWidth, lastFrameHeight), 100, out);
        android.graphics.Bitmap bitmap = android.graphics.BitmapFactory.decodeByteArray(
            out.toByteArray(), 0, out.size());

        // Crop to face if enabled
        if (cropToFace && faceBounds != null) {
            int padding = (int)(faceBounds.width() * 0.15);
            android.graphics.Rect cropRect = new android.graphics.Rect(
                Math.max(0, faceBounds.left - padding),
                Math.max(0, faceBounds.top - padding),
                Math.min(bitmap.getWidth(), faceBounds.right + padding),
                Math.min(bitmap.getHeight(), faceBounds.bottom + padding)
            );
            bitmap = android.graphics.Bitmap.createBitmap(bitmap,
                cropRect.left, cropRect.top, cropRect.width(), cropRect.height());
        }

        // Scale if needed
        if (bitmap.getWidth() > maxImageWidth) {
            float scale = (float)maxImageWidth / bitmap.getWidth();
            int newHeight = (int)(bitmap.getHeight() * scale);
            bitmap = android.graphics.Bitmap.createScaledBitmap(bitmap, maxImageWidth, newHeight, true);
        }

        // Encode to JPEG base64
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, (int)(imageQuality * 100), baos);
        return android.util.Base64.encodeToString(baos.toByteArray(), android.util.Base64.NO_WRAP);
    } catch (Exception e) {
        Log.e(TAG, "Error capturing frame: " + e.getMessage());
        return null;
    }
}
3.5 Modify blink event emission (lines 478-482)
Add blinkCount and frame capture:


if (!eyeState.wasOpen && eyeState.isOpen) {
    eyeState.blinkCount++;

    WritableMap blinkEvent = Arguments.createMap();
    blinkEvent.putDouble("timestamp", System.currentTimeMillis());
    blinkEvent.putString("eye", eyeSide);
    blinkEvent.putInt("trackingId", trackingId);
    blinkEvent.putInt("blinkCount", eyeState.blinkCount);  // ADD THIS

    if (captureOnBlink) {
        android.graphics.Rect faceBounds = ...; // Need to pass from processFaceResults
        String base64Image = captureFrameAsBase64(faceBounds);
        if (base64Image != null) {
            blinkEvent.putString("faceImage", base64Image);
            WritableMap boundsMap = Arguments.createMap();
            boundsMap.putInt("x", faceBounds.left);
            boundsMap.putInt("y", faceBounds.top);
            boundsMap.putInt("width", faceBounds.width());
            boundsMap.putInt("height", faceBounds.height());
            blinkEvent.putMap("faceBounds", boundsMap);
        }
    }

    sendEvent(EVENT_BLINK_DETECTED, blinkEvent);
}
3.6 Refactor to pass face bounds
Modify processEye() signature to include Face face parameter to access bounds.

3.7 Update WebRTCModule.java config parsing
Add parsing for new config options in enableFaceDetection method.

Step 4: Memory & Cleanup
iOS
Clear _currentPixelBuffer after processing completes (in processFrame: after processFaceObservations:)
Android
Clear lastNv21Data in cleanup() method
Recycle Bitmaps after encoding
Step 5: Testing
Test in Example App
Update examples/ExpoTestApp/app/face-detection.tsx:


const { blinkCount, recentBlinks } = useBlinkDetection(videoTrack, {
  captureOnBlink: true,
  cropToFace: true,
  imageQuality: 0.7,
  maxImageWidth: 480,
});

// Display captured image
const lastBlink = recentBlinks[recentBlinks.length - 1];
{lastBlink?.faceImage && (
  <Image source={{ uri: `data:image/jpeg;base64,${lastBlink.faceImage}` }} />
)}
Test Cases
 Blink with captureOnBlink: false → No faceImage in event
 Blink with captureOnBlink: true → faceImage contains base64 JPEG
 cropToFace: true → Image shows face region with padding
 cropToFace: false → Image shows full frame
 imageQuality: 0.3 → Smaller file, lower quality
 maxImageWidth: 200 → Image width ≤ 200px
 iOS and Android produce similar results
Build & Publish

# Build TypeScript
npm run build

# Test iOS
cd examples/ExpoTestApp && npx expo run:ios

# Test Android
npx expo run:android

# Version bump and publish
npm version patch
npm publish
Performance Notes
Opt-in: captureOnBlink defaults to false - no overhead for non-users
Memory: Only store last frame, clear after processing
Image Size: ~20-50KB per image with default settings
Threading: Capture happens on background processing thread
Step 6: Add Test Tab in ExpoTestApp
Files to Create/Modify
File	Action
examples/ExpoTestApp/app/blink-capture.tsx	Create new test screen
examples/ExpoTestApp/app/_layout.tsx	Add new tab entry
6.1 Create Test Screen
File: examples/ExpoTestApp/app/blink-capture.tsx

Features to implement:

Camera preview with RTCView
Configuration controls for capture options:
Toggle captureOnBlink (checkbox/switch)
Toggle cropToFace (checkbox/switch)
Slider for imageQuality (0.1 - 1.0)
Slider for maxImageWidth (100 - 1000)
Display captured blink images as they arrive
Show image gallery of last 5 captured blinks
Display image metadata (size, faceBounds)
Blink counter and statistics
Component Structure:


import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Image, Switch } from 'react-native';
import {
  mediaDevices,
  RTCView,
  MediaStream,
  MediaStreamTrack,
  useBlinkDetection,
  BlinkEvent,
} from 'react-native-webrtc';
import Slider from '@react-native-community/slider';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusIndicator } from '@/components/StatusIndicator';
import { colors, spacing, borderRadius } from '@/constants/theme';

export default function BlinkCaptureScreen() {
  // State
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // Config state
  const [captureOnBlink, setCaptureOnBlink] = useState(true);
  const [cropToFace, setCropToFace] = useState(true);
  const [imageQuality, setImageQuality] = useState(0.7);
  const [maxImageWidth, setMaxImageWidth] = useState(480);

  // Captured images
  const [capturedImages, setCapturedImages] = useState<BlinkEvent[]>([]);

  // Blink detection hook with capture config
  const {
    blinkCount,
    recentBlinks,
    isEnabled,
    enable,
    disable,
    resetCount,
  } = useBlinkDetection(videoTrack, {
    captureOnBlink,
    cropToFace,
    imageQuality,
    maxImageWidth,
  });

  // Track captured images from recent blinks
  useEffect(() => {
    const newCaptures = recentBlinks.filter(b => b.faceImage);
    if (newCaptures.length > 0) {
      setCapturedImages(prev => [...newCaptures.slice(-5)]);
    }
  }, [recentBlinks]);

  // Camera start/stop functions (same pattern as face-detection.tsx)
  // ...

  return (
    <ScrollView>
      {/* Video Preview Card */}
      {/* Config Controls Card */}
      {/* Captured Images Gallery */}
      {/* Blink Statistics */}
    </ScrollView>
  );
}
6.2 Update Layout
File: examples/ExpoTestApp/app/_layout.tsx

Add icon mapping:


function TabBarIcon({ name, color }: { name: string; color: string }) {
  const icons: Record<string, string> = {
    camera: '📹',
    connection: '🔗',
    face: '👤',
    videocall: '📞',
    capture: '📸',  // Add this
  };
  return <Text style={{ fontSize: 24 }}>{icons[name] || '●'}</Text>;
}
Add new tab entry (after video-call):


<Tabs.Screen
  name="blink-capture"
  options={{
    title: 'Capture',
    headerTitle: 'Blink Capture',
    tabBarIcon: ({ color }) => <TabBarIcon name="capture" color={color} />,
  }}
/>
6.3 Test Cases
Test	Expected Result
Enable capture, blink	Image appears in gallery
Toggle cropToFace off	Full frame captured
Reduce imageQuality	Smaller image size
Reduce maxImageWidth	Narrower images
Multiple blinks	Gallery shows last 5
Disable capture	No new images on blink
6.4 Dependencies
Check if @react-native-community/slider is installed:


cd examples/ExpoTestApp
npm list @react-native-community/slider
# If not installed:
npm install @react-native-community/slider
Step 7: Fix Frame Capture Timing (CRITICAL BUG FIX)
Problem
Captured images show eyes OPEN instead of CLOSED because:

Blink is detected when eye reopens (closed→open transition)
At that moment, current frame shows eyes already open
We're capturing the wrong frame
Solution
Store the frame when eye closes (open→closed transition), then use that stored frame when blink is confirmed on reopen.

7.1 iOS Fix
File: ios/RCTWebRTC/videoEffects/FaceDetectionProcessor.m

Add storage for closed-eye frame (in interface, after currentPixelBuffer)

@property (nonatomic, assign) CVPixelBufferRef closedEyePixelBuffer;
@property (nonatomic, assign) CGSize closedEyeFrameSize;
@property (nonatomic, assign) CGRect closedEyeFaceBounds;
Initialize in initWithEventEmitter (after _currentPixelBuffer = NULL)

_closedEyePixelBuffer = NULL;
Modify eye state tracking to capture on CLOSE transition
Find where wasOpen=true && isOpen=false is detected (around line 355-358, the transition tracking):


// Track open/closed times
if (currentlyOpen && !eyeState.wasOpen) {
    eyeState.lastOpenTime = now;
} else if (!currentlyOpen && eyeState.wasOpen) {
    eyeState.lastClosedTime = now;

    // CAPTURE FRAME WHEN EYE CLOSES (not when it reopens)
    if (_captureOnBlink && _currentPixelBuffer) {
        // Retain the pixel buffer for later use
        if (_closedEyePixelBuffer) {
            CVPixelBufferRelease(_closedEyePixelBuffer);
        }
        CVPixelBufferRetain(_currentPixelBuffer);
        _closedEyePixelBuffer = _currentPixelBuffer;
        _closedEyeFrameSize = _currentFrameSize;
        _closedEyeFaceBounds = boundingBox;
    }
}
Modify blink event to use stored closed-eye frame
Change the frame capture in blink detection block to use stored frame:


// Inside blink detection block (when !eyeState.wasOpen && eyeState.isOpen)
if (_captureOnBlink && _closedEyePixelBuffer) {
    // Use the stored closed-eye frame, not current frame
    CVPixelBufferRef savedBuffer = _currentPixelBuffer;
    CGSize savedSize = _currentFrameSize;

    _currentPixelBuffer = _closedEyePixelBuffer;
    _currentFrameSize = _closedEyeFrameSize;

    NSString *base64Image = [self captureFrameAsBase64WithFaceBounds:_closedEyeFaceBounds];

    // Restore
    _currentPixelBuffer = savedBuffer;
    _currentFrameSize = savedSize;

    // Clear stored buffer
    CVPixelBufferRelease(_closedEyePixelBuffer);
    _closedEyePixelBuffer = NULL;

    if (base64Image) {
        blinkBody[@"faceImage"] = base64Image;
        blinkBody[@"faceBounds"] = @{
            @"x": @(_closedEyeFaceBounds.origin.x * _closedEyeFrameSize.width),
            @"y": @((1.0 - _closedEyeFaceBounds.origin.y - _closedEyeFaceBounds.size.height) * _closedEyeFrameSize.height),
            @"width": @(_closedEyeFaceBounds.size.width * _closedEyeFrameSize.width),
            @"height": @(_closedEyeFaceBounds.size.height * _closedEyeFrameSize.height)
        };
    }
}
7.2 Android Fix
File: android/.../FaceDetectionProcessor.java

Add storage fields for closed-eye frame (after lastNv21Data fields)

// Closed-eye frame storage
private byte[] closedEyeNv21Data = null;
private int closedEyeFrameWidth = 0;
private int closedEyeFrameHeight = 0;
private Rect closedEyeFaceBounds = null;
Modify processEye to capture on CLOSE transition
Add capture logic when eye closes (before the reopen detection):


eyeState.currentProbability = openProbability;
eyeState.wasOpen = eyeState.isOpen;
eyeState.isOpen = openProbability > blinkThreshold;

// CAPTURE FRAME WHEN EYE CLOSES (transition: open → closed)
if (eyeState.wasOpen && !eyeState.isOpen) {
    if (captureOnBlink && lastNv21Data != null && faceBounds != null) {
        closedEyeNv21Data = lastNv21Data.clone();
        closedEyeFrameWidth = lastFrameWidth;
        closedEyeFrameHeight = lastFrameHeight;
        closedEyeFaceBounds = new Rect(faceBounds);
    }
}

// DETECT BLINK (transition: closed → open)
if (!eyeState.wasOpen && eyeState.isOpen) {
    eyeState.blinkCount++;

    WritableMap blinkEvent = Arguments.createMap();
    // ... timestamp, eye, trackingId, blinkCount ...

    // Use STORED closed-eye frame instead of current frame
    if (captureOnBlink && closedEyeNv21Data != null && closedEyeFaceBounds != null) {
        // Temporarily swap to closed-eye data
        byte[] savedNv21 = lastNv21Data;
        int savedWidth = lastFrameWidth;
        int savedHeight = lastFrameHeight;

        lastNv21Data = closedEyeNv21Data;
        lastFrameWidth = closedEyeFrameWidth;
        lastFrameHeight = closedEyeFrameHeight;

        String base64Image = captureFrameAsBase64(closedEyeFaceBounds);

        // Restore
        lastNv21Data = savedNv21;
        lastFrameWidth = savedWidth;
        lastFrameHeight = savedHeight;

        // Clear stored closed-eye data
        closedEyeNv21Data = null;
        closedEyeFaceBounds = null;

        if (base64Image != null) {
            blinkEvent.putString("faceImage", base64Image);
            WritableMap boundsMap = Arguments.createMap();
            boundsMap.putInt("x", closedEyeFaceBounds.left);
            boundsMap.putInt("y", closedEyeFaceBounds.top);
            boundsMap.putInt("width", closedEyeFaceBounds.width());
            boundsMap.putInt("height", closedEyeFaceBounds.height());
            blinkEvent.putMap("faceBounds", boundsMap);
        }
    }

    sendEvent(EVENT_BLINK_DETECTED, blinkEvent);
}
Add cleanup for closed-eye data

// In cleanup() method:
closedEyeNv21Data = null;
closedEyeFaceBounds = null;
7.3 Summary of Changes
Platform	What Changes	Why
iOS	Store _closedEyePixelBuffer on open→closed transition	Capture frame when eyes are closed
iOS	Use stored buffer in blink event	Send closed-eye frame, not current
Android	Store closedEyeNv21Data on open→closed transition	Capture frame when eyes are closed
Android	Use stored data in blink event	Send closed-eye frame, not current
7.4 Expected Result
Before Fix	After Fix
Eyes open in captured image	Eyes closed in captured image
Capturing at reopen moment	Capturing at close moment
Wrong timing	Correct timing
User approved the plan