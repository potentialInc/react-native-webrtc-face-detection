#import <Foundation/Foundation.h>
#import <WebRTC/RTCVideoCapturer.h>
#import "VideoFrameProcessor.h"

@interface ImageAdjustmentProcessor : NSObject<VideoFrameProcessorDelegate>

@property (nonatomic, assign) BOOL isEnabled;
@property (nonatomic, assign) CGFloat exposure;        // -1.0 to 1.0, default 0.0
@property (nonatomic, assign) CGFloat contrast;        // 0.0 to 3.0, default 1.0
@property (nonatomic, assign) CGFloat saturation;      // 0.0 to 3.0, default 1.0
@property (nonatomic, assign) CGFloat colorTemperature; // -1.0 to 1.0, default 0.0

- (void)updateConfig:(NSDictionary *)config;
- (void)reset;

@end
