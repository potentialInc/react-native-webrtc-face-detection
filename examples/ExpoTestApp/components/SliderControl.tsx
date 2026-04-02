import { useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
import { colors, spacing, borderRadius } from '@/constants/theme';

interface SliderControlProps {
  label: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  step?: number;
  onValueChange: (value: number) => void;
  minimumTrackColor?: string;
  maximumTrackColor?: string;
}

export function SliderControl({
  label,
  value,
  minimumValue,
  maximumValue,
  step = 0.05,
  onValueChange,
  minimumTrackColor = colors.primary,
  maximumTrackColor = colors.surfaceLight,
}: SliderControlProps) {
  const trackWidth = useRef(0);
  const [localValue, setLocalValue] = useState(value);

  const clampAndStep = useCallback((raw: number) => {
    const clamped = Math.max(minimumValue, Math.min(maximumValue, raw));
    return Math.round(clamped / step) * step;
  }, [minimumValue, maximumValue, step]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const ratio = x / trackWidth.current;
        const newValue = clampAndStep(minimumValue + ratio * (maximumValue - minimumValue));
        setLocalValue(newValue);
        onValueChange(newValue);
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const ratio = x / trackWidth.current;
        const newValue = clampAndStep(minimumValue + ratio * (maximumValue - minimumValue));
        setLocalValue(newValue);
        onValueChange(newValue);
      },
    })
  ).current;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    trackWidth.current = e.nativeEvent.layout.width;
  }, []);

  const displayValue = typeof value === 'number' ? value : localValue;
  const ratio = (displayValue - minimumValue) / (maximumValue - minimumValue);
  const percentage = Math.max(0, Math.min(100, ratio * 100));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{displayValue.toFixed(2)}</Text>
      </View>
      <View
        style={styles.trackContainer}
        onLayout={onLayout}
        {...panResponder.panHandlers}
      >
        <View style={[styles.track, { backgroundColor: maximumTrackColor }]}>
          <View
            style={[
              styles.filledTrack,
              { width: `${percentage}%`, backgroundColor: minimumTrackColor },
            ]}
          />
        </View>
        <View style={[styles.thumb, { left: `${percentage}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  value: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  trackContainer: {
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  filledTrack: {
    height: '100%',
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    marginLeft: -12 + 12, // offset by paddingHorizontal
    top: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
});
