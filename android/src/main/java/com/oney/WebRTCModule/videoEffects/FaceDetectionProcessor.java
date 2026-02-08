package com.oney.WebRTCModule.videoEffects;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.face.Face;
import com.google.mlkit.vision.face.FaceDetection;
import com.google.mlkit.vision.face.FaceDetector;
import com.google.mlkit.vision.face.FaceDetectorOptions;
import com.google.mlkit.vision.face.FaceLandmark;

import org.webrtc.EglBase;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoFrame;
import org.webrtc.YuvConverter;

import java.nio.ByteBuffer;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Face detection processor that processes video frames for face detection.
 * Uses a dedicated capture pipeline to safely convert TextureBuffers to I420
 * without interfering with the main video rendering pipeline.
 */
public class FaceDetectionProcessor implements VideoFrameProcessor {
    private static final String TAG = "FaceDetectionProcessor";
    private static final String EVENT_FACE_DETECTED = "faceDetected";
    private static final String EVENT_BLINK_DETECTED = "blinkDetected";

    private final ReactApplicationContext reactContext;
    private FaceDetector detector;
    private boolean isEnabled = false;
    private int frameSkipCount = 5; // Process every 5th frame for performance
    private int frameCounter = 0;
    private float blinkThreshold = 0.3f;

    // Frame capture configuration
    private boolean captureOnBlink = false;
    private boolean cropToFace = true;
    private float imageQuality = 0.7f;
    private int maxImageWidth = 480;
    private byte[] lastNv21Data = null;
    private int lastFrameWidth = 0;
    private int lastFrameHeight = 0;
    private int lastFrameRotation = 0;

    // Closed-eye frame storage (for capturing at correct moment)
    private byte[] closedEyeNv21Data = null;
    private int closedEyeFrameWidth = 0;
    private int closedEyeFrameHeight = 0;
    private Rect closedEyeFaceBounds = null;
    private int closedEyeFrameRotation = 0;

    // Dedicated face detection pipeline
    private HandlerThread faceDetectionThread;
    private Handler faceDetectionHandler;
    private YuvConverter yuvConverter;
    private EglBase eglBase;
    private final AtomicBoolean isProcessing = new AtomicBoolean(false);
    private volatile boolean pipelineInitialized = false;

    // Track eye states per face for blink detection
    private final Map<Integer, EyeState> leftEyeStates = new HashMap<>();
    private final Map<Integer, EyeState> rightEyeStates = new HashMap<>();

    private static class EyeState {
        boolean isOpen = true;
        boolean wasOpen = true;
        int blinkCount = 0;
        float currentProbability = 1.0f;
    }

    // #region agent log helper
    private void debugLog(String hypothesisId, String message, String data) {
        Log.d("DEBUG_AGENT", "[" + hypothesisId + "] FDP:" + message + " " + data);
    }
    // #endregion

    public FaceDetectionProcessor(ReactApplicationContext context) {
        this.reactContext = context;
        initializeFaceDetector();
    }

    private void initializeFaceDetector() {
        FaceDetectorOptions options = new FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
                .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
                .setMinFaceSize(0.15f)
                .enableTracking()
                .build();
        
        this.detector = FaceDetection.getClient(options);
    }

    /**
     * Initialize the dedicated face detection pipeline.
     * This creates a separate EGL context and thread for safe texture conversion.
     */
    private synchronized void initializePipeline() {
        if (pipelineInitialized) {
            return;
        }

        try {
            // Create dedicated thread for face detection
            faceDetectionThread = new HandlerThread("FaceDetectionThread");
            faceDetectionThread.start();
            faceDetectionHandler = new Handler(faceDetectionThread.getLooper());

            // Create dedicated EGL context for texture conversion
            // This is separate from the rendering EGL context to avoid conflicts
            eglBase = EglBase.create();
            
            // Initialize YuvConverter on the face detection thread
            faceDetectionHandler.post(() -> {
                try {
                    yuvConverter = new YuvConverter();
                    Log.d(TAG, "Face detection pipeline initialized");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to initialize YuvConverter: " + e.getMessage());
                }
            });

            pipelineInitialized = true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize face detection pipeline: " + e.getMessage());
        }
    }

    public void setEnabled(boolean enabled) {
        this.isEnabled = enabled;
        if (enabled) {
            initializePipeline();
        }
        if (!enabled) {
            reset();
        }
    }

    public void setFrameSkipCount(int count) {
        this.frameSkipCount = Math.max(1, count);
    }

    public void setBlinkThreshold(float threshold) {
        this.blinkThreshold = threshold;
    }

    // Frame capture setters
    public void setCaptureOnBlink(boolean capture) {
        this.captureOnBlink = capture;
    }

    public void setCropToFace(boolean crop) {
        this.cropToFace = crop;
    }

    public void setImageQuality(float quality) {
        this.imageQuality = quality;
    }

    public void setMaxImageWidth(int width) {
        this.maxImageWidth = width;
    }

    public void reset() {
        leftEyeStates.clear();
        rightEyeStates.clear();
        frameCounter = 0;
        lastFrameRotation = 0;
        closedEyeFrameRotation = 0;
    }

    @Override
    public VideoFrame process(VideoFrame frame, SurfaceTextureHelper textureHelper) {
        // #region agent log
        debugLog("C", "process_entry", "{\"isEnabled\":" + isEnabled + ",\"pipelineInitialized\":" + pipelineInitialized + "}");
        // #endregion
        
        // Always return the frame immediately - never block the video pipeline
        if (!isEnabled || !pipelineInitialized) {
            // #region agent log
            debugLog("C", "process_skip_disabled", "{}");
            // #endregion
            return frame;
        }

        frameCounter++;
        
        // Skip frames for performance
        if (frameCounter % frameSkipCount != 0) {
            // #region agent log
            debugLog("E", "process_skip_counter", "{\"frameCounter\":" + frameCounter + ",\"frameSkipCount\":" + frameSkipCount + "}");
            // #endregion
            return frame;
        }

        // Only process if not already processing a frame
        // This prevents queue buildup and ensures we don't overwhelm the detection thread
        if (!isProcessing.compareAndSet(false, true)) {
            // #region agent log
            debugLog("E", "process_skip_busy", "{}");
            // #endregion
            return frame;
        }

        try {
            VideoFrame.Buffer buffer = frame.getBuffer();
            final int rotation = frame.getRotation();
            final int frameWidth = frame.getRotatedWidth();
            final int frameHeight = frame.getRotatedHeight();
            
            // #region agent log
            String bufferType = buffer.getClass().getSimpleName();
            debugLog("A", "process_buffer_type", "{\"bufferType\":\"" + bufferType + "\"}");
            // #endregion

            if (buffer instanceof VideoFrame.I420Buffer) {
                // Already I420 - process directly (fast path)
                processI420Buffer((VideoFrame.I420Buffer) buffer, rotation, frameWidth, frameHeight);
            } else {
                // TextureBuffer - need to convert on dedicated thread
                // #region agent log
                debugLog("A", "calling_processTextureBuffer", "{}");
                // #endregion
                processTextureBuffer(frame, textureHelper, rotation, frameWidth, frameHeight);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in process: " + e.getMessage());
            isProcessing.set(false);
        }
        
        // #region agent log
        debugLog("D", "process_returning_frame", "{}");
        // #endregion
        return frame;
    }

    /**
     * Process an I420 buffer directly (fast path for non-texture buffers)
     */
    private void processI420Buffer(VideoFrame.I420Buffer i420Buffer, int rotation, 
                                    int frameWidth, int frameHeight) {
        try {
            InputImage image = createInputImageFromI420Buffer(i420Buffer, rotation);
            if (image != null) {
                runFaceDetection(image, frameWidth, frameHeight);
            } else {
                isProcessing.set(false);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error processing I420 buffer: " + e.getMessage());
            isProcessing.set(false);
        }
    }

    /**
     * Process a TextureBuffer by converting it to I420 and copying data SYNCHRONOUSLY.
     * The pixel data is copied into an InputImage before returning, so we don't need
     * to retain the frame for async processing.
     */
    private void processTextureBuffer(VideoFrame frame, SurfaceTextureHelper textureHelper,
                                       int rotation, int frameWidth, int frameHeight) {
        // #region agent log
        debugLog("A", "processTextureBuffer_entry", "{}");
        // #endregion
        
        VideoFrame.I420Buffer i420Buffer = null;
        try {
            // IMPORTANT: Retain the frame before conversion to prevent it from being
            // released by the EglRenderer while we're using it
            frame.retain();
            
            // Convert texture to I420 SYNCHRONOUSLY
            // This creates a new buffer with copied data that we own
            VideoFrame.Buffer buffer = frame.getBuffer();
            
            // #region agent log
            debugLog("A", "before_toI420", "{}");
            // #endregion
            
            i420Buffer = buffer.toI420();
            
            // #region agent log
            debugLog("A", "after_toI420", "{\"i420BufferNull\":" + (i420Buffer == null) + "}");
            // #endregion
            
            // Release our retain on the frame - we're done accessing the texture
            frame.release();
            
            if (i420Buffer != null) {
                // Create InputImage SYNCHRONOUSLY - this copies the pixel data
                // into a byte array that we own
                final InputImage image = createInputImageFromI420Buffer(i420Buffer, rotation);
                
                // Release the I420 buffer now - we've copied all the data we need
                i420Buffer.release();
                i420Buffer = null;
                
                // #region agent log
                debugLog("A", "i420Buffer_released", "{}");
                // #endregion
                
                if (image != null && faceDetectionHandler != null) {
                    // Now we can safely process async - the InputImage has its own data copy
                    faceDetectionHandler.post(() -> {
                        runFaceDetection(image, frameWidth, frameHeight);
                    });
                } else {
                    isProcessing.set(false);
                }
            } else {
                isProcessing.set(false);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error converting texture to I420: " + e.getMessage());
            // #region agent log
            debugLog("A", "processTextureBuffer_error", "{\"error\":\"" + e.getMessage() + "\"}");
            // #endregion
            isProcessing.set(false);
            // Release the I420 buffer if we created one
            if (i420Buffer != null) {
                i420Buffer.release();
            }
            // Make sure to release the frame retain in case of error
            try {
                frame.release();
            } catch (Exception ignored) {}
        }
        
        // #region agent log
        debugLog("D", "processTextureBuffer_exit", "{}");
        // #endregion
    }

    /**
     * Run ML Kit face detection on the prepared image
     */
    private void runFaceDetection(InputImage image, int frameWidth, int frameHeight) {
        try {
            Task<List<Face>> result = detector.process(image);
            
            result.addOnSuccessListener(faces -> {
                processFaceResults(faces, frameWidth, frameHeight);
                isProcessing.set(false);
            }).addOnFailureListener(e -> {
                Log.e(TAG, "Face detection failed: " + e.getMessage());
                isProcessing.set(false);
            });
        } catch (Exception e) {
            Log.e(TAG, "Error running face detection: " + e.getMessage());
            isProcessing.set(false);
        }
    }

    private InputImage createInputImageFromI420Buffer(VideoFrame.I420Buffer i420Buffer, int rotation) {
        try {
            int width = i420Buffer.getWidth();
            int height = i420Buffer.getHeight();

            // Create NV21 format data (required by ML Kit)
            int ySize = width * height;
            int uvSize = width * height / 2;
            byte[] nv21 = new byte[ySize + uvSize];

            // Copy Y plane
            ByteBuffer yBuffer = i420Buffer.getDataY().duplicate();
            yBuffer.rewind();
            int yRemaining = Math.min(ySize, yBuffer.remaining());
            yBuffer.get(nv21, 0, yRemaining);

            // Interleave U and V planes to create NV21
            ByteBuffer uBuffer = i420Buffer.getDataU().duplicate();
            ByteBuffer vBuffer = i420Buffer.getDataV().duplicate();
            uBuffer.rewind();
            vBuffer.rewind();
            
            int uvWidth = width / 2;
            int uvHeight = height / 2;
            int strideU = i420Buffer.getStrideU();
            int strideV = i420Buffer.getStrideV();
            
            for (int row = 0; row < uvHeight; row++) {
                for (int col = 0; col < uvWidth; col++) {
                    int uvIndex = ySize + row * width + col * 2;
                    int srcIndexU = row * strideU + col;
                    int srcIndexV = row * strideV + col;

                    if (uvIndex + 1 < nv21.length &&
                        srcIndexU < uBuffer.limit() &&
                        srcIndexV < vBuffer.limit()) {
                        nv21[uvIndex] = vBuffer.get(srcIndexV);      // V comes first in NV21
                        nv21[uvIndex + 1] = uBuffer.get(srcIndexU);  // Then U
                    }
                }
            }

            // Store NV21 data for frame capture if enabled
            if (captureOnBlink) {
                lastNv21Data = nv21.clone();
                lastFrameWidth = width;
                lastFrameHeight = height;
                lastFrameRotation = rotation;
            }

            return InputImage.fromByteArray(
                    nv21,
                    width,
                    height,
                    rotation,
                    InputImage.IMAGE_FORMAT_NV21
            );

        } catch (Exception e) {
            Log.e(TAG, "Error creating InputImage: " + e.getMessage());
            return null;
        }
    }

    private void processFaceResults(List<Face> faces, int frameWidth, int frameHeight) {
        WritableArray facesArray = Arguments.createArray();
        
        for (Face face : faces) {
            WritableMap faceMap = Arguments.createMap();
            
            // Bounding box
            WritableMap bounds = Arguments.createMap();
            bounds.putDouble("x", face.getBoundingBox().left);
            bounds.putDouble("y", face.getBoundingBox().top);
            bounds.putDouble("width", face.getBoundingBox().width());
            bounds.putDouble("height", face.getBoundingBox().height());
            faceMap.putMap("bounds", bounds);
            
            faceMap.putDouble("confidence", 1.0);
            
            if (face.getTrackingId() != null) {
                faceMap.putInt("trackingId", face.getTrackingId());
            }
            
            // Head pose
            WritableMap headPose = Arguments.createMap();
            headPose.putDouble("yaw", face.getHeadEulerAngleY());
            headPose.putDouble("pitch", face.getHeadEulerAngleX());
            headPose.putDouble("roll", face.getHeadEulerAngleZ());
            faceMap.putMap("headPose", headPose);
            
            // Landmarks
            WritableMap landmarks = Arguments.createMap();
            Rect faceBounds = face.getBoundingBox();

            FaceLandmark leftEye = face.getLandmark(FaceLandmark.LEFT_EYE);
            WritableMap leftEyeData = processEye(
                    leftEye, face.getLeftEyeOpenProbability(),
                    face.getTrackingId(), leftEyeStates, "left", faceBounds
            );
            landmarks.putMap("leftEye", leftEyeData);

            FaceLandmark rightEye = face.getLandmark(FaceLandmark.RIGHT_EYE);
            WritableMap rightEyeData = processEye(
                    rightEye, face.getRightEyeOpenProbability(),
                    face.getTrackingId(), rightEyeStates, "right", faceBounds
            );
            landmarks.putMap("rightEye", rightEyeData);

            // Extract mouth landmarks
            FaceLandmark mouthBottom = face.getLandmark(FaceLandmark.MOUTH_BOTTOM);
            FaceLandmark mouthLeft = face.getLandmark(FaceLandmark.MOUTH_LEFT);
            FaceLandmark mouthRight = face.getLandmark(FaceLandmark.MOUTH_RIGHT);
            if (mouthBottom != null && mouthLeft != null && mouthRight != null) {
                WritableMap mouthData = Arguments.createMap();
                WritableMap mouthPosition = Arguments.createMap();
                float centerX = (mouthLeft.getPosition().x + mouthRight.getPosition().x) / 2.0f;
                float centerY = mouthBottom.getPosition().y;
                mouthPosition.putDouble("x", centerX);
                mouthPosition.putDouble("y", centerY);
                mouthData.putMap("position", mouthPosition);
                float mouthWidth = Math.abs(mouthRight.getPosition().x - mouthLeft.getPosition().x);
                mouthData.putDouble("width", mouthWidth);
                mouthData.putDouble("height", mouthWidth * 0.5);
                landmarks.putMap("mouth", mouthData);
            }

            // Extract nose landmark
            FaceLandmark noseBase = face.getLandmark(FaceLandmark.NOSE_BASE);
            if (noseBase != null) {
                WritableMap noseData = Arguments.createMap();
                WritableMap nosePosition = Arguments.createMap();
                nosePosition.putDouble("x", noseBase.getPosition().x);
                nosePosition.putDouble("y", noseBase.getPosition().y);
                noseData.putMap("position", nosePosition);
                landmarks.putMap("nose", noseData);
            }

            faceMap.putMap("landmarks", landmarks);
            facesArray.pushMap(faceMap);
        }
        
        WritableMap result = Arguments.createMap();
        result.putArray("faces", facesArray);
        result.putDouble("timestamp", System.currentTimeMillis());
        result.putInt("frameWidth", frameWidth);
        result.putInt("frameHeight", frameHeight);
        
        sendEvent(EVENT_FACE_DETECTED, result);
    }

    private WritableMap processEye(FaceLandmark eyeLandmark, Float openProbability,
                                    Integer trackingId, Map<Integer, EyeState> eyeStates,
                                    String eyeSide, Rect faceBounds) {
        WritableMap eyeData = Arguments.createMap();

        WritableMap position = Arguments.createMap();
        if (eyeLandmark != null && eyeLandmark.getPosition() != null) {
            position.putDouble("x", eyeLandmark.getPosition().x);
            position.putDouble("y", eyeLandmark.getPosition().y);
        } else {
            position.putDouble("x", 0);
            position.putDouble("y", 0);
        }
        eyeData.putMap("position", position);

        if (openProbability != null && trackingId != null) {
            EyeState eyeState = eyeStates.get(trackingId);
            if (eyeState == null) {
                eyeState = new EyeState();
                eyeStates.put(trackingId, eyeState);
            }

            eyeState.currentProbability = openProbability;
            eyeState.wasOpen = eyeState.isOpen;
            eyeState.isOpen = openProbability > blinkThreshold;

            // CAPTURE FRAME WHEN EYE CLOSES (transition: open → closed)
            // This ensures we get the closed-eye image, not the open-eye image
            if (eyeState.wasOpen && !eyeState.isOpen) {
                if (captureOnBlink && lastNv21Data != null && faceBounds != null) {
                    closedEyeNv21Data = lastNv21Data.clone();
                    closedEyeFrameWidth = lastFrameWidth;
                    closedEyeFrameHeight = lastFrameHeight;
                    closedEyeFrameRotation = lastFrameRotation;
                    closedEyeFaceBounds = new Rect(faceBounds);
                }
            }

            // DETECT BLINK (transition: closed → open)
            if (!eyeState.wasOpen && eyeState.isOpen) {
                eyeState.blinkCount++;

                WritableMap blinkEvent = Arguments.createMap();
                blinkEvent.putDouble("timestamp", System.currentTimeMillis());
                blinkEvent.putString("eye", eyeSide);
                blinkEvent.putInt("trackingId", trackingId);
                blinkEvent.putInt("blinkCount", eyeState.blinkCount);

                // Use STORED closed-eye frame instead of current frame
                // This ensures we capture the frame with eyes closed, not open
                if (captureOnBlink && closedEyeNv21Data != null && closedEyeFaceBounds != null) {
                    // Temporarily swap to closed-eye data for capture
                    byte[] savedNv21 = lastNv21Data;
                    int savedWidth = lastFrameWidth;
                    int savedHeight = lastFrameHeight;
                    int savedRotation = lastFrameRotation;

                    lastNv21Data = closedEyeNv21Data;
                    lastFrameWidth = closedEyeFrameWidth;
                    lastFrameHeight = closedEyeFrameHeight;
                    lastFrameRotation = closedEyeFrameRotation;

                    String base64Image = captureFrameAsBase64(closedEyeFaceBounds);

                    // Restore current frame data
                    lastNv21Data = savedNv21;
                    lastFrameWidth = savedWidth;
                    lastFrameHeight = savedHeight;
                    lastFrameRotation = savedRotation;

                    if (base64Image != null) {
                        blinkEvent.putString("faceImage", base64Image);
                        WritableMap boundsMap = Arguments.createMap();
                        boundsMap.putInt("x", closedEyeFaceBounds.left);
                        boundsMap.putInt("y", closedEyeFaceBounds.top);
                        boundsMap.putInt("width", closedEyeFaceBounds.width());
                        boundsMap.putInt("height", closedEyeFaceBounds.height());
                        blinkEvent.putMap("faceBounds", boundsMap);
                    }

                    // Clear stored closed-eye data
                    closedEyeNv21Data = null;
                    closedEyeFaceBounds = null;
                }

                sendEvent(EVENT_BLINK_DETECTED, blinkEvent);
            }

            eyeData.putBoolean("isOpen", eyeState.isOpen);
            eyeData.putDouble("openProbability", openProbability);
            eyeData.putInt("blinkCount", eyeState.blinkCount);
        } else {
            eyeData.putBoolean("isOpen", true);
            eyeData.putDouble("openProbability", 1.0);
            eyeData.putInt("blinkCount", 0);
        }

        return eyeData;
    }

    /**
     * Captures current frame and returns base64 encoded JPEG.
     * @param faceBounds Face bounding box in pixel coordinates
     * @return Base64 encoded JPEG string, or null on failure
     */
    private String captureFrameAsBase64(Rect faceBounds) {
        if (lastNv21Data == null) return null;

        try {
            // Convert NV21 to Bitmap via YuvImage
            YuvImage yuvImage = new YuvImage(
                lastNv21Data, ImageFormat.NV21,
                lastFrameWidth, lastFrameHeight, null);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            yuvImage.compressToJpeg(new Rect(0, 0, lastFrameWidth, lastFrameHeight), 100, out);
            Bitmap bitmap = BitmapFactory.decodeByteArray(out.toByteArray(), 0, out.size());

            if (bitmap == null) return null;

            Bitmap resultBitmap = bitmap;

            // Crop to face if enabled
            if (cropToFace && faceBounds != null && !faceBounds.isEmpty()) {
                int padding = (int)(faceBounds.width() * 0.15);
                Rect cropRect = new Rect(
                    Math.max(0, faceBounds.left - padding),
                    Math.max(0, faceBounds.top - padding),
                    Math.min(bitmap.getWidth(), faceBounds.right + padding),
                    Math.min(bitmap.getHeight(), faceBounds.bottom + padding)
                );

                if (cropRect.width() > 0 && cropRect.height() > 0) {
                    resultBitmap = Bitmap.createBitmap(bitmap,
                        cropRect.left, cropRect.top, cropRect.width(), cropRect.height());
                    if (resultBitmap != bitmap) {
                        bitmap.recycle();
                    }
                }
            }

            // Scale down if too large
            if (resultBitmap.getWidth() > maxImageWidth) {
                float scale = (float) maxImageWidth / resultBitmap.getWidth();
                int newHeight = (int) (resultBitmap.getHeight() * scale);
                Bitmap scaledBitmap = Bitmap.createScaledBitmap(resultBitmap, maxImageWidth, newHeight, true);
                if (scaledBitmap != resultBitmap) {
                    resultBitmap.recycle();
                }
                resultBitmap = scaledBitmap;
            }

            // Apply frame rotation to correct image orientation
            if (lastFrameRotation != 0) {
                Matrix matrix = new Matrix();
                matrix.postRotate(lastFrameRotation);
                Bitmap rotatedBitmap = Bitmap.createBitmap(
                    resultBitmap, 0, 0,
                    resultBitmap.getWidth(), resultBitmap.getHeight(),
                    matrix, true);
                if (rotatedBitmap != resultBitmap) {
                    resultBitmap.recycle();
                }
                resultBitmap = rotatedBitmap;
            }

            // Encode to JPEG base64
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            resultBitmap.compress(Bitmap.CompressFormat.JPEG, (int)(imageQuality * 100), baos);
            String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);

            resultBitmap.recycle();
            return base64;

        } catch (Exception e) {
            Log.e(TAG, "Error capturing frame: " + e.getMessage());
            return null;
        }
    }

    private void sendEvent(String eventName, WritableMap params) {
        if (reactContext != null && reactContext.hasActiveCatalystInstance()) {
            reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(eventName, params);
        }
    }

    public void cleanup() {
        isEnabled = false;
        
        if (faceDetectionHandler != null) {
            faceDetectionHandler.post(() -> {
                if (yuvConverter != null) {
                    yuvConverter.release();
                    yuvConverter = null;
                }
            });
        }
        
        if (faceDetectionThread != null) {
            faceDetectionThread.quitSafely();
            faceDetectionThread = null;
            faceDetectionHandler = null;
        }
        
        if (eglBase != null) {
            eglBase.release();
            eglBase = null;
        }
        
        if (detector != null) {
            detector.close();
            detector = null;
        }
        
        leftEyeStates.clear();
        rightEyeStates.clear();
        pipelineInitialized = false;

        // Clear frame capture data
        lastNv21Data = null;
        lastFrameWidth = 0;
        lastFrameHeight = 0;
        lastFrameRotation = 0;

        // Clear closed-eye frame data
        closedEyeNv21Data = null;
        closedEyeFrameWidth = 0;
        closedEyeFrameHeight = 0;
        closedEyeFaceBounds = null;
        closedEyeFrameRotation = 0;

        Log.d(TAG, "Face detection pipeline cleaned up");
    }
}
