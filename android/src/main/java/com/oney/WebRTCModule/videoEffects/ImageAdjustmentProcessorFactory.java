package com.oney.WebRTCModule.videoEffects;

/**
 * Factory for creating ImageAdjustmentProcessor instances.
 * Uses singleton pattern to ensure configuration affects the active processor.
 */
public class ImageAdjustmentProcessorFactory implements VideoFrameProcessorFactoryInterface {
    private ImageAdjustmentProcessor currentProcessor;

    @Override
    public VideoFrameProcessor build() {
        if (currentProcessor == null) {
            currentProcessor = new ImageAdjustmentProcessor();
        }
        return currentProcessor;
    }

    /**
     * Get the current processor instance for configuration.
     * Creates one if it doesn't exist.
     */
    public ImageAdjustmentProcessor getProcessor() {
        return (ImageAdjustmentProcessor) build();
    }

    /**
     * Cleanup resources when the module is destroyed.
     */
    public void cleanup() {
        if (currentProcessor != null) {
            currentProcessor.cleanup();
            currentProcessor = null;
        }
    }
}
