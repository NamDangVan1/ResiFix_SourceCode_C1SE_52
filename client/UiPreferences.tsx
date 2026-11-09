import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ComponentProps, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator as NativeActivityIndicator,
  Platform,
  SafeAreaView as NativeSafeAreaView,
  ScrollView as NativeScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  TouchableOpacity as NativeTouchableOpacity,
  View as NativeView,
} from 'react-native';
import { AppLocale, translateUiText } from './translations';

export type ThemeMode = 'light' | 'dark';

interface UiPreferencesValue {
  themeMode: ThemeMode;
  locale: AppLocale;
  setThemeMode: (mode: ThemeMode) => void;
  setLocale: (locale: AppLocale) => void;
  t: (value: string) => string;
}

const THEME_STORAGE_KEY = 'resifix.ui.theme';
const LOCALE_STORAGE_KEY = 'resifix.ui.locale';

const UiPreferencesContext = createContext<UiPreferencesValue | null>(null);

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('light');
  const [locale, setLocaleState] = useState<AppLocale>('vi');
  const themeWasChanged = useRef(false);
  const localeWasChanged = useRef(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.multiGet([THEME_STORAGE_KEY, LOCALE_STORAGE_KEY])
      .then((entries) => {
        if (!mounted) return;
        const storedTheme = entries[0]?.[1];
        const storedLocale = entries[1]?.[1];
        if (!themeWasChanged.current && (storedTheme === 'light' || storedTheme === 'dark')) {
          setThemeModeState(storedTheme);
        }
        if (!localeWasChanged.current && (storedLocale === 'vi' || storedLocale === 'en')) {
          setLocaleState(storedLocale);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const setThemeMode = useCallback((nextMode: ThemeMode) => {
    themeWasChanged.current = true;
    setThemeModeState(nextMode);
    void AsyncStorage.setItem(THEME_STORAGE_KEY, nextMode).catch(() => undefined);
  }, []);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    localeWasChanged.current = true;
    setLocaleState(nextLocale);
    void AsyncStorage.setItem(LOCALE_STORAGE_KEY, nextLocale).catch(() => undefined);
  }, []);

  const t = useCallback((value: string) => translateUiText(value, locale), [locale]);

  const value = useMemo(
    () => ({ themeMode, locale, setThemeMode, setLocale, t }),
    [themeMode, locale, setThemeMode, setLocale, t]
  );

  return <UiPreferencesContext.Provider value={value}>{children}</UiPreferencesContext.Provider>;
}

export function useUiPreferences(): UiPreferencesValue {
  const value = useContext(UiPreferencesContext);
  if (!value) throw new Error('useUiPreferences must be used within UiPreferencesProvider');
  return value;
}

const darkBackgrounds: Record<string, string> = {
  '#FFFFFF': '#111827',
  '#F8FAFC': '#0B1220',
  '#F1F5F9': '#1F2937',
  '#E2E8F0': '#334155',
  '#CBD5E1': '#475569',
  '#EFF6FF': '#172554',
  '#DBEAFE': '#1E3A5F',
  '#E0E7FF': '#27204B',
  '#E9D5FF': '#342040',
  '#EEF2FF': '#27204B',
  '#BFDBFE': '#1E3A5F',
  '#ECFDF5': '#12382A',
  '#D1FAE5': '#12382A',
  '#DCFCE7': '#12382A',
  '#CCFBF1': '#123B3A',
  '#FEF2F2': '#3A2028',
  '#FEE2E2': '#3A2028',
  '#FEF3C7': '#3A2D17',
  '#FFFBEB': '#3A2D17',
  '#FFEDD5': '#3A2617',
  '#FAF5FF': '#342040',
};

const darkTextColors: Record<string, string> = {
  '#0F172A': '#F8FAFC',
  '#1E293B': '#F1F5F9',
  '#334155': '#E2E8F0',
  '#475569': '#CBD5E1',
  '#64748B': '#94A3B8',
  '#047857': '#34D399',
  '#059669': '#34D399',
  '#15803D': '#4ADE80',
  '#1D4ED8': '#60A5FA',
  '#1D61E7': '#60A5FA',
  '#4338CA': '#A5B4FC',
  '#4F46E5': '#A5B4FC',
  '#7E22CE': '#C084FC',
  '#B45309': '#FBBF24',
  '#C2410C': '#FB923C',
  '#D97706': '#FBBF24',
  '#DC2626': '#F87171',
  '#EA580C': '#FB923C',
  '#EF4444': '#F87171',
  '#F59E0B': '#FBBF24',
  '#10B981': '#34D399',
  '#16A34A': '#4ADE80',
};

const darkBorders: Record<string, string> = {
  ...darkBackgrounds,
  '#DBEAFE': '#274060',
  '#E0E7FF': '#3A3564',
  '#E9D5FF': '#573A73',
  '#BFDBFE': '#35557A',
  '#D1FAE5': '#24533F',
};

function darkColor(value: unknown, property: string): unknown {
  if (typeof value !== 'string') return value;
  const color = value.toUpperCase();
  if (property === 'backgroundColor' && darkBackgrounds[color]) return darkBackgrounds[color];
  if (property.toLowerCase().includes('border') && property.toLowerCase().includes('color')) {
    if (darkBorders[color]) return darkBorders[color];
  }
  if (property === 'color' && darkTextColors[color]) return darkTextColors[color];
  if (property === 'shadowColor') return '#000000';

  const match = color.match(/^#([0-9A-F]{3}|[0-9A-F]{6})$/);
  if (!match) return value;

  const hex = match[1].length === 3 ? [...match[1]].map((part) => part + part).join('') : match[1];
  const channels = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const [red, green, blue] = channels;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  if (property === 'color' && luminance < 0.48) {
    return `#${channels
      .map((channel) => Math.round(channel + (255 - channel) * 0.76).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  if (
    property === 'backgroundColor' &&
    luminance > 0.64 &&
    Math.max(...channels) - Math.min(...channels) < 18
  ) {
    return '#1F2937';
  }
  if (property.toLowerCase().includes('border') && property.toLowerCase().includes('color')) {
    if (luminance > 0.64) return '#334155';
  }

  return value;
}

function themedStyle<T>(style: T, themeMode: ThemeMode): T {
  if (themeMode === 'light' || style == null) return style;

  const flattened = StyleSheet.flatten(style as never) as Record<string, unknown> | undefined;
  if (!flattened) return style;

  const next = { ...flattened };
  for (const [property, value] of Object.entries(next)) {
    next[property] = darkColor(value, property);
  }
  return next as T;
}

export function UiText(props: ComponentProps<typeof NativeText>) {
  const { themeMode } = useUiPreferences();
  const style = themedStyle(props.style, themeMode);
  return (
    <NativeText
      {...props}
      style={themeMode === 'dark' ? [{ color: '#F1F5F9' }, style] : style}
    />
  );
}

export function UiView(props: ComponentProps<typeof NativeView>) {
  const { themeMode } = useUiPreferences();
  return <NativeView {...props} style={themedStyle(props.style, themeMode)} />;
}

export function UiTextInput(props: ComponentProps<typeof NativeTextInput>) {
  const { themeMode } = useUiPreferences();
  const webInputReset = Platform.OS === 'web' ? ({ outlineWidth: 0 } as any) : null;
  return (
    <NativeTextInput
      {...props}
      style={[
        webInputReset,
        themeMode === 'dark'
          ? [{ color: '#F1F5F9' }, themedStyle(props.style, themeMode)]
          : props.style,
      ]}
      placeholderTextColor={
        themeMode === 'dark'
          ? (darkColor(props.placeholderTextColor, 'color') as string | undefined)
          : props.placeholderTextColor
      }
    />
  );
}

export function UiTouchableOpacity(props: ComponentProps<typeof NativeTouchableOpacity>) {
  const { themeMode } = useUiPreferences();
  const webCursor = Platform.OS === 'web' ? ({ cursor: 'pointer', transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)' } as any) : null;
  return (
    <NativeTouchableOpacity
      activeOpacity={props.activeOpacity ?? 0.78}
      {...props}
      style={[webCursor, themedStyle(props.style, themeMode)]}
    />
  );
}

export function UiScrollView(props: ComponentProps<typeof NativeScrollView>) {
  const { themeMode } = useUiPreferences();
  return (
    <NativeScrollView
      {...props}
      style={themedStyle(props.style, themeMode)}
      contentContainerStyle={themedStyle(props.contentContainerStyle, themeMode)}
    />
  );
}

export function UiSafeAreaView(props: ComponentProps<typeof NativeSafeAreaView>) {
  const { themeMode } = useUiPreferences();
  return <NativeSafeAreaView {...props} style={themedStyle(props.style, themeMode)} />;
}

export function UiActivityIndicator(props: ComponentProps<typeof NativeActivityIndicator>) {
  const { themeMode } = useUiPreferences();
  return (
    <NativeActivityIndicator
      {...props}
      color={
        themeMode === 'dark'
          ? (darkColor(props.color, 'color') as string | undefined)
          : props.color
      }
    />
  );
}

export function UiStatusBar(props: ComponentProps<typeof NativeStatusBar>) {
  const { themeMode } = useUiPreferences();
  const barStyle =
    themeMode === 'dark' && props.barStyle === 'dark-content'
      ? 'light-content'
      : themeMode === 'dark' && props.barStyle === 'light-content'
        ? 'dark-content'
        : props.barStyle;
  return <NativeStatusBar {...props} barStyle={barStyle} />;
}

export function PreferenceControls({ compact = false }: { compact?: boolean }) {
  const { themeMode, locale, setThemeMode, setLocale, t } = useUiPreferences();
  const isDark = themeMode === 'dark';

  const optionStyle = (selected: boolean) => ({
    backgroundColor: selected ? (isDark ? '#1E3A5F' : '#EFF6FF') : isDark ? '#111827' : '#FFFFFF',
    borderColor: selected ? '#2563EB' : isDark ? '#475569' : '#CBD5E1',
  });
  const optionTextStyle = (selected: boolean) => ({
    color: selected ? (isDark ? '#BFDBFE' : '#1D4ED8') : isDark ? '#E2E8F0' : '#334155',
  });

  return (
    <NativeView
      style={[
        preferenceStyles.card,
        compact && preferenceStyles.compactCard,
        {
          backgroundColor: isDark ? '#111827' : '#FFFFFF',
          borderColor: isDark ? '#334155' : '#E2E8F0',
        },
      ]}
    >
      <NativeView style={preferenceStyles.row}>
        <NativeText style={[preferenceStyles.label, { color: isDark ? '#CBD5E1' : '#475569' }]}>
          {t('Giao diện')}
        </NativeText>
        <NativeView style={preferenceStyles.options}>
          {(['light', 'dark'] as const).map((mode) => {
            const selected = themeMode === mode;
            return (
              <NativeTouchableOpacity
                key={mode}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setThemeMode(mode)}
                style={[preferenceStyles.option, optionStyle(selected)]}
              >
                <NativeText style={[preferenceStyles.optionText, optionTextStyle(selected)]}>
                  {mode === 'light' ? `☀ ${t('Sáng')}` : `☾ ${t('Tối')}`}
                </NativeText>
              </NativeTouchableOpacity>
            );
          })}
        </NativeView>
      </NativeView>

      <NativeView style={preferenceStyles.row}>
        <NativeText style={[preferenceStyles.label, { color: isDark ? '#CBD5E1' : '#475569' }]}>
          {t('Ngôn ngữ')}
        </NativeText>
        <NativeView style={preferenceStyles.options}>
          {(['vi', 'en'] as const).map((nextLocale) => {
            const selected = locale === nextLocale;
            return (
              <NativeTouchableOpacity
                key={nextLocale}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setLocale(nextLocale)}
                style={[preferenceStyles.option, optionStyle(selected)]}
              >
                <NativeText style={[preferenceStyles.optionText, optionTextStyle(selected)]}>
                  {nextLocale === 'vi' ? `🇻🇳 ${t('Tiếng Việt')}` : `🇬🇧 ${t('English')}`}
                </NativeText>
              </NativeTouchableOpacity>
            );
          })}
        </NativeView>
      </NativeView>
    </NativeView>
  );
}

const preferenceStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    gap: 12,
  },
  compactCard: {
    marginTop: 12,
    padding: 10,
    gap: 10,
  },
  row: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
  options: {
    flexDirection: 'row',
    gap: 6,
  },
  option: {
    minHeight: 34,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  optionText: {
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
  },
});
