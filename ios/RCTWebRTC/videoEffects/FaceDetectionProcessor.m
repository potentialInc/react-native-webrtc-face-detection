#import "FaceDetectionProcessor.h"
#import "I420Converter.h"
#import <React/RCTEventEmitter.h>
#import <WebRTC/RTCVideoFrame.h>
#import <WebRTC/RTCVideoFrameBuffer.h>
#import <WebRTC/RTCCVPixelBuffer.h>
#import <CoreVideo/CoreVideo.h>
@import MLKitVision;

// Simple eye state tracking (matching Android)
@interface EyeState : NSObject
@property (nonatomic, assign) BOOL isOpen;
@property (nonatomic, assign) BOOL wasOpen;
@property (nonatomic, assign) NSInteger blinkCount;
@property (nonatomic, assign) CGFloat currentProbability;
@end

@implementation EyeState
- (instancetype)init {
    self = [super init];
    if (self) {
        _isOpen = YES;
        _wasOpen = YES;
        _blinkCount = 0;
        _currentProbability = 1.0;
    }
    return self;
}
@end

@interface FaceDetectionProcessor()
@property (nonatomic, strong) MLKFaceDetector *faceDetector;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, EyeState *> *leftEyeStates;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, EyeState *> *rightEyeStates;
@property (nonatomic, assign) NSInteger frameCounter;
@property (nonatomic, strong) dispatch_queue_t processingQueue;
@property (nonatomic, assign) BOOL isProcessing;
// Frame capture properties
@property (nonatomic, assign) CVPixelBufferRef currentPixelBuffer;
@property (nonatomic, assign) CGSize currentFrameSize;
@property (nonatomic, strong) CIContext *ciContext;
// Closed-eye frame storage
@property (nonatomic, assign) CVPixelBufferRef closedEyePixelBuffer;
@property (nonatomic, assign) CGSize closedEyeFrameSize;
@property (nonatomic, assign) CGRect closedEyeFaceBounds;
// Frame rotation tracking
@property (nonatomic, assign) RTCVideoRotation currentFrameRotation;
@property (nonatomic, assign) RTCVideoRotation closedEyeFrameRotation;
// I420 to BGRA conversion
@property (nonatomic, strong) I420Converter *i420Converter;
@end

@implementation FaceDetectionProcessor

- (instancetype)initWithEventEmitter:(RCTEventEmitter *)eventEmitter {
    self = [super init];
    if (self) {
        _eventEmitter = eventEmitter;
        _isEnabled = NO;
        _frameSkipCount = 2;
        _blinkThreshold = 0.3; // Same as Android (probability-based)
        _leftEyeStates = [NSMutableDictionary dictionary];
        _rightEyeStates = [NSMutableDictionary dictionary];
        _frameCounter = 0;
        _isProcessing = NO;
        _processingQueue = dispatch_queue_create("com.webrtc.facedetection", DISPATCH_QUEUE_SERIAL);
        // Frame capture defaults
        _captureOnBlink = NO;
        _cropToFace = YES;
        _imageQuality = 0.7;
        _maxImageWidth = 480;
        _currentPixelBuffer = NULL;
        _ciContext = [CIContext contextWithOptions:nil];
        _closedEyePixelBuffer = NULL;
        _closedEyeFrameSize = CGSizeZero;
        _closedEyeFaceBounds = CGRectZero;
        _currentFrameRotation = RTCVideoRotation_0;
        _closedEyeFrameRotation = RTCVideoRotation_0;

        [self initializeFaceDetector];
    }
    return self;
}

- (void)initializeFaceDetector {
    MLKFaceDetectorOptions *options = [[MLKFaceDetectorOptions alloc] init];
    options.performanceMode = MLKFaceDetectorPerformanceModeFast;
    options.landmarkMode = MLKFaceDetectorLandmarkModeAll;
    options.classificationMode = MLKFaceDetectorClassificationModeAll; // KEY: enables eye probability
    options.contourMode = MLKFaceDetectorContourModeNone;
    options.minFaceSize = 0.15;
    options.trackingEnabled = YES;

    self.faceDetector = [MLKFaceDetector faceDetectorWithOptions:options];
    NSLog(@"[FaceDetection] ML Kit FaceDetector initialized");
}

- (void)reset {
    @synchronized (self) {
        [_leftEyeStates removeAllObjects];
        [_rightEyeStates removeAllObjects];
        _frameCounter = 0;
        _isProcessing = NO;
        if (_currentPixelBuffer) {
            CVPixelBufferRelease(_currentPixelBuffer);
            _currentPixelBuffer = NULL;
        }
        if (_closedEyePixelBuffer) {
            CVPixelBufferRelease(_closedEyePixelBuffer);
            _closedEyePixelBuffer = NULL;
        }
        _closedEyeFrameSize = CGSizeZero;
        _closedEyeFaceBounds = CGRectZero;
        _currentFrameRotation = RTCVideoRotation_0;
        _closedEyeFrameRotation = RTCVideoRotation_0;
    }
}

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame {
    if (!self.isEnabled) {
        return frame;
    }

    @synchronized (self) {
        _frameCounter++;

        if (_frameCounter % _frameSkipCount != 0) {
            return frame;
        }

        if (_isProcessing) {
            return frame;
        }
        _isProcessing = YES;
    }

    // Get pixel buffer BEFORE async dispatch (while frame is still valid)
    // Note: pixelBufferFromFrame returns a RETAINED buffer that we must release
    CVPixelBufferRef pixelBuffer = [self pixelBufferFromFrame:frame];
    if (!pixelBuffer) {
        @synchronized (self) {
            _isProcessing = NO;
        }
        return frame;
    }

    // Capture frame metadata before async dispatch (buffer already retained)
    int32_t frameWidth = frame.width;
    int32_t frameHeight = frame.height;
    int64_t timestamp = frame.timeStampNs;
    RTCVideoRotation frameRotation = frame.rotation;

    dispatch_async(_processingQueue, ^{
        [self processFrameWithPixelBuffer:pixelBuffer
                                    width:frameWidth
                                   height:frameHeight
                                 rotation:frameRotation
                                timestamp:timestamp];
        CVPixelBufferRelease(pixelBuffer);
    });

    return frame;
}

- (void)processFrameWithPixelBuffer:(CVPixelBufferRef)pixelBuffer
                              width:(int32_t)frameWidth
                             height:(int32_t)frameHeight
                           rotation:(RTCVideoRotation)frameRotation
                          timestamp:(int64_t)timestamp {
    @autoreleasepool {
        // Validate pixel buffer has actual image data
        CVReturn lockResult = CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
        if (lockResult != kCVReturnSuccess) {
            NSLog(@"[FaceDetection] Failed to lock pixel buffer: %d", lockResult);
            @synchronized (self) {
                _isProcessing = NO;
            }
            return;
        }

        void *baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer);
        size_t dataSize = CVPixelBufferGetDataSize(pixelBuffer);
        CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);

        if (!baseAddress || dataSize == 0) {
            NSLog(@"[FaceDetection] Pixel buffer has no image data");
            @synchronized (self) {
                _isProcessing = NO;
            }
            return;
        }

        // Store for frame capture
        if (_captureOnBlink) {
            if (_currentPixelBuffer) {
                CVPixelBufferRelease(_currentPixelBuffer);
            }
            CVPixelBufferRetain(pixelBuffer);
            _currentPixelBuffer = pixelBuffer;
            _currentFrameSize = CGSizeMake(frameWidth, frameHeight);
            _currentFrameRotation = frameRotation;
        }

        // Ensure face detector is initialized
        if (!self.faceDetector) {
            if (_captureOnBlink && _currentPixelBuffer) {
                CVPixelBufferRelease(_currentPixelBuffer);
                _currentPixelBuffer = NULL;
            }
            @synchronized (self) {
                _isProcessing = NO;
            }
            return;
        }

        // Convert CVPixelBuffer to UIImage for ML Kit
        // Note: ML Kit's initWithBuffer: expects CMSampleBufferRef, not CVPixelBufferRef
        UIImage *uiImage = [self uiImageFromPixelBuffer:pixelBuffer];
        if (!uiImage) {
            NSLog(@"[FaceDetection] Failed to create UIImage from pixel buffer");
            if (_captureOnBlink && _currentPixelBuffer) {
                CVPixelBufferRelease(_currentPixelBuffer);
                _currentPixelBuffer = NULL;
            }
            @synchronized (self) {
                _isProcessing = NO;
            }
            return;
        }

        // Wrap ML Kit in @try/@catch to handle exceptions gracefully
        @try {
            // Create ML Kit vision image from UIImage
            MLKVisionImage *visionImage = [[MLKVisionImage alloc] initWithImage:uiImage];
            // Map WebRTC frame rotation to UIImageOrientation for ML Kit
            UIImageOrientation mlKitOrientation;
            switch (frameRotation) {
                case RTCVideoRotation_90:
                    mlKitOrientation = UIImageOrientationRight;
                    break;
                case RTCVideoRotation_180:
                    mlKitOrientation = UIImageOrientationDown;
                    break;
                case RTCVideoRotation_270:
                    mlKitOrientation = UIImageOrientationLeft;
                    break;
                case RTCVideoRotation_0:
                default:
                    mlKitOrientation = UIImageOrientationUp;
                    break;
            }
            visionImage.orientation = mlKitOrientation;

            NSError *error = nil;
            NSArray<MLKFace *> *faces = [self.faceDetector resultsInImage:visionImage error:&error];

            if (error) {
                NSLog(@"[FaceDetection] ML Kit error: %@", error);
            } else {
                [self processFaceResults:faces
                              frameWidth:frameWidth
                             frameHeight:frameHeight
                               timestamp:timestamp / 1000000];
            }
        } @catch (NSException *exception) {
            NSLog(@"[FaceDetection] ML Kit exception: %@ - %@", exception.name, exception.reason);
        }

        if (_captureOnBlink && _currentPixelBuffer) {
            CVPixelBufferRelease(_currentPixelBuffer);
            _currentPixelBuffer = NULL;
        }

        @synchronized (self) {
            _isProcessing = NO;
        }
    }
}

/**
 * Returns a CVPixelBuffer from the frame. Handles both RTCCVPixelBuffer and I420 formats.
 * IMPORTANT: The returned buffer is RETAINED - caller must release when done.
 */
- (CVPixelBufferRef)pixelBufferFromFrame:(RTCVideoFrame *)frame {
    id<RTCVideoFrameBuffer> buffer = frame.buffer;

    // Check if buffer is already a CVPixelBuffer (most efficient path)
    if ([buffer isKindOfClass:[RTCCVPixelBuffer class]]) {
        CVPixelBufferRef pixelBuffer = [(RTCCVPixelBuffer *)buffer pixelBuffer];
        CVPixelBufferRetain(pixelBuffer);  // Retain for caller
        return pixelBuffer;
    }

    // Convert I420 buffer to CVPixelBuffer using Accelerate framework
    // Note: pixelBufferFromI420 returns an already-retained buffer
    return [self pixelBufferFromI420:[buffer toI420]];
}

/**
 * Converts an I420 buffer to a BGRA CVPixelBuffer for ML Kit compatibility.
 * Returns a retained buffer that must be released by the caller.
 */
- (CVPixelBufferRef)pixelBufferFromI420:(RTCI420Buffer *)i420Buffer {
    if (!i420Buffer) {
        return NULL;
    }

    if (_i420Converter == nil) {
        I420Converter *converter = [[I420Converter alloc] init];
        vImage_Error err = [converter prepareForAccelerateConversion];

        if (err != kvImageNoError) {
            NSLog(@"[FaceDetection] Error preparing I420Converter: %ld", err);
            return NULL;
        }

        _i420Converter = converter;
    }

    return [_i420Converter convertI420ToPixelBuffer:i420Buffer];
}

/**
 * Converts a CVPixelBuffer to UIImage for ML Kit processing.
 * ML Kit's initWithBuffer: expects CMSampleBufferRef, not CVPixelBufferRef,
 * so we convert to UIImage and use initWithImage: instead.
 */
- (UIImage *)uiImageFromPixelBuffer:(CVPixelBufferRef)pixelBuffer {
    CIImage *ciImage = [CIImage imageWithCVPixelBuffer:pixelBuffer];
    if (!ciImage) {
        return nil;
    }

    CGImageRef cgImage = [_ciContext createCGImage:ciImage fromRect:ciImage.extent];
    if (!cgImage) {
        return nil;
    }

    UIImage *uiImage = [UIImage imageWithCGImage:cgImage];
    CGImageRelease(cgImage);

    return uiImage;
}

- (void)processFaceResults:(NSArray<MLKFace *> *)faces
                frameWidth:(int)frameWidth
               frameHeight:(int)frameHeight
                 timestamp:(int64_t)timestamp {

    NSMutableArray *facesArray = [NSMutableArray array];

    for (NSInteger i = 0; i < faces.count; i++) {
        MLKFace *face = faces[i];

        NSInteger trackingId = face.hasTrackingID ? face.trackingID : i;
        NSNumber *trackingKey = @(trackingId);

        // Get or create eye states
        EyeState *leftEyeState = self.leftEyeStates[trackingKey];
        if (!leftEyeState) {
            leftEyeState = [[EyeState alloc] init];
            self.leftEyeStates[trackingKey] = leftEyeState;
        }

        EyeState *rightEyeState = self.rightEyeStates[trackingKey];
        if (!rightEyeState) {
            rightEyeState = [[EyeState alloc] init];
            self.rightEyeStates[trackingKey] = rightEyeState;
        }

        // Bounding box
        CGRect boundingBox = face.frame;
        NSDictionary *bounds = @{
            @"x": @(boundingBox.origin.x),
            @"y": @(boundingBox.origin.y),
            @"width": @(boundingBox.size.width),
            @"height": @(boundingBox.size.height)
        };

        // Normalized bounds for frame capture (0-1 range)
        CGRect normalizedBounds = CGRectMake(
            boundingBox.origin.x / frameWidth,
            boundingBox.origin.y / frameHeight,
            boundingBox.size.width / frameWidth,
            boundingBox.size.height / frameHeight
        );

        // Process eyes with direct probability from ML Kit
        NSDictionary *leftEyeData = [self processEye:face.leftEyeOpenProbability
                                            eyeState:leftEyeState
                                             eyeSide:@"left"
                                          trackingId:trackingId
                                    normalizedBounds:normalizedBounds
                                              bounds:bounds
                                                face:face
                                        landmarkType:MLKFaceLandmarkTypeLeftEye];

        NSDictionary *rightEyeData = [self processEye:face.rightEyeOpenProbability
                                             eyeState:rightEyeState
                                              eyeSide:@"right"
                                           trackingId:trackingId
                                     normalizedBounds:normalizedBounds
                                               bounds:bounds
                                                 face:face
                                         landmarkType:MLKFaceLandmarkTypeRightEye];

        // Extract mouth landmarks
        NSMutableDictionary *landmarksDict = [NSMutableDictionary dictionary];
        landmarksDict[@"leftEye"] = leftEyeData;
        landmarksDict[@"rightEye"] = rightEyeData;

        MLKFaceLandmark *mouthBottom = [face landmarkOfType:MLKFaceLandmarkTypeMouthBottom];
        MLKFaceLandmark *mouthLeft = [face landmarkOfType:MLKFaceLandmarkTypeMouthLeft];
        MLKFaceLandmark *mouthRight = [face landmarkOfType:MLKFaceLandmarkTypeMouthRight];
        if (mouthBottom && mouthLeft && mouthRight) {
            CGFloat centerX = (mouthLeft.position.x + mouthRight.position.x) / 2.0;
            CGFloat centerY = mouthBottom.position.y;
            CGFloat mouthWidth = fabs(mouthRight.position.x - mouthLeft.position.x);
            CGFloat mouthHeight = mouthWidth * 0.5;
            landmarksDict[@"mouth"] = @{
                @"position": @{@"x": @(centerX), @"y": @(centerY)},
                @"width": @(mouthWidth),
                @"height": @(mouthHeight)
            };
        }

        // Extract nose landmark
        MLKFaceLandmark *noseBase = [face landmarkOfType:MLKFaceLandmarkTypeNoseBase];
        if (noseBase) {
            landmarksDict[@"nose"] = @{
                @"position": @{@"x": @(noseBase.position.x), @"y": @(noseBase.position.y)}
            };
        }

        NSDictionary *landmarks = [landmarksDict copy];

        // Build face object
        NSMutableDictionary *faceDict = [@{
            @"bounds": bounds,
            @"confidence": @1.0,
            @"trackingId": @(trackingId)
        } mutableCopy];

        faceDict[@"landmarks"] = landmarks;

        // Head pose
        faceDict[@"headPose"] = @{
            @"yaw": @(face.headEulerAngleY),
            @"pitch": @(face.headEulerAngleX),
            @"roll": @(face.headEulerAngleZ)
        };

        [facesArray addObject:faceDict];
    }

    // Emit face detected event
    NSDictionary *result = @{
        @"faces": facesArray,
        @"timestamp": @(timestamp),
        @"frameWidth": @(frameWidth),
        @"frameHeight": @(frameHeight)
    };

    if (self.eventEmitter) {
        [self.eventEmitter sendEventWithName:@"faceDetected" body:result];
    }
}

- (NSDictionary *)processEye:(CGFloat)openProbability
                    eyeState:(EyeState *)eyeState
                     eyeSide:(NSString *)eyeSide
                  trackingId:(NSInteger)trackingId
            normalizedBounds:(CGRect)normalizedBounds
                      bounds:(NSDictionary *)bounds
                        face:(MLKFace *)face
                landmarkType:(MLKFaceLandmarkType)landmarkType {

    // Extract eye landmark position from ML Kit
    CGFloat eyeX = 0;
    CGFloat eyeY = 0;
    MLKFaceLandmark *eyeLandmark = [face landmarkOfType:landmarkType];
    if (eyeLandmark && eyeLandmark.position) {
        eyeX = eyeLandmark.position.x;
        eyeY = eyeLandmark.position.y;
    }

    // Handle missing probability (returns negative value when unavailable)
    if (openProbability < 0) {
        return @{
            @"position": @{@"x": @(eyeX), @"y": @(eyeY)},
            @"isOpen": @(eyeState.isOpen),
            @"openProbability": @(eyeState.currentProbability),
            @"blinkCount": @(eyeState.blinkCount)
        };
    }

    eyeState.currentProbability = openProbability;
    eyeState.wasOpen = eyeState.isOpen;
    eyeState.isOpen = openProbability > self.blinkThreshold;

    // Debug logging
    static NSInteger debugCounter = 0;
    debugCounter++;
    if (debugCounter % 30 == 0) {
        NSLog(@"[FaceDetection] %@ eye - probability: %.4f, threshold: %.4f, isOpen: %@",
              eyeSide, openProbability, self.blinkThreshold, eyeState.isOpen ? @"YES" : @"NO");
    }

    // CAPTURE FRAME WHEN EYE CLOSES (open → closed transition)
    if (eyeState.wasOpen && !eyeState.isOpen) {
        if (_captureOnBlink && _currentPixelBuffer) {
            if (_closedEyePixelBuffer) {
                CVPixelBufferRelease(_closedEyePixelBuffer);
            }
            CVPixelBufferRetain(_currentPixelBuffer);
            _closedEyePixelBuffer = _currentPixelBuffer;
            _closedEyeFrameSize = _currentFrameSize;
            _closedEyeFaceBounds = normalizedBounds;
            _closedEyeFrameRotation = _currentFrameRotation;
        }
    }

    // DETECT BLINK (closed → open transition) - matching Android behavior
    if (!eyeState.wasOpen && eyeState.isOpen) {
        eyeState.blinkCount++;
        NSLog(@"[FaceDetection] Blink detected on %@ eye! Count: %ld, probability: %.3f",
              eyeSide, (long)eyeState.blinkCount, openProbability);

        if (self.eventEmitter) {
            NSMutableDictionary *blinkBody = [@{
                @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000),
                @"eye": eyeSide,
                @"trackingId": @(trackingId),
                @"blinkCount": @(eyeState.blinkCount)
            } mutableCopy];

            // Use stored closed-eye frame
            if (_captureOnBlink && _closedEyePixelBuffer) {
                NSString *base64Image = [self captureFrameAsBase64FromBuffer:_closedEyePixelBuffer
                                                                       size:_closedEyeFrameSize
                                                                 faceBounds:_closedEyeFaceBounds
                                                                   rotation:_closedEyeFrameRotation];

                if (base64Image) {
                    blinkBody[@"faceImage"] = base64Image;
                    blinkBody[@"faceBounds"] = @{
                        @"x": @(_closedEyeFaceBounds.origin.x * _closedEyeFrameSize.width),
                        @"y": @(_closedEyeFaceBounds.origin.y * _closedEyeFrameSize.height),
                        @"width": @(_closedEyeFaceBounds.size.width * _closedEyeFrameSize.width),
                        @"height": @(_closedEyeFaceBounds.size.height * _closedEyeFrameSize.height)
                    };
                }

                CVPixelBufferRelease(_closedEyePixelBuffer);
                _closedEyePixelBuffer = NULL;
            }

            [self.eventEmitter sendEventWithName:@"blinkDetected" body:blinkBody];
        }
    }

    return @{
        @"position": @{@"x": @(eyeX), @"y": @(eyeY)},
        @"isOpen": @(eyeState.isOpen),
        @"openProbability": @(openProbability),
        @"blinkCount": @(eyeState.blinkCount)
    };
}

#pragma mark - Frame Capture

- (NSString *)captureFrameAsBase64WithFaceBounds:(CGRect)normalizedBounds {
    return [self captureFrameAsBase64FromBuffer:_currentPixelBuffer
                                           size:_currentFrameSize
                                    faceBounds:normalizedBounds
                                      rotation:_currentFrameRotation];
}

- (NSString *)captureFrameAsBase64FromBuffer:(CVPixelBufferRef)pixelBuffer
                                        size:(CGSize)frameSize
                                  faceBounds:(CGRect)normalizedBounds
                                    rotation:(RTCVideoRotation)rotation {
    if (!pixelBuffer) return nil;

    // Lock buffer for ENTIRE conversion process (CIImage is lazy - reads data on createCGImage)
    CVReturn lockResult = CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
    if (lockResult != kCVReturnSuccess) {
        NSLog(@"[FaceDetection] Failed to lock pixel buffer for capture");
        return nil;
    }

    CIImage *ciImage = [CIImage imageWithCVPixelBuffer:pixelBuffer];
    if (!ciImage) {
        CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
        return nil;
    }

    // Crop to face if enabled
    if (_cropToFace && !CGRectIsEmpty(normalizedBounds)) {
        CGFloat padding = 0.15;

        CGRect cropRect = CGRectMake(
            (normalizedBounds.origin.x - padding) * frameSize.width,
            (normalizedBounds.origin.y - padding) * frameSize.height,
            (normalizedBounds.size.width + padding * 2) * frameSize.width,
            (normalizedBounds.size.height + padding * 2) * frameSize.height
        );

        cropRect = CGRectIntersection(cropRect, ciImage.extent);

        if (!CGRectIsEmpty(cropRect) && cropRect.size.width > 0 && cropRect.size.height > 0) {
            ciImage = [ciImage imageByCroppingToRect:cropRect];
            ciImage = [ciImage imageByApplyingTransform:CGAffineTransformMakeTranslation(-cropRect.origin.x, -cropRect.origin.y)];
        }
    }

    // Scale down if too large
    CGFloat currentWidth = ciImage.extent.size.width;
    if (currentWidth > _maxImageWidth) {
        CGFloat scale = _maxImageWidth / currentWidth;
        ciImage = [ciImage imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
    }

    // Render CIImage to CGImage (this is when pixel data is actually read)
    CGImageRef cgImage = [_ciContext createCGImage:ciImage fromRect:ciImage.extent];

    // Unlock AFTER rendering is complete
    CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);

    if (!cgImage) return nil;

    // Map WebRTC frame rotation to UIImageOrientation for correct JPEG encoding
    UIImageOrientation imageOrientation;
    switch (rotation) {
        case RTCVideoRotation_90:
            imageOrientation = UIImageOrientationRight;
            break;
        case RTCVideoRotation_180:
            imageOrientation = UIImageOrientationDown;
            break;
        case RTCVideoRotation_270:
            imageOrientation = UIImageOrientationLeft;
            break;
        case RTCVideoRotation_0:
        default:
            imageOrientation = UIImageOrientationUp;
            break;
    }
    UIImage *image = [UIImage imageWithCGImage:cgImage scale:1.0 orientation:imageOrientation];
    CGImageRelease(cgImage);

    NSData *jpegData = UIImageJPEGRepresentation(image, _imageQuality);
    if (!jpegData) return nil;

    return [jpegData base64EncodedStringWithOptions:0];
}

- (void)dealloc {
    if (_currentPixelBuffer) {
        CVPixelBufferRelease(_currentPixelBuffer);
        _currentPixelBuffer = NULL;
    }
    if (_closedEyePixelBuffer) {
        CVPixelBufferRelease(_closedEyePixelBuffer);
        _closedEyePixelBuffer = NULL;
    }
    if (_i420Converter) {
        [_i420Converter unprepareForAccelerateConversion];
        _i420Converter = nil;
    }
}

@end
