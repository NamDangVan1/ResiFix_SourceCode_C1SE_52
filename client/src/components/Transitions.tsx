import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useUiPreferences, themedStyle } from '../context/UiPreferences';

// ============================================================================
// HẰNG SỐ CẤU HÌNH CHUYỂN ĐỘNG PREMIUM ANIMATION 3.0 (UNIVERSAL EDITION)
// Chuẩn chuyển động: Smooth, Elegant, Soft, Natural, Responsive
// Chậm hơn nhẹ 15–20% so với thông thường nhưng phản hồi tức thì, không gây lag.
// ============================================================================
export const MOTION_TIMINGS = {
  BUTTON_PRESS_MS: 165, // 140–210ms
  SCREEN_TRANSITION_MS: 360, // 310–450ms
  MODAL_TRANSITION_MS: 370, // 330–450ms
  CARD_ENTRANCE_MS: 450, // 410–560ms
  CARD_STAGGER_MS: 75, // 60–95ms
  SIDEBAR_INDICATOR_MS: 320, // 280–380ms
  INPUT_FOCUS_MS: 220, // 180–260ms
  TIMELINE_NODE_MS: 400, // 350–450ms
  TECH_STEP_MS: 320, // 280–380ms
};

export const CINEMATIC_EASING = Easing.bezier(0.22, 1, 0.36, 1);

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      }
    );

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reduceMotion;
}

export interface ScreenTransitionProps {
  transitionKey: string | number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
  type?: 'fade-slide' | 'fade-scale' | 'fade';
  direction?: 'up' | 'right' | 'down' | 'none';
}

/**
 * ScreenTransition: Chuyển cảnh màn hình mượt mà cho Resident, Technician và BMB Web.
 * - Thời gian: 310–450ms (mặc định 360ms) với đường cong cubic-bezier tự nhiên.
 * - Tôn trọng Accessibility Reduce Motion.
 * - Chỉ kích hoạt khi transitionKey thay đổi, bảo toàn hoàn toàn state dữ liệu.
 */
export function ScreenTransition({
  transitionKey,
  children,
  style,
  duration = MOTION_TIMINGS.SCREEN_TRANSITION_MS,
  type = 'fade-slide',
  direction = 'up',
}: ScreenTransitionProps) {
  const { themeMode } = useUiPreferences();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }

    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration,
      easing: CINEMATIC_EASING,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [anim, transitionKey, duration, reduceMotion]);

  const opacity = anim;
  const transform: any[] = [];

  if (!reduceMotion) {
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
      } else if (direction === 'down') {
        transform.push({
          translateY: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [-10, 0],
          }),
        });
      }
    } else if (type === 'fade-scale') {
      transform.push({
        scale: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.97, 1],
        }),
      });
    }
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
 * AnimatedModalContent: Hiệu ứng Fade + Scale nhẹ (0.97 -> 1) + TranslateY (10 -> 0)
 * khi mở Modal (330–450ms, mặc định 370ms). Tự động theo ThemeMode và Reduce Motion.
 */
export function AnimatedModalContent({
  visible,
  children,
  style,
  duration = MOTION_TIMINGS.MODAL_TRANSITION_MS,
}: {
  visible: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
}) {
  const { themeMode } = useUiPreferences();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      if (reduceMotion) {
        anim.setValue(1);
        return;
      }
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration,
        easing: CINEMATIC_EASING,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    }
  }, [anim, visible, duration, reduceMotion]);

  const opacity = anim;
  const scale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.97, 1],
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
          transform: reduceMotion ? undefined : [{ scale }, { translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * StaggeredCardEntrance: Hiệu ứng xuất hiện tuần tự cho danh sách thẻ và KPI (410–560ms, stagger 60–95ms).
 * Giới hạn tối đa 6 phần tử stagger để không làm chậm màn hình.
 */
export function StaggeredCardEntrance({
  index = 0,
  children,
  style,
  duration = MOTION_TIMINGS.CARD_ENTRANCE_MS,
  staggerMs = MOTION_TIMINGS.CARD_STAGGER_MS,
}: {
  index?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
  staggerMs?: number;
}) {
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    const delay = Math.min(index, 6) * staggerMs;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration,
      delay,
      easing: CINEMATIC_EASING,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [anim, index, duration, staggerMs, reduceMotion]);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: reduceMotion ? undefined : [{ translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * TimelineNodeEntrance: Hiệu ứng xuất hiện cho từng mốc trong Hành trình sự cố (350–450ms, mặc định 400ms).
 */
export function TimelineNodeEntrance({
  index = 0,
  children,
  style,
  duration = MOTION_TIMINGS.TIMELINE_NODE_MS,
}: {
  index?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
}) {
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration,
      delay: Math.min(index, 5) * 60,
      easing: CINEMATIC_EASING,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [anim, index, duration, reduceMotion]);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [6, 0],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: reduceMotion ? undefined : [{ translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * ActiveMilestonePulse: Hiệu ứng thở nhẹ nhàng, cao cấp (Apple-like breathing) cho mốc đang hoạt động trên Timeline.
 * Chu kỳ êm dịu, không giật, không gây mỏi mắt.
 */
export function ActiveMilestonePulse({
  children,
  active = true,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active || reduceMotion) {
      scale.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(scale, {
          toValue: 1.0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    animation.start();

    return () => {
      animation.stop();
      scale.setValue(1);
    };
  }, [active, reduceMotion, scale]);

  return (
    <Animated.View style={{ transform: reduceMotion || !active ? undefined : [{ scale }] }}>
      {children}
    </Animated.View>
  );
}

/**
 * CollapsibleDrawer: Ngăn kéo thu gọn / mở rộng mượt mà cho các mục phụ
 * (Trợ lý AI, Checklist, Chi phí, Dòng thời gian) trong chi tiết sự cố và bước KTV.
 */
export function CollapsibleDrawer({
  expanded,
  children,
  duration = 300,
  style,
}: {
  expanded: boolean;
  children: React.ReactNode;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const [shouldRender, setShouldRender] = useState(expanded);
  const anim = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    if (expanded) {
      setShouldRender(true);
      if (reduceMotion) {
        anim.setValue(1);
        return;
      }
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration,
        easing: CINEMATIC_EASING,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    } else {
      if (reduceMotion) {
        anim.setValue(0);
        setShouldRender(false);
        return;
      }
      Animated.timing(anim, {
        toValue: 0,
        duration: Math.round(duration * 0.7),
        easing: Easing.out(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }).start(({ finished }) => {
        if (finished) setShouldRender(false);
      });
    }
  }, [expanded, duration, reduceMotion, anim]);

  if (!shouldRender) return null;

  const opacity = anim;
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-8, 0],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity,
          transform: reduceMotion ? undefined : [{ translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * AnimatedBadgeEntrance: Hiệu ứng xuất hiện mượt mà cho nhãn trạng thái và biểu tượng hoàn thành.
 */
export function AnimatedBadgeEntrance({
  children,
  style,
  delay = 0,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 320,
      delay,
      easing: CINEMATIC_EASING,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [anim, delay, reduceMotion]);

  const scale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: reduceMotion ? undefined : [{ scale }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * AnimatedPressableButton: Nút bấm phản hồi vi tương tác êm ái (140–210ms, mặc định 165ms).
 */
export function AnimatedPressableButton({
  children,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: PressableProps & { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: any) => {
    if (!reduceMotion) {
      Animated.timing(scale, {
        toValue: 0.98,
        duration: MOTION_TIMINGS.BUTTON_PRESS_MS,
        easing: CINEMATIC_EASING,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    }
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    if (!reduceMotion) {
      Animated.timing(scale, {
        toValue: 1,
        duration: MOTION_TIMINGS.BUTTON_PRESS_MS,
        easing: CINEMATIC_EASING,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    }
    onPressOut?.(e);
  };

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} {...rest}>
      <Animated.View style={[style, reduceMotion ? undefined : { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
