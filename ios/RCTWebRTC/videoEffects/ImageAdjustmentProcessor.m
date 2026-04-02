#import "ImageAdjustmentProcessor.h"
#import <WebRTC/RTCVideoFrame.h>
#import <WebRTC/RTCVideoFrameBuffer.h>
#import <WebRTC/RTCNativeI420Buffer.h>
#import <WebRTC/RTCYUVPlanarBuffer.h>

@interface ImageAdjustmentProcessor () {
    uint8_t _yLUT[256];
    uint8_t _uLUT[256];
    uint8_t _vLUT[256];
    BOOL _isDefaultConfig;
}
@end

@implementation ImageAdjustmentProcessor

- (instancetype)init {
    self = [super init];
    if (self) {
        _isEnabled = NO;
        _exposure = 0.0;
        _contrast = 1.0;
        _saturation = 1.0;
        _colorTemperature = 0.0;
        _isDefaultConfig = YES;
        [self rebuildLUTs];
    }
    return self;
}

- (void)updateConfig:(NSDictionary *)config {
    @synchronized (self) {
        if (config[@"exposure"]) {
            _exposure = [config[@"exposure"] floatValue];
        }
        if (config[@"contrast"]) {
            _contrast = [config[@"contrast"] floatValue];
        }
        if (config[@"saturation"]) {
            _saturation = [config[@"saturation"] floatValue];
        }
        if (config[@"colorTemperature"]) {
            _colorTemperature = [config[@"colorTemperature"] floatValue];
        }
        [self rebuildLUTs];
    }
}

- (void)reset {
    @synchronized (self) {
        _exposure = 0.0;
        _contrast = 1.0;
        _saturation = 1.0;
        _colorTemperature = 0.0;
        _isDefaultConfig = YES;
        [self rebuildLUTs];
    }
}

- (void)rebuildLUTs {
    // Check if all values are at defaults
    _isDefaultConfig = (_exposure == 0.0 && _contrast == 1.0 &&
                        _saturation == 1.0 && _colorTemperature == 0.0);

    if (_isDefaultConfig) {
        return;
    }

    CGFloat exposureOffset = _exposure * 128.0;

    // Build Y LUT: Y' = clamp((Y - 128) * contrast + 128 + exposureOffset, 0, 255)
    for (int i = 0; i < 256; i++) {
        CGFloat val = ((CGFloat)i - 128.0) * _contrast + 128.0 + exposureOffset;
        _yLUT[i] = (uint8_t)MAX(0, MIN(255, (int)(val + 0.5)));
    }

    // Color temperature shifts applied to U/V planes
    CGFloat tempUShift = -_colorTemperature * 30.0;
    CGFloat tempVShift = _colorTemperature * 30.0;

    // Build U LUT: U' = clamp((U - 128) * saturation + 128 + tempUShift, 0, 255)
    for (int i = 0; i < 256; i++) {
        CGFloat val = ((CGFloat)i - 128.0) * _saturation + 128.0 + tempUShift;
        _uLUT[i] = (uint8_t)MAX(0, MIN(255, (int)(val + 0.5)));
    }

    // Build V LUT: V' = clamp((V - 128) * saturation + 128 + tempVShift, 0, 255)
    for (int i = 0; i < 256; i++) {
        CGFloat val = ((CGFloat)i - 128.0) * _saturation + 128.0 + tempVShift;
        _vLUT[i] = (uint8_t)MAX(0, MIN(255, (int)(val + 0.5)));
    }
}

#pragma mark - VideoFrameProcessorDelegate

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame {
    if (!self.isEnabled) {
        return frame;
    }

    // Cache LUTs locally under lock to avoid config changes mid-frame
    uint8_t localYLUT[256];
    uint8_t localULUT[256];
    uint8_t localVLUT[256];
    BOOL isDefault;

    @synchronized (self) {
        isDefault = _isDefaultConfig;
        if (!isDefault) {
            memcpy(localYLUT, _yLUT, 256);
            memcpy(localULUT, _uLUT, 256);
            memcpy(localVLUT, _vLUT, 256);
        }
    }

    if (isDefault) {
        return frame;
    }

    // Get I420 buffer from frame
    id<RTCI420Buffer> i420Buffer = [frame.buffer toI420];
    if (!i420Buffer) {
        return frame;
    }

    int width = i420Buffer.width;
    int height = i420Buffer.height;
    int chromaWidth = (width + 1) / 2;
    int chromaHeight = (height + 1) / 2;

    // Source plane data
    const uint8_t *srcY = i420Buffer.dataY;
    const uint8_t *srcU = i420Buffer.dataU;
    const uint8_t *srcV = i420Buffer.dataV;
    int srcStrideY = i420Buffer.strideY;
    int srcStrideU = i420Buffer.strideU;
    int srcStrideV = i420Buffer.strideV;

    // Allocate destination buffers
    int dstStrideY = width;
    int dstStrideU = chromaWidth;
    int dstStrideV = chromaWidth;
    uint8_t *dstY = (uint8_t *)malloc(dstStrideY * height);
    uint8_t *dstU = (uint8_t *)malloc(dstStrideU * chromaHeight);
    uint8_t *dstV = (uint8_t *)malloc(dstStrideV * chromaHeight);

    if (!dstY || !dstU || !dstV) {
        free(dstY);
        free(dstU);
        free(dstV);
        return frame;
    }

    // Apply Y LUT (exposure + contrast)
    for (int row = 0; row < height; row++) {
        const uint8_t *srcRow = srcY + row * srcStrideY;
        uint8_t *dstRow = dstY + row * dstStrideY;
        for (int col = 0; col < width; col++) {
            dstRow[col] = localYLUT[srcRow[col]];
        }
    }

    // Apply U LUT (saturation + color temperature)
    for (int row = 0; row < chromaHeight; row++) {
        const uint8_t *srcRow = srcU + row * srcStrideU;
        uint8_t *dstRow = dstU + row * dstStrideU;
        for (int col = 0; col < chromaWidth; col++) {
            dstRow[col] = localULUT[srcRow[col]];
        }
    }

    // Apply V LUT (saturation + color temperature)
    for (int row = 0; row < chromaHeight; row++) {
        const uint8_t *srcRow = srcV + row * srcStrideV;
        uint8_t *dstRow = dstV + row * dstStrideV;
        for (int col = 0; col < chromaWidth; col++) {
            dstRow[col] = localVLUT[srcRow[col]];
        }
    }

    // Create new I420 buffer with modified data
    // RTCI420Buffer initWithWidth:height:dataY:dataU:dataV:
    // copies the data, so we can free our buffers after creation
    RTCI420Buffer *newBuffer = [[RTCI420Buffer alloc] initWithWidth:width
                                                            height:height
                                                             dataY:dstY
                                                             dataU:dstU
                                                             dataV:dstV];

    free(dstY);
    free(dstU);
    free(dstV);

    if (!newBuffer) {
        return frame;
    }

    // Create new frame preserving rotation and timestamp
    RTCVideoFrame *newFrame = [[RTCVideoFrame alloc] initWithBuffer:newBuffer
                                                           rotation:frame.rotation
                                                        timeStampNs:frame.timeStampNs];

    return newFrame;
}

@end
