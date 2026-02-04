import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Image, Switch, TouchableOpacity } from 'react-native';
import {
  mediaDevices,
  RTCView,
  MediaStream,
  MediaStreamTrack,
  useBlinkDetection,
  BlinkEvent,
} from 'react-native-webrtc';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusIndicator } from '@/components/StatusIndicator';
import { colors, spacing, borderRadius } from '@/constants/theme';

export default function BlinkCaptureScreen() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // Config state
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [cropToFace, setCropToFace] = useState(true);
  const [imageQuality, setImageQuality] = useState(0.7);
  const [maxImageWidth, setMaxImageWidth] = useState(480);

  // Captured images gallery
  const [capturedImages, setCapturedImages] = useState<BlinkEvent[]>([]);

  // Blink detection hook with capture config
  const {
    blinkCount,
    recentBlinks,
    isEnabled: blinkDetectionEnabled,
    enable: enableBlinkDetection,
    disable: disableBlinkDetection,
    resetCount,
  } = useBlinkDetection(videoTrack, {
    captureOnBlink: captureEnabled,
    cropToFace,
    imageQuality,
    maxImageWidth,
  });

  // Track captured images from recent blinks
  useEffect(() => {
    if (recentBlinks.length > 0) {
      const imagesWithCapture = recentBlinks.filter(b => b.faceImage);
      if (imagesWithCapture.length > 0) {
        setCapturedImages(imagesWithCapture.slice(-5));
      }
    }
  }, [recentBlinks]);

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      setStream(mediaStream);
      setIsStreaming(true);

      const track = mediaStream.getVideoTracks()[0];
      if (track) {
        setVideoTrack(track);
      }
    } catch (error) {
      console.error('Failed to start camera:', error);
      Alert.alert('Camera Error', 'Failed to access camera. Check permissions.');
    }
  }, []);

  const stopCamera = useCallback(async () => {
    if (blinkDetectionEnabled) {
      await disableBlinkDetection();
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream.release();
      setStream(null);
      setVideoTrack(null);
      setIsStreaming(false);
    }
  }, [stream, blinkDetectionEnabled, disableBlinkDetection]);

  const toggleBlinkDetection = useCallback(async () => {
    if (blinkDetectionEnabled) {
      await disableBlinkDetection();
    } else {
      await enableBlinkDetection();
    }
  }, [blinkDetectionEnabled, enableBlinkDetection, disableBlinkDetection]);

  const clearGallery = useCallback(() => {
    setCapturedImages([]);
    resetCount();
  }, [resetCount]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream.release();
      }
    };
  }, []);

  // Value adjustment helpers
  const adjustQuality = (delta: number) => {
    setImageQuality(prev => Math.max(0.1, Math.min(1.0, Math.round((prev + delta) * 10) / 10)));
  };

  const adjustWidth = (delta: number) => {
    setMaxImageWidth(prev => Math.max(100, Math.min(1000, prev + delta)));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Video Preview */}
      <Card style={styles.videoCard}>
        {stream ? (
          <View style={styles.videoWrapper}>
            <RTCView
              streamURL={stream.toURL()}
              style={styles.video}
              objectFit="cover"
              mirror={true}
            />
            {blinkDetectionEnabled && (
              <View style={styles.blinkOverlay}>
                <Text style={styles.blinkCountOverlay}>{blinkCount} blinks</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>📸</Text>
            <Text style={styles.placeholderText}>Start camera to test blink capture</Text>
          </View>
        )}
      </Card>

      {/* Camera Controls */}
      <Card style={styles.controlsCard}>
        <Text style={styles.sectionTitle}>Camera</Text>
        <Button
          title={isStreaming ? 'Stop Camera' : 'Start Camera'}
          onPress={isStreaming ? stopCamera : startCamera}
          variant={isStreaming ? 'danger' : 'primary'}
        />
      </Card>

      {/* Detection Controls */}
      {isStreaming && (
        <Card style={styles.controlsCard}>
          <Text style={styles.sectionTitle}>Blink Detection</Text>
          <View style={styles.buttonColumn}>
            <Button
              title={blinkDetectionEnabled ? 'Disable Detection' : 'Enable Detection'}
              onPress={toggleBlinkDetection}
              variant={blinkDetectionEnabled ? 'secondary' : 'outline'}
            />
            {capturedImages.length > 0 && (
              <Button
                title="Clear Gallery"
                onPress={clearGallery}
                variant="secondary"
              />
            )}
          </View>
        </Card>
      )}

      {/* Capture Configuration */}
      <Card style={styles.configCard}>
        <Text style={styles.sectionTitle}>Capture Configuration</Text>

        {/* Capture On Blink Toggle */}
        <View style={styles.configRow}>
          <Text style={styles.configLabel}>Capture On Blink</Text>
          <Switch
            value={captureEnabled}
            onValueChange={setCaptureEnabled}
            trackColor={{ false: colors.surface, true: colors.primary }}
            thumbColor={captureEnabled ? colors.text : colors.textSecondary}
          />
        </View>

        {/* Crop To Face Toggle */}
        <View style={styles.configRow}>
          <Text style={styles.configLabel}>Crop To Face</Text>
          <Switch
            value={cropToFace}
            onValueChange={setCropToFace}
            trackColor={{ false: colors.surface, true: colors.primary }}
            thumbColor={cropToFace ? colors.text : colors.textSecondary}
          />
        </View>

        {/* Image Quality */}
        <View style={styles.configRow}>
          <Text style={styles.configLabel}>Image Quality</Text>
          <View style={styles.valueControl}>
            <TouchableOpacity
              style={styles.adjustButton}
              onPress={() => adjustQuality(-0.1)}
            >
              <Text style={styles.adjustButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.configValue}>{imageQuality.toFixed(1)}</Text>
            <TouchableOpacity
              style={styles.adjustButton}
              onPress={() => adjustQuality(0.1)}
            >
              <Text style={styles.adjustButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Max Image Width */}
        <View style={styles.configRow}>
          <Text style={styles.configLabel}>Max Width (px)</Text>
          <View style={styles.valueControl}>
            <TouchableOpacity
              style={styles.adjustButton}
              onPress={() => adjustWidth(-50)}
            >
              <Text style={styles.adjustButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.configValue}>{maxImageWidth}</Text>
            <TouchableOpacity
              style={styles.adjustButton}
              onPress={() => adjustWidth(50)}
            >
              <Text style={styles.adjustButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Card>

      {/* Status */}
      <Card style={styles.statusCard}>
        <Text style={styles.sectionTitle}>Status</Text>
        <StatusIndicator
          label="Camera"
          value={isStreaming}
          status={isStreaming ? 'success' : 'info'}
        />
        <StatusIndicator
          label="Detection"
          value={blinkDetectionEnabled}
          status={blinkDetectionEnabled ? 'success' : 'info'}
        />
        <StatusIndicator
          label="Capture Enabled"
          value={captureEnabled}
          status={captureEnabled ? 'success' : 'warning'}
        />
        <StatusIndicator
          label="Total Blinks"
          value={blinkCount}
          status={blinkCount > 0 ? 'success' : 'info'}
        />
        <StatusIndicator
          label="Images Captured"
          value={capturedImages.length}
          status={capturedImages.length > 0 ? 'success' : 'info'}
        />
      </Card>

      {/* Captured Images Gallery */}
      {capturedImages.length > 0 && (
        <Card style={styles.galleryCard}>
          <Text style={styles.sectionTitle}>Captured Images ({capturedImages.length})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gallery}>
            {capturedImages.map((blink, index) => (
              <View key={`${blink.timestamp}-${index}`} style={styles.capturedImageContainer}>
                {blink.faceImage && (
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${blink.faceImage}` }}
                    style={styles.capturedImage}
                    resizeMode="cover"
                  />
                )}
                <View style={styles.imageInfo}>
                  <Text style={styles.imageInfoText}>
                    {blink.eye === 'left' ? '👁️ L' : '👁️ R'}
                  </Text>
                  <Text style={styles.imageInfoText}>
                    #{blink.blinkCount}
                  </Text>
                </View>
                {blink.faceBounds && (
                  <Text style={styles.boundsText}>
                    {Math.round(blink.faceBounds.width)}x{Math.round(blink.faceBounds.height)}
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>
        </Card>
      )}

      {/* Latest Capture Details */}
      {capturedImages.length > 0 && (
        <Card style={styles.detailsCard}>
          <Text style={styles.sectionTitle}>Latest Capture Details</Text>
          {(() => {
            const latest = capturedImages[capturedImages.length - 1];
            const imageSize = latest.faceImage ? Math.round(latest.faceImage.length * 0.75 / 1024) : 0;
            return (
              <View style={styles.detailsContent}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Eye:</Text>
                  <Text style={styles.detailValue}>{latest.eye}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Blink #:</Text>
                  <Text style={styles.detailValue}>{latest.blinkCount}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Image Size:</Text>
                  <Text style={styles.detailValue}>~{imageSize} KB</Text>
                </View>
                {latest.faceBounds && (
                  <>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Face Position:</Text>
                      <Text style={styles.detailValue}>
                        ({Math.round(latest.faceBounds.x)}, {Math.round(latest.faceBounds.y)})
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Face Size:</Text>
                      <Text style={styles.detailValue}>
                        {Math.round(latest.faceBounds.width)} x {Math.round(latest.faceBounds.height)}
                      </Text>
                    </View>
                  </>
                )}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Timestamp:</Text>
                  <Text style={styles.detailValue}>
                    {new Date(latest.timestamp).toLocaleTimeString()}
                  </Text>
                </View>
              </View>
            );
          })()}
        </Card>
      )}

      {/* Info Card */}
      <Card style={styles.infoCard}>
        <Text style={styles.infoTitle}>About Blink Capture</Text>
        <Text style={styles.infoText}>
          This screen tests the blink frame capture feature. When enabled, each blink captures a
          snapshot of the video frame, optionally cropped to the face region.
        </Text>
        <Text style={styles.infoList}>• captureOnBlink: Enable/disable frame capture</Text>
        <Text style={styles.infoList}>• cropToFace: Crop image to face with 15% padding</Text>
        <Text style={styles.infoList}>• imageQuality: JPEG quality (0.1 - 1.0)</Text>
        <Text style={styles.infoList}>• maxImageWidth: Scale down if wider than this</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  videoCard: {
    marginBottom: spacing.md,
    padding: 0,
    overflow: 'hidden',
  },
  videoWrapper: {
    position: 'relative',
  },
  video: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#000',
    borderRadius: borderRadius.lg,
  },
  blinkOverlay: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(0, 217, 255, 0.9)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  blinkCountOverlay: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
  },
  placeholder: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderIcon: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  placeholderText: {
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  controlsCard: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  buttonColumn: {
    gap: spacing.sm,
  },
  configCard: {
    marginBottom: spacing.md,
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  configLabel: {
    color: colors.text,
    fontSize: 14,
  },
  configValue: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
    minWidth: 50,
    textAlign: 'center',
  },
  valueControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  adjustButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  adjustButtonText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  statusCard: {
    marginBottom: spacing.md,
  },
  galleryCard: {
    marginBottom: spacing.md,
  },
  gallery: {
    flexDirection: 'row',
  },
  capturedImageContainer: {
    marginRight: spacing.sm,
    alignItems: 'center',
  },
  capturedImage: {
    width: 120,
    height: 120,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  imageInfo: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  imageInfoText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  boundsText: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  detailsCard: {
    marginBottom: spacing.md,
  },
  detailsContent: {
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  detailLabel: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  detailValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  infoCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceLight,
  },
  infoTitle: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  infoText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  infoList: {
    color: colors.textSecondary,
    fontSize: 14,
    marginLeft: spacing.sm,
    lineHeight: 22,
  },
});
