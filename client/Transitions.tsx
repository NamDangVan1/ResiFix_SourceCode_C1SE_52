import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleProp,
  ViewStyle,
} from 'react-native';

export interface ScreenTransitionProps {
  transitionKey: string | number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
  type?: 'fade-slide' | 'fade-scale' | 'fade';
  direction?: 'up' | 'right' | 'down' | 'none';
}

/**
 * ScreenTransition: Component chuyển cảnh dùng chung cho Resident, Technician và BMB Web.
 * - Fade In + Translate nhẹ (180-220ms).
 * - Sử dụng Animated API chuẩn của React Native (tương thích 100% Android + Web).
 * - KHÔNG re-run animation khi người dùng nhập dữ liệu hoặc cập nhật state nội bộ trong cùng màn hình (dựa vào transitionKey).
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
  const anim = useRef(new Animated.Value(0)).current;
  const prevKey = useRef(transitionKey);

  useEffect(() => {
    // Chỉ kích hoạt animation khi transitionKey thực sự thay đổi
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
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

  return (
    <Animated.View
      style={[
        { flex: 1 },
        style,
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
 * AnimatedModalContent: Hiệu ứng Fade + Scale nhẹ nhàng khi mở Modal (220ms),
 * mang lại cảm giác mượt mà chuẩn Enterprise SaaS thay vì giật cục.
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
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
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
    outputRange: [12, 0],
  });

  return (
    <Animated.View
      style={[
        style,
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

