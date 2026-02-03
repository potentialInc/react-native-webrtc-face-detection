#import <Foundation/Foundation.h>
#import <WebRTC/RTCVideoCapturer.h>
#import <Vision/Vision.h>
#import "VideoFrameProcessor.h"

@class RCTEventEmitter;

@interface FaceDetectionProcessor : NSObject<VideoFrameProcessorDelegate>

@property (nonatomic, weak) RCTEventEmitter *eventEmitter;
@property (nonatomic, assign) BOOL isEnabled;
@property (nonatomic, assign) NSInteger frameSkipCount; // Process every Nth frame
@property (nonatomic, assign) CGFloat blinkThreshold; // EAR threshold for blink detection

// Frame capture configuration
@property (nonatomic, assign) BOOL captureOnBlink;    // Enable frame capture on blink
@property (nonatomic, assign) BOOL cropToFace;        // Crop to face region
@property (nonatomic, assign) CGFloat imageQuality;   // JPEG quality (0.0-1.0)
@property (nonatomic, assign) NSInteger maxImageWidth; // Max image width in pixels

- (instancetype)initWithEventEmitter:(RCTEventEmitter *)eventEmitter;
- (void)reset;

@end

