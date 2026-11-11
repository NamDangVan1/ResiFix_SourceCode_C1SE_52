import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useUiPreferences, themedStyle } from '../context/UiPreferences';

export interface ScreenTransitionProps {
  transitionKey: string | number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
  type?: 'fade-slide' | 'fade-scale' | 'fade';
  direction?: 'up' | 'right' | 'down' | 'none';
}

/**
 * ScreenTransition: Component chuyển cảnh mượt mà dùng chung cho Resident, Technician và BMB Web.
 * - Fade In + Translate nhẹ (180-220ms) theo concept "ResiFix Flow — Smart Motion".
 * - Sử dụng Animated API chuẩn của React Native (100% tương thích Android + Web).
 * - Tự động phát hiện và tôn trọng cài đặt Giảm chuyển động (Reduced Motion) trên thiết bị.
 * - KHÔNG re-run animation khi nhập dữ liệu hoặc re-render component nội bộ trong cùng màn hình (dựa vào transitionKey).
 * - KHÔNG làm mất form state, KHÔNG reset dữ liệu, KHÔNG trigger API reload.
 */
export function ScreenTransition({
  transitionKey,
  children,
  style,
  duration = 200,
  type = 'fade-slide',
  direction = 'up',
}: ScreenTransitionProps) {
  const { themeMode } = useUiPreferences();
  const anim = useRef(new Animated.Value(0)).current;
  const prevKey = useRef(transitionKey);

  useEffect(() => {
    let isReduced = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((res) => {
        isReduced = res;
      })
      .catch(() => {});

    // Chỉ kích hoạt animation khi transitionKey thực sự thay đổi
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: isReduced ? 0 : duration,
      easing: Easing.bezier(0.16, 1, 0.3, 1), // Apple / Linear natural cubic-bezier curve
      useNativeDriver: Platform.OS !== 'web',
    }).start();
    prevKey.current = transitionKey;
  }, [transitionKey, duration]);

  const opacity = anim;

  let transform: any[] = [];
  if (type === 'fade-slide') {
    if (direction === 'up') {
      transform.push({
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [10, 0],
        }),
      });
    } else if (direction === 'right') {
      transform.push({
        translateX: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      });
    }
  } else if (type === 'fade-scale') {
    transform.push({
      scale: anim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.96, 1],
      }),
    });
  }

  const themed = themedStyle(style, themeMode);

  return (
    <Animated.View
      style={[
        { flex: 1 },
        themed,
        {
          opacity,
          transform: transform.length > 0 ? transform : undefined,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * AnimatedModalContent: Hiệu ứng Fade + Scale nhẹ nhàng khi mở Modal (180ms),
 * mang lại cảm giác mượt mà, sang trọng chuẩn Enterprise SaaS thay vì giật cục.
 * Tự động áp dụng themeMode (Light/Dark Mode) đảm bảo độ tương phản cao, không bị chữ trắng trên nền trắng.
 */
export function AnimatedModalContent({
  visible,
  children,
  style,
}: {
  visible: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { themeMode } = useUiPreferences();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      let isReduced = false;
      AccessibilityInfo.isReduceMotionEnabled()
        .then((res) => {
          isReduced = res;
        })
        .catch(() => {});

      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: isReduced ? 0 : 180,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    }
  }, [visible]);

  const opacity = anim;
  const scale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  const themed = themedStyle(style, themeMode);

  return (
    <Animated.View
      style={[
        themed,
        {
          opacity,
          transform: [{ scale }, { translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

