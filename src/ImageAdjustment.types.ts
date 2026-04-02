/**
 * Configuration options for image adjustment processing
 */
export interface ImageAdjustmentConfig {
    /**
     * Exposure adjustment applied to the luminance (Y) plane.
     * Range: -1.0 to 1.0, where 0.0 is no change.
     * Negative values darken the image, positive values brighten it.
     * @default 0.0
     */
    exposure?: number;

    /**
     * Contrast adjustment applied to the luminance (Y) plane.
     * Range: 0.0 to 3.0, where 1.0 is no change.
     * Values below 1.0 reduce contrast, above 1.0 increase it.
     * @default 1.0
     */
    contrast?: number;

    /**
     * Saturation adjustment applied to the chrominance (U/V) planes.
     * Range: 0.0 to 3.0, where 1.0 is no change.
     * 0.0 produces a grayscale image, values above 1.0 increase color intensity.
     * @default 1.0
     */
    saturation?: number;

    /**
     * Color temperature adjustment applied to the chrominance (U/V) planes.
     * Range: -1.0 to 1.0, where 0.0 is no change.
     * Negative values shift toward cooler (blue) tones,
     * positive values shift toward warmer (yellow/orange) tones.
     * @default 0.0
     */
    colorTemperature?: number;
}
