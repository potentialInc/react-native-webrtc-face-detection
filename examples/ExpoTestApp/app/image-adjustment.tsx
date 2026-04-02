import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import {
  mediaDevices,
  RTCView,
  MediaStream,
  MediaStreamTrack,
  useImageAdjustment,
} from 'react-native-webrtc';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { SliderControl } from '@/components/SliderControl';
import { StatusIndicator } from '@/components/StatusIndicator';
import { colors, spacing, borderRadius } from '@/constants/theme';

interface Preset {
  name: string;
  config: {
    exposure: number;
    contrast: number;
    saturation: number;
    colorTemperature: number;
  };
}

const PRESETS: Preset[] = [
  { name: 'Normal', config: { exposure: 0, contrast: 1, saturation: 1, colorTemperature: 0 } },
  { name: 'Warm', config: { exposure: 0.1, contrast: 1.1, saturation: 1.2, colorTemperature: 0.4 } },
  { name: 'Cool', config: { exposure: 0, contrast: 1.1, saturation: 0.9, colorTemperature: -0.3 } },
  { name: 'Vivid', config: { exposure: 0.1, contrast: 1.4, saturation: 1.8, colorTemperature: 0.1 } },
  { name: 'Noir', config: { exposure: -0.1, contrast: 1.6, saturation: 0, colorTemperature: 0 } },
  { name: 'Bright', config: { exposure: 0.4, contrast: 0.9, saturation: 1.1, colorTemperature: 0.1 } },
];

export default function ImageAdjustmentScreen() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activePreset, setActivePreset] = useState<string>('Normal');

  const {
    config,
    isEnabled,
    enable,
    disable,
    updateConfig,
    setExposure,
    setContrast,
    setSaturation,
    setColorTemperature,
    error,
  } = useImageAdjustment(videoTrack);

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
    } catch (err) {
      console.error('Failed to start camera:', err);
      Alert.alert('Camera Error', 'Failed to access camera. Check permissions.');
    }
  }, []);

  const stopCamera = useCallback(async () => {
    if (isEnabled) {
      await disable();
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream.release();
      setStream(null);
      setVideoTrack(null);
      setIsStreaming(false);
    }
  }, [stream, isEnabled, disable]);

  const toggleAdjustment = useCallback(async () => {
    if (isEnabled) {
      await disable();
    } else {
      await enable();
    }
  }, [isEnabled, enable, disable]);

  const applyPreset = useCallback(async (preset: Preset) => {
    setActivePreset(preset.name);
    await updateConfig(preset.config);
  }, [updateConfig]);

  const resetToDefaults = useCallback(async () => {
    setActivePreset('Normal');
    await updateConfig({
      exposure: 0,
      contrast: 1,
      saturation: 1,
      colorTemperature: 0,
    });
  }, [updateConfig]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream.release();
      }
    };
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Video Preview */}
      <Card style={styles.videoCard}>
        {stream ? (
          <RTCView
            streamURL={stream.toURL()}
            style={styles.video}
            objectFit="cover"
            mirror={true}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>🎨</Text>
            <Text style={styles.placeholderText}>
              Start camera to test image adjustments
            </Text>
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

      {/* Adjustment Toggle */}
      {isStreaming && (
        <Card style={styles.controlsCard}>
          <Text style={styles.sectionTitle}>Image Adjustment</Text>
          <Button
            title={isEnabled ? 'Disable Adjustments' : 'Enable Adjustments'}
            onPress={toggleAdjustment}
            variant={isEnabled ? 'secondary' : 'outline'}
          />
          {error && (
            <Text style={styles.errorText}>{error.message}</Text>
          )}
        </Card>
      )}

      {/* Sliders */}
      {isEnabled && (
        <Card style={styles.controlsCard}>
          <Text style={styles.sectionTitle}>Controls</Text>

          <SliderControl
            label="Exposure"
            value={config.exposure}
            onValueChange={setExposure}
            minimumValue={-1}
            maximumValue={1}
          />

          <SliderControl
            label="Contrast"
            value={config.contrast}
            onValueChange={setContrast}
            minimumValue={0}
            maximumValue={3}
          />

          <SliderControl
            label="Saturation"
            value={config.saturation}
            onValueChange={setSaturation}
            minimumValue={0}
            maximumValue={3}
          />

          <SliderControl
            label="Color Temperature"
            value={config.colorTemperature}
            onValueChange={setColorTemperature}
            minimumValue={-1}
            maximumValue={1}
            minimumTrackColor="#4488ff"
            maximumTrackColor="#ff8844"
          />

          <Button
            title="Reset to Defaults"
            onPress={resetToDefaults}
            variant="secondary"
          />
        </Card>
      )}

      {/* Presets */}
      {isEnabled && (
        <Card style={styles.controlsCard}>
          <Text style={styles.sectionTitle}>Presets</Text>
          <View style={styles.presetGrid}>
            {PRESETS.map(preset => (
              <Button
                key={preset.name}
                title={preset.name}
                onPress={() => applyPreset(preset)}
                variant={activePreset === preset.name ? 'primary' : 'outline'}
                style={styles.presetButton}
              />
            ))}
          </View>
        </Card>
      )}

      {/* Status */}
      <Card style={styles.statusCard}>
        <Text style={styles.sectionTitle}>Status</Text>
        <StatusIndicator
          label="Camera"
          value={isStreaming}
          status={isStreaming ? 'success' : 'info'}
        />
        <StatusIndicator
          label="Image Adjustment"
          value={isEnabled}
          status={isEnabled ? 'success' : 'info'}
        />
        {isEnabled && (
          <>
            <StatusIndicator
              label="Exposure"
              value={config.exposure.toFixed(2)}
              status={config.exposure !== 0 ? 'warning' : 'info'}
            />
            <StatusIndicator
              label="Contrast"
              value={config.contrast.toFixed(2)}
              status={config.contrast !== 1 ? 'warning' : 'info'}
            />
            <StatusIndicator
              label="Saturation"
              value={config.saturation.toFixed(2)}
              status={config.saturation !== 1 ? 'warning' : 'info'}
            />
            <StatusIndicator
              label="Color Temp"
              value={config.colorTemperature.toFixed(2)}
              status={config.colorTemperature !== 0 ? 'warning' : 'info'}
            />
          </>
        )}
      </Card>

      {/* Info Card */}
      <Card style={styles.infoCard}>
        <Text style={styles.infoTitle}>About Image Adjustment</Text>
        <Text style={styles.infoText}>
          This screen demonstrates the image adjustment capabilities of react-native-webrtc.
          Adjustments are applied in real-time using pre-computed lookup tables
          on the I420 (YUV) video frames:
        </Text>
        <Text style={styles.infoList}>
          {'\u2022'} Exposure - Adjusts overall brightness (Y plane)
        </Text>
        <Text style={styles.infoList}>
          {'\u2022'} Contrast - Controls tonal range (Y plane)
        </Text>
        <Text style={styles.infoList}>
          {'\u2022'} Saturation - Color intensity (U/V planes)
        </Text>
        <Text style={styles.infoList}>
          {'\u2022'} Color Temperature - Warm/cool color shift (U/V planes)
        </Text>
        <Text style={styles.infoList}>
          {'\u2022'} No peer connection required - works as standalone camera viewer
        </Text>
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
  video: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#000',
    borderRadius: borderRadius.lg,
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
  errorText: {
    color: colors.error,
    fontSize: 14,
    marginTop: spacing.sm,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  presetButton: {
    minWidth: '30%',
    flexGrow: 1,
  },
  statusCard: {
    marginBottom: spacing.md,
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
