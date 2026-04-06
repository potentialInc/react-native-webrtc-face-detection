/**
 * Configuration options for face detection
 */
export interface FaceDetectionConfig {
    /**
     * Process every Nth frame to optimize performance
     * Default: 3 (process every 3rd frame)
     */
    frameSkipCount?: number;

    /**
     * Eye Aspect Ratio threshold for blink detection (iOS)
     * or open probability threshold (Android)
     * Default: 0.21 (iOS) / 0.3 (Android)
     */
    blinkThreshold?: number;

    /**
     * Enable capturing video frame when blink is detected.
     * The captured image will be included in BlinkEvent.faceImage as base64 JPEG.
     * @default false
     */
    captureOnBlink?: boolean;

    /**
     * When captureOnBlink is true, crop the image to face bounding box.
     * If false, captures the full frame.
     * @default true
     */
    cropToFace?: boolean;

    /**
     * JPEG compression quality for captured images (0.0 - 1.0).
     * Lower values = smaller size, lower quality.
     * @default 0.7
     */
    imageQuality?: number;

    /**
     * Maximum width of captured image in pixels.
     * Image will be scaled down if larger, maintaining aspect ratio.
     * @default 480
     */
    maxImageWidth?: number;

    /**
     * Minimum blink duration in milliseconds to count as a valid blink.
     * Blinks shorter than this are rejected as noise.
     * @default 50
     */
    minBlinkDurationMs?: number;

    /**
     * Maximum blink duration in milliseconds to count as a valid blink.
     * Eye closures longer than this are rejected (e.g., sleeping, yawning).
     * @default 800
     */
    maxBlinkDurationMs?: number;

    /**
     * Minimum time in milliseconds between consecutive blinks for the same eye.
     * Prevents rapid-fire false blink sequences from threshold oscillation.
     * @default 300
     */
    blinkCooldownMs?: number;

    /**
     * Enable adaptive thresholding based on per-user calibration.
     * When enabled, the system observes the user's open-eye probability baseline
     * during a calibration period and adjusts the threshold automatically.
     * @default false
     */
    adaptiveThreshold?: boolean;

    /**
     * Duration of the calibration period in milliseconds when adaptiveThreshold is enabled.
     * During this period, blinks are not detected while the system learns the baseline.
     * @default 3000
     */
    calibrationDurationMs?: number;
}

/**
 * Result from face detection processing
 */
export interface FaceDetectionResult {
    /**
     * Array of detected faces in the frame
     */
    faces: Face[];

    /**
     * Timestamp when the detection occurred (in milliseconds)
     */
    timestamp: number;

    /**
     * Width of the video frame
     */
    frameWidth: number;

    /**
     * Height of the video frame
     */
    frameHeight: number;
}

/**
 * Detected face information
 */
export interface Face {
    /**
     * Bounding box of the face in the frame
     */
    bounds: BoundingBox;

    /**
     * Facial landmarks (eyes, nose, mouth, etc.)
     */
    landmarks: FaceLandmarks;

    /**
     * Confidence score of face detection (0.0 to 1.0)
     */
    confidence: number;

    /**
     * Unique tracking ID for this face across frames
     * Useful for tracking the same person over time
     */
    trackingId?: number;

    /**
     * Head pose estimation (rotation angles)
     */
    headPose?: HeadPose;
}

/**
 * Bounding box coordinates
 */
export interface BoundingBox {
    /**
     * X coordinate of top-left corner
     */
    x: number;

    /**
     * Y coordinate of top-left corner
     */
    y: number;

    /**
     * Width of the bounding box
     */
    width: number;

    /**
     * Height of the bounding box
     */
    height: number;
}

/**
 * Mouth landmark data
 */
export interface MouthData {
    /**
     * Position of the mouth center in the frame
     */
    position: {
        x: number;
        y: number;
    };

    /**
     * Width of the mouth region
     */
    width: number;

    /**
     * Height of the mouth region
     */
    height: number;
}

/**
 * Nose landmark data
 */
export interface NoseData {
    /**
     * Position of the nose base in the frame
     */
    position: {
        x: number;
        y: number;
    };
}

/**
 * Facial landmarks
 */
export interface FaceLandmarks {
    /**
     * Left eye data
     */
    leftEye: EyeData;

    /**
     * Right eye data
     */
    rightEye: EyeData;

    /**
     * Mouth data (available when ML Kit detects mouth landmarks)
     */
    mouth?: MouthData;

    /**
     * Nose data (available when ML Kit detects nose landmark)
     */
    nose?: NoseData;
}

/**
 * Eye-specific data including blink detection
 */
export interface EyeData {
    /**
     * Position of the eye center in the frame
     */
    position: {
        x: number;
        y: number;
    };

    /**
     * Whether the eye is currently open
     */
    isOpen: boolean;

    /**
     * Probability that the eye is open (0.0 = closed, 1.0 = open)
     */
    openProbability: number;

    /**
     * Number of blinks detected for this eye
     */
    blinkCount: number;
}

/**
 * Head pose estimation (in degrees)
 */
export interface HeadPose {
    /**
     * Left-right rotation (side to side)
     * Negative = left, Positive = right
     */
    yaw: number;

    /**
     * Up-down rotation (nodding)
     * Negative = down, Positive = up
     */
    pitch: number;

    /**
     * Tilt rotation
     * Negative = tilt left, Positive = tilt right
     */
    roll: number;
}

/**
 * Blink detection event data
 */
export interface BlinkEvent {
    /**
     * Timestamp when the blink occurred (in milliseconds)
     */
    timestamp: number;

    /**
     * Which eye blinked.
     * 'both' indicates a natural blink (both eyes closed simultaneously).
     * 'left' or 'right' indicates a wink (single-eye blink).
     */
    eye?: 'left' | 'right' | 'both';

    /**
     * Face tracking ID associated with this blink
     */
    trackingId?: number;

    /**
     * Total number of blinks detected for this eye
     */
    blinkCount?: number;

    /**
     * Base64 encoded JPEG image of the face at blink moment.
     * Only present when captureOnBlink config is enabled.
     */
    faceImage?: string;

    /**
     * Bounding box of the face in the original frame.
     * Useful for UI positioning or additional processing.
     * Only present when captureOnBlink config is enabled.
     */
    faceBounds?: BoundingBox;

    /**
     * Duration of the blink in milliseconds (time eyes were closed).
     */
    duration?: number;

    /**
     * Type of blink: 'blink' for both eyes, 'wink' for single eye.
     */
    blinkType?: 'blink' | 'wink';

    /**
     * Confidence score of the blink detection (0.0 to 1.0).
     * Higher values indicate more reliable blink detection.
     * Computed from probability delta, duration, and eye symmetry.
     */
    confidence?: number;

    /**
     * Lowest eye open probability observed during the eye closure.
     * Lower values indicate a more definitive eye closure.
     */
    minOpenProbability?: number;
}

/**
 * Configuration for the FaceDetectionOverlay component
 */
export interface FaceDetectionOverlayConfig {
    /**
     * Show face bounding box
     * @default true
     */
    showFaceBox?: boolean;

    /**
     * Show eye bounding boxes
     * @default true
     */
    showEyeBoxes?: boolean;

    /**
     * Show mouth bounding box
     * @default true
     */
    showMouthBox?: boolean;

    /**
     * Show head pose angles (yaw, pitch, roll)
     * @default false
     */
    showHeadPose?: boolean;

    /**
     * Show eye status labels (open/closed)
     * @default false
     */
    showEyeStatus?: boolean;

    /**
     * Color for face bounding box
     * @default '#00FF00'
     */
    faceBoxColor?: string;

    /**
     * Color for eye bounding boxes
     * @default '#00AAFF'
     */
    eyeBoxColor?: string;

    /**
     * Color for mouth bounding box
     * @default '#FF00FF'
     */
    mouthBoxColor?: string;

    /**
     * Stroke width for all boxes
     * @default 2
     */
    strokeWidth?: number;

    /**
     * Animation duration in milliseconds
     * @default 100
     */
    animationDuration?: number;

    /**
     * Text color for labels
     * @default '#FFFFFF'
     */
    labelColor?: string;

    /**
     * Font size for labels
     * @default 10
     */
    labelFontSize?: number;

    /**
     * Size of eye marker boxes in frame pixels (scaled automatically)
     * @default 30
     */
    eyeBoxSize?: number;

    /**
     * Color for eye boxes when eye is closed
     * @default '#FF4444'
     */
    eyeClosedColor?: string;

    /**
     * Border radius for face bounding box
     * @default 4
     */
    faceBoxBorderRadius?: number;

    /**
     * Border radius for eye boxes (set to eyeBoxSize/2 for circles)
     * @default 2
     */
    eyeBoxBorderRadius?: number;

    /**
     * Border radius for mouth box
     * @default 2
     */
    mouthBoxBorderRadius?: number;

    /**
     * Background color for head pose and eye status labels
     * @default 'rgba(0, 0, 0, 0.6)'
     */
    labelBackgroundColor?: string;
}
