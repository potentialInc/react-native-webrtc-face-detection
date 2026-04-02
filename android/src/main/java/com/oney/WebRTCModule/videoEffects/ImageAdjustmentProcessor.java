package com.oney.WebRTCModule.videoEffects;

import android.util.Log;

import org.webrtc.JavaI420Buffer;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoFrame;

import java.nio.ByteBuffer;

/**
 * Video frame processor that applies exposure, contrast, saturation,
 * and color temperature adjustments directly on I420 (YUV) buffers.
 *
 * Uses pre-computed lookup tables (LUTs) for efficient per-pixel processing.
 */
public class ImageAdjustmentProcessor implements VideoFrameProcessor {
    private static final String TAG = "ImageAdjustmentProcessor";

    // Config values — volatile for cross-thread visibility
    private volatile float exposure = 0.0f;        // -1.0 to 1.0
    private volatile float contrast = 1.0f;        // 0.0 to 3.0
    private volatile float saturation = 1.0f;      // 0.0 to 3.0
    private volatile float colorTemperature = 0.0f; // -1.0 to 1.0
    private volatile boolean isEnabled = false;
    private volatile boolean isDefaultConfig = true;

    // Pre-computed LUTs
    private volatile byte[] yLUT = new byte[256];
    private volatile byte[] uLUT = new byte[256];
    private volatile byte[] vLUT = new byte[256];

    public ImageAdjustmentProcessor() {
        rebuildLUTs();
    }

    public void setEnabled(boolean enabled) {
        this.isEnabled = enabled;
    }

    public boolean getEnabled() {
        return this.isEnabled;
    }

    public void updateConfig(float exposure, float contrast, float saturation, float colorTemperature) {
        this.exposure = exposure;
        this.contrast = contrast;
        this.saturation = saturation;
        this.colorTemperature = colorTemperature;
        rebuildLUTs();
    }

    public void reset() {
        this.exposure = 0.0f;
        this.contrast = 1.0f;
        this.saturation = 1.0f;
        this.colorTemperature = 0.0f;
        this.isDefaultConfig = true;
        rebuildLUTs();
    }

    private void rebuildLUTs() {
        isDefaultConfig = (exposure == 0.0f && contrast == 1.0f &&
                           saturation == 1.0f && colorTemperature == 0.0f);

        if (isDefaultConfig) {
            return;
        }

        byte[] newYLUT = new byte[256];
        byte[] newULUT = new byte[256];
        byte[] newVLUT = new byte[256];

        float exposureOffset = exposure * 128.0f;
        float tempUShift = -colorTemperature * 30.0f;
        float tempVShift = colorTemperature * 30.0f;

        for (int i = 0; i < 256; i++) {
            // Y LUT: exposure + contrast
            float yVal = (i - 128.0f) * contrast + 128.0f + exposureOffset;
            newYLUT[i] = (byte) Math.max(0, Math.min(255, Math.round(yVal)));

            // U LUT: saturation + color temperature
            float uVal = (i - 128.0f) * saturation + 128.0f + tempUShift;
            newULUT[i] = (byte) Math.max(0, Math.min(255, Math.round(uVal)));

            // V LUT: saturation + color temperature
            float vVal = (i - 128.0f) * saturation + 128.0f + tempVShift;
            newVLUT[i] = (byte) Math.max(0, Math.min(255, Math.round(vVal)));
        }

        // Atomic swap of LUT references
        this.yLUT = newYLUT;
        this.uLUT = newULUT;
        this.vLUT = newVLUT;
    }

    @Override
    public VideoFrame process(VideoFrame frame, SurfaceTextureHelper textureHelper) {
        if (!isEnabled || isDefaultConfig) {
            return frame;
        }

        // Snapshot LUT references for this frame
        byte[] localYLUT = this.yLUT;
        byte[] localULUT = this.uLUT;
        byte[] localVLUT = this.vLUT;

        VideoFrame.I420Buffer i420Buffer = null;
        boolean needsRelease = false;

        try {
            VideoFrame.Buffer buffer = frame.getBuffer();
            if (buffer instanceof VideoFrame.I420Buffer) {
                i420Buffer = (VideoFrame.I420Buffer) buffer;
            } else {
                i420Buffer = buffer.toI420();
                needsRelease = true;
            }

            int width = i420Buffer.getWidth();
            int height = i420Buffer.getHeight();
            int chromaWidth = (width + 1) / 2;
            int chromaHeight = (height + 1) / 2;

            // Source planes
            ByteBuffer srcY = i420Buffer.getDataY();
            ByteBuffer srcU = i420Buffer.getDataU();
            ByteBuffer srcV = i420Buffer.getDataV();
            int srcStrideY = i420Buffer.getStrideY();
            int srcStrideU = i420Buffer.getStrideU();
            int srcStrideV = i420Buffer.getStrideV();

            // Allocate destination I420 buffer
            int dstStrideY = width;
            int dstStrideU = chromaWidth;
            int dstStrideV = chromaWidth;
            JavaI420Buffer dstBuffer = JavaI420Buffer.allocate(width, height);

            ByteBuffer dstY = dstBuffer.getDataY();
            ByteBuffer dstU = dstBuffer.getDataU();
            ByteBuffer dstV = dstBuffer.getDataV();

            // Apply Y LUT (exposure + contrast)
            for (int row = 0; row < height; row++) {
                int srcOffset = row * srcStrideY;
                for (int col = 0; col < width; col++) {
                    int srcVal = srcY.get(srcOffset + col) & 0xFF;
                    dstY.put(localYLUT[srcVal]);
                }
            }

            // Apply U LUT (saturation + color temperature)
            for (int row = 0; row < chromaHeight; row++) {
                int srcOffset = row * srcStrideU;
                for (int col = 0; col < chromaWidth; col++) {
                    int srcVal = srcU.get(srcOffset + col) & 0xFF;
                    dstU.put(localULUT[srcVal]);
                }
            }

            // Apply V LUT (saturation + color temperature)
            for (int row = 0; row < chromaHeight; row++) {
                int srcOffset = row * srcStrideV;
                for (int col = 0; col < chromaWidth; col++) {
                    int srcVal = srcV.get(srcOffset + col) & 0xFF;
                    dstV.put(localVLUT[srcVal]);
                }
            }

            // Rewind destination buffers
            dstY.rewind();
            dstU.rewind();
            dstV.rewind();

            // Create new frame with modified buffer
            VideoFrame newFrame = new VideoFrame(dstBuffer, frame.getRotation(), frame.getTimestampNs());

            if (needsRelease) {
                i420Buffer.release();
            }

            return newFrame;
        } catch (Exception e) {
            Log.e(TAG, "Error processing frame: " + e.getMessage());
            if (needsRelease && i420Buffer != null) {
                i420Buffer.release();
            }
            return frame;
        }
    }

    public void cleanup() {
        isEnabled = false;
        reset();
        Log.d(TAG, "Image adjustment processor cleaned up");
    }
}
