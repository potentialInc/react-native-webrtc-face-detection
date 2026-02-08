import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    LayoutChangeEvent,
    StyleSheet,
    Text,
    View,
    ViewStyle,
} from 'react-native';

import type {
    Face,
    FaceDetectionOverlayConfig,
    FaceDetectionResult,
} from '../FaceDetection.types';

interface FaceDetectionOverlayProps {
    /**
     * Face detection result from useFaceDetection hook
     */
    detectionResult: FaceDetectionResult | null;

    /**
     * Whether the video is mirrored (typically true for front camera)
     * @default false
     */
    mirror?: boolean;

    /**
     * How the video fits in the view (should match RTCView objectFit)
     * @default 'cover'
     */
    objectFit?: 'contain' | 'cover';

    /**
     * Configuration for overlay appearance and behavior
     */
    config?: FaceDetectionOverlayConfig;

    /**
     * Additional style for the overlay container
     */
    style?: ViewStyle;
}

interface ScaleFactors {
    scale: number;
    offsetX: number;
    offsetY: number;
}

interface AnimatedFaceState {
    faceX: Animated.Value;
    faceY: Animated.Value;
    faceW: Animated.Value;
    faceH: Animated.Value;
    leftEyeX: Animated.Value;
    leftEyeY: Animated.Value;
    rightEyeX: Animated.Value;
    rightEyeY: Animated.Value;
    mouthX: Animated.Value;
    mouthY: Animated.Value;
    mouthW: Animated.Value;
    mouthH: Animated.Value;
    opacity: Animated.Value;
}

const DEFAULT_CONFIG: Required<FaceDetectionOverlayConfig> = {
    showFaceBox: true,
    showEyeBoxes: true,
    showMouthBox: true,
    showHeadPose: false,
    showEyeStatus: false,
    faceBoxColor: '#00FF00',
    eyeBoxColor: '#00AAFF',
    mouthBoxColor: '#FF00FF',
    strokeWidth: 2,
    animationDuration: 100,
    labelColor: '#FFFFFF',
    labelFontSize: 10,
    eyeBoxSize: 30,
    eyeClosedColor: '#FF4444',
    faceBoxBorderRadius: 4,
    eyeBoxBorderRadius: 2,
    mouthBoxBorderRadius: 2,
    labelBackgroundColor: 'rgba(0, 0, 0, 0.6)',
};

function calculateScaleFactors(
    frameWidth: number,
    frameHeight: number,
    viewWidth: number,
    viewHeight: number,
    objectFit: 'contain' | 'cover'
): ScaleFactors {
    if (frameWidth === 0 || frameHeight === 0 || viewWidth === 0 || viewHeight === 0) {
        return { scale: 1, offsetX: 0, offsetY: 0 };
    }

    const frameAspect = frameWidth / frameHeight;
    const viewAspect = viewWidth / viewHeight;

    let scale: number;
    let offsetX = 0;
    let offsetY = 0;

    if (objectFit === 'cover') {
        if (frameAspect < viewAspect) {
            scale = viewWidth / frameWidth;
            offsetY = (viewHeight - frameHeight * scale) / 2;
        } else {
            scale = viewHeight / frameHeight;
            offsetX = (viewWidth - frameWidth * scale) / 2;
        }
    } else {
        if (frameAspect > viewAspect) {
            scale = viewWidth / frameWidth;
            offsetY = (viewHeight - frameHeight * scale) / 2;
        } else {
            scale = viewHeight / frameHeight;
            offsetX = (viewWidth - frameWidth * scale) / 2;
        }
    }

    return { scale, offsetX, offsetY };
}

function createAnimatedFaceState(): AnimatedFaceState {
    return {
        faceX: new Animated.Value(0),
        faceY: new Animated.Value(0),
        faceW: new Animated.Value(0),
        faceH: new Animated.Value(0),
        leftEyeX: new Animated.Value(0),
        leftEyeY: new Animated.Value(0),
        rightEyeX: new Animated.Value(0),
        rightEyeY: new Animated.Value(0),
        mouthX: new Animated.Value(0),
        mouthY: new Animated.Value(0),
        mouthW: new Animated.Value(0),
        mouthH: new Animated.Value(0),
        opacity: new Animated.Value(0),
    };
}

const FaceDetectionOverlay: React.FC<FaceDetectionOverlayProps> = ({
    detectionResult,
    mirror = false,
    objectFit = 'cover',
    config: userConfig,
    style,
}) => {
    const config = useMemo(
        () => {
            return { ...DEFAULT_CONFIG, ...userConfig };
        },
        [ userConfig ]
    );

    const [ viewDimensions, setViewDimensions ] = useState({ width: 0, height: 0 });
    const animatedFacesRef = useRef<Map<number, AnimatedFaceState>>(new Map());
    const [ activeFaceIds, setActiveFaceIds ] = useState<number[]>([]);
    const [ faceDataMap, setFaceDataMap ] = useState<Map<number, Face>>(new Map());

    const onLayout = useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;

        setViewDimensions({ width, height });
    }, []);

    useEffect(() => {
        if (!detectionResult || viewDimensions.width === 0 || viewDimensions.height === 0) {
            // Fade out all faces
            const map = animatedFacesRef.current;
            const animations: Animated.CompositeAnimation[] = [];

            map.forEach(state => {
                animations.push(
                    Animated.timing(state.opacity, {
                        toValue: 0,
                        duration: config.animationDuration,
                        useNativeDriver: false,
                    })
                );
            });

            if (animations.length > 0) {
                Animated.parallel(animations).start(() => {
                    animatedFacesRef.current.clear();
                    setActiveFaceIds([]);
                    setFaceDataMap(new Map());
                });
            }

            return;
        }

        const { faces, frameWidth, frameHeight } = detectionResult;
        const { scale, offsetX, offsetY } = calculateScaleFactors(
            frameWidth,
            frameHeight,
            viewDimensions.width,
            viewDimensions.height,
            objectFit
        );

        const map = animatedFacesRef.current;
        const currentIds = new Set<number>();
        const animations: Animated.CompositeAnimation[] = [];
        const newFaceDataMap = new Map<number, Face>();
        const duration = config.animationDuration;

        for (const face of faces) {
            const id = face.trackingId ?? 0;

            currentIds.add(id);
            newFaceDataMap.set(id, face);

            let state = map.get(id);

            if (!state) {
                state = createAnimatedFaceState();
                map.set(id, state);
            }

            // Map face bounds to view coordinates
            let viewX = face.bounds.x * scale + offsetX;
            const viewY = face.bounds.y * scale + offsetY;
            const viewW = face.bounds.width * scale;
            const viewH = face.bounds.height * scale;

            if (mirror) {
                viewX = viewDimensions.width - viewX - viewW;
            }

            animations.push(
                Animated.parallel([
                    Animated.timing(state.faceX, { toValue: viewX, duration, useNativeDriver: false }),
                    Animated.timing(state.faceY, { toValue: viewY, duration, useNativeDriver: false }),
                    Animated.timing(state.faceW, { toValue: viewW, duration, useNativeDriver: false }),
                    Animated.timing(state.faceH, { toValue: viewH, duration, useNativeDriver: false }),
                    Animated.timing(state.opacity, { toValue: 1, duration, useNativeDriver: false }),
                ])
            );

            // Map eye positions
            const { leftEye, rightEye } = face.landmarks;

            if (leftEye.position.x !== 0 || leftEye.position.y !== 0) {
                let leX = leftEye.position.x * scale + offsetX - (config.eyeBoxSize * scale) / 2;
                const leY = leftEye.position.y * scale + offsetY - (config.eyeBoxSize * scale) / 2;

                if (mirror) {
                    leX = viewDimensions.width - leX - config.eyeBoxSize * scale;
                }

                animations.push(
                    Animated.parallel([
                        Animated.timing(state.leftEyeX, { toValue: leX, duration, useNativeDriver: false }),
                        Animated.timing(state.leftEyeY, { toValue: leY, duration, useNativeDriver: false }),
                    ])
                );
            }

            if (rightEye.position.x !== 0 || rightEye.position.y !== 0) {
                let reX = rightEye.position.x * scale + offsetX - (config.eyeBoxSize * scale) / 2;
                const reY = rightEye.position.y * scale + offsetY - (config.eyeBoxSize * scale) / 2;

                if (mirror) {
                    reX = viewDimensions.width - reX - config.eyeBoxSize * scale;
                }

                animations.push(
                    Animated.parallel([
                        Animated.timing(state.rightEyeX, { toValue: reX, duration, useNativeDriver: false }),
                        Animated.timing(state.rightEyeY, { toValue: reY, duration, useNativeDriver: false }),
                    ])
                );
            }

            // Map mouth position
            const mouth = face.landmarks.mouth;

            if (mouth) {
                const mouthW = mouth.width * scale;
                const mouthH = mouth.height * scale;
                let mouthX = mouth.position.x * scale + offsetX - mouthW / 2;
                const mouthY = mouth.position.y * scale + offsetY - mouthH / 2;

                if (mirror) {
                    mouthX = viewDimensions.width - mouthX - mouthW;
                }

                animations.push(
                    Animated.parallel([
                        Animated.timing(state.mouthX, { toValue: mouthX, duration, useNativeDriver: false }),
                        Animated.timing(state.mouthY, { toValue: mouthY, duration, useNativeDriver: false }),
                        Animated.timing(state.mouthW, { toValue: mouthW, duration, useNativeDriver: false }),
                        Animated.timing(state.mouthH, { toValue: mouthH, duration, useNativeDriver: false }),
                    ])
                );
            }
        }

        // Fade out removed faces
        map.forEach((state, id) => {
            if (!currentIds.has(id)) {
                animations.push(
                    Animated.timing(state.opacity, {
                        toValue: 0,
                        duration,
                        useNativeDriver: false,
                    })
                );
            }
        });

        if (animations.length > 0) {
            Animated.parallel(animations).start(() => {
                // Clean up disappeared faces after fade-out
                map.forEach((_, id) => {
                    if (!currentIds.has(id)) {
                        map.delete(id);
                    }
                });
            });
        }

        setActiveFaceIds(Array.from(currentIds));
        setFaceDataMap(newFaceDataMap);
    }, [ detectionResult, viewDimensions, mirror, objectFit, config.animationDuration, config.eyeBoxSize ]);

    const scaleFactors = useMemo(() => {
        if (!detectionResult) {
            return { scale: 1, offsetX: 0, offsetY: 0 };
        }

        return calculateScaleFactors(
            detectionResult.frameWidth,
            detectionResult.frameHeight,
            viewDimensions.width,
            viewDimensions.height,
            objectFit
        );
    }, [ detectionResult, viewDimensions, objectFit ]);

    const eyeBoxScaledSize = config.eyeBoxSize * scaleFactors.scale;

    return (
        <View
            style={[ styles.container, style ]}
            pointerEvents="none"
            onLayout={onLayout}
        >
            {activeFaceIds.map(id => {
                const state = animatedFacesRef.current.get(id);
                const face = faceDataMap.get(id);

                if (!state || !face) {
                    return null;
                }

                const hasLeftEyePos =
                    face.landmarks.leftEye.position.x !== 0 ||
                    face.landmarks.leftEye.position.y !== 0;
                const hasRightEyePos =
                    face.landmarks.rightEye.position.x !== 0 ||
                    face.landmarks.rightEye.position.y !== 0;

                return (
                    <Animated.View key={id} style={{ opacity: state.opacity }}>
                        {/* Face bounding box */}
                        {config.showFaceBox && (
                            <Animated.View
                                style={[
                                    styles.box,
                                    {
                                        borderColor: config.faceBoxColor,
                                        borderWidth: config.strokeWidth,
                                        left: state.faceX,
                                        top: state.faceY,
                                        width: state.faceW,
                                        height: state.faceH,
                                        borderRadius: config.faceBoxBorderRadius,
                                    },
                                ]}
                            >
                                {/* Head pose label */}
                                {config.showHeadPose && face.headPose && (
                                    <View style={styles.labelContainer}>
                                        <Text
                                            style={[
                                                styles.label,
                                                {
                                                    color: config.labelColor,
                                                    fontSize: config.labelFontSize,
                                                    backgroundColor:
                                                        config.labelBackgroundColor,
                                                },
                                            ]}
                                        >
                                            {`Y:${face.headPose.yaw.toFixed(1)}°`
                                                + ` P:${face.headPose.pitch.toFixed(1)}°`
                                                + ` R:${face.headPose.roll.toFixed(1)}°`}
                                        </Text>
                                    </View>
                                )}

                                {/* Eye status label */}
                                {config.showEyeStatus && (
                                    <View style={styles.eyeStatusContainer}>
                                        <Text
                                            style={[
                                                styles.label,
                                                {
                                                    color: config.labelColor,
                                                    fontSize: config.labelFontSize,
                                                    backgroundColor:
                                                        config.labelBackgroundColor,
                                                },
                                            ]}
                                        >
                                            {`L:${face.landmarks.leftEye.isOpen ? 'Open' : 'Closed'}`
                                                + ` R:${face.landmarks.rightEye.isOpen ? 'Open' : 'Closed'}`}
                                        </Text>
                                    </View>
                                )}
                            </Animated.View>
                        )}

                        {/* Left eye box */}
                        {config.showEyeBoxes && hasLeftEyePos && (
                            <Animated.View
                                style={[
                                    styles.box,
                                    {
                                        borderColor: face.landmarks.leftEye.isOpen
                                            ? config.eyeBoxColor
                                            : config.eyeClosedColor,
                                        borderWidth: config.strokeWidth,
                                        left: state.leftEyeX,
                                        top: state.leftEyeY,
                                        width: eyeBoxScaledSize,
                                        height: eyeBoxScaledSize,
                                        borderRadius: config.eyeBoxBorderRadius
                                            * scaleFactors.scale,
                                    },
                                ]}
                            />
                        )}

                        {/* Right eye box */}
                        {config.showEyeBoxes && hasRightEyePos && (
                            <Animated.View
                                style={[
                                    styles.box,
                                    {
                                        borderColor: face.landmarks.rightEye.isOpen
                                            ? config.eyeBoxColor
                                            : config.eyeClosedColor,
                                        borderWidth: config.strokeWidth,
                                        left: state.rightEyeX,
                                        top: state.rightEyeY,
                                        width: eyeBoxScaledSize,
                                        height: eyeBoxScaledSize,
                                        borderRadius: config.eyeBoxBorderRadius
                                            * scaleFactors.scale,
                                    },
                                ]}
                            />
                        )}

                        {/* Mouth box */}
                        {config.showMouthBox && face.landmarks.mouth && (
                            <Animated.View
                                style={[
                                    styles.box,
                                    {
                                        borderColor: config.mouthBoxColor,
                                        borderWidth: config.strokeWidth,
                                        left: state.mouthX,
                                        top: state.mouthY,
                                        width: state.mouthW,
                                        height: state.mouthH,
                                        borderRadius: config.mouthBoxBorderRadius,
                                    },
                                ]}
                            />
                        )}
                    </Animated.View>
                );
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    box: {
        position: 'absolute',
        backgroundColor: 'transparent',
    },
    labelContainer: {
        position: 'absolute',
        top: -20,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    eyeStatusContainer: {
        position: 'absolute',
        bottom: -18,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    label: {
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: 2,
        overflow: 'hidden',
    },
});

export default FaceDetectionOverlay;
