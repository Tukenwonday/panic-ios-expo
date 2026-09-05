import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import {
  useAudioStream,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_IP,
  DEFAULT_PORT,
  STORE_MIC_MODE,
  buildPanicUrl,
  buildMicUrl,
  normalizeIp,
  normalizePort,
} from './lib/panic';

const STORE_IP = '@panic/ip';
const STORE_PORT = '@panic/port';
const DOUBLE_TAP_MS = 350;

const RED = '#e10600';
const BLACK = '#000000';
const BLUE_IDLE = '#0052cc';
const BLUE_STREAMING = '#002f87';
const BLUE_CONNECTING = '#0040a8';

/* Minimalist native microphone icon */
function MicIcon({ size = 72, color = '#ffffff', active = false }) {
  const capsuleW = size * 0.38;
  const capsuleH = size * 0.62;
  const cradleW = size * 0.64;
  const cradleH = size * 0.42;

  return (
    <View style={{ width: size, height: size * 1.15, alignItems: 'center', justifyContent: 'center' }}>
      {/* Microphone Capsule */}
      <View
        style={{
          width: capsuleW,
          height: capsuleH,
          borderRadius: capsuleW / 2,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
          shadowColor: active ? '#00d4ff' : '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: active ? 0.9 : 0.3,
          shadowRadius: active ? 16 : 6,
        }}
      >
        <View style={{ width: capsuleW * 0.55, height: 2, backgroundColor: 'rgba(0,0,0,0.25)', marginBottom: 4 }} />
        <View style={{ width: capsuleW * 0.55, height: 2, backgroundColor: 'rgba(0,0,0,0.25)' }} />
      </View>

      {/* U-shaped Cradle */}
      <View
        style={{
          position: 'absolute',
          top: capsuleH * 0.44,
          width: cradleW,
          height: cradleH,
          borderBottomLeftRadius: cradleW / 2,
          borderBottomRightRadius: cradleW / 2,
          borderWidth: 3.5,
          borderColor: color,
          borderTopWidth: 0,
          zIndex: 1,
        }}
      />

      {/* Vertical Stem */}
      <View
        style={{
          position: 'absolute',
          top: capsuleH * 0.44 + cradleH - 1,
          width: 3.5,
          height: size * 0.2,
          backgroundColor: color,
        }}
      />

      {/* Horizontal Base */}
      <View
        style={{
          position: 'absolute',
          top: capsuleH * 0.44 + cradleH + size * 0.18 - 1,
          width: size * 0.45,
          height: 3.5,
          borderRadius: 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export default function App() {
  const [ip, setIp] = useState(DEFAULT_IP);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [draftIp, setDraftIp] = useState(DEFAULT_IP);
  const [draftPort, setDraftPort] = useState(DEFAULT_PORT);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Mode: Panic Button vs Wireless Mic Mode
  const [micMode, setMicMode] = useState(false);
  const [draftMicMode, setDraftMicMode] = useState(false);

  // Panic mode: armed (red) = ready, black = fired / sleeping. Double-tap black to re-arm.
  const [armed, setArmed] = useState(true);
  const lastTap = useRef(0);
  const abortRef = useRef(null);

  // Mic mode state: 'idle' | 'connecting' | 'streaming' | 'error'
  const [micStatus, setMicStatus] = useState('idle');
  const [micError, setMicError] = useState('');
  const wsRef = useRef(null);
  const isStreamingRef = useRef(false);

  /* expo-audio real-time PCM stream (16 kHz mono int16 → matches C++ miniaudio) */
  const { stream: audioStream } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: 'int16',
    onBuffer: (buffer) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && buffer.data?.byteLength > 0) {
        wsRef.current.send(buffer.data);
      }
    },
  });

  // Pulse animation for active streaming halo
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    (async () => {
      try {
        const [sIp, sPort, sMicMode] = await Promise.all([
          AsyncStorage.getItem(STORE_IP),
          AsyncStorage.getItem(STORE_PORT),
          AsyncStorage.getItem(STORE_MIC_MODE),
        ]);
        if (sIp) {
          setIp(sIp);
          setDraftIp(sIp);
        }
        if (sPort) {
          setPort(sPort);
          setDraftPort(sPort);
        }
        if (sMicMode !== null) {
          const isMic = sMicMode === '1';
          setMicMode(isMic);
          setDraftMicMode(isMic);
        }
      } catch {
        // keep defaults
      }
    })();

    return () => {
      try {
        abortRef.current?.abort();
      } catch {}
      stopMicStreaming();
    };
  }, []);

  // Pulse animation controller
  useEffect(() => {
    let anim;
    if (micStatus === 'streaming') {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 650,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 650,
            useNativeDriver: true,
          }),
        ])
      );
      anim.start();
    } else {
      pulseAnim.setValue(1);
    }
    return () => anim?.stop();
  }, [micStatus, pulseAnim]);

  /* ===================================================================
   * Panic Button Logic (POST to /panic)
   * =================================================================== */
  const fire = useCallback(async () => {
    const url = buildPanicUrl(ip, port);
    lastTap.current = 0;
    setArmed(false); // turn black immediately, then execute
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {}
    try {
      abortRef.current?.abort();
    } catch {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t = setTimeout(() => {
      try {
        ctrl.abort();
      } catch {}
    }, 7000);
    try {
      const res = await fetch(url, { method: 'POST', signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!text.includes('Panic routine')) throw new Error('Unexpected reply');
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } catch {
      // failed: go back to red so black always means "executed"
      setArmed(true);
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}
    } finally {
      clearTimeout(t);
    }
  }, [ip, port]);

  const rearm = useCallback(async () => {
    lastTap.current = 0;
    setArmed(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
  }, []);

  const onPanicScreenTap = useCallback(() => {
    if (armed) {
      fire();
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      rearm();
    } else {
      lastTap.current = now;
    }
  }, [armed, fire, rearm]);

  /* ===================================================================
   * Wireless Microphone Streaming Logic (WebSocket to ws://<IP>:<PORT>/mic)
   * =================================================================== */
  const stopMicStreaming = useCallback(() => {
    isStreamingRef.current = false;

    // Stop native audio stream
    try {
      audioStream?.stop();
    } catch {}

    // Close WebSocket
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    setMicStatus('idle');
  }, [audioStream]);

  /* Audio streaming is now handled by the useAudioStream onBuffer callback.
   * When streaming, each PCM buffer is sent directly over the WebSocket
   * without writing to files. Much lower latency than the old approach. */

  const startMicStreaming = useCallback(async () => {
    setMicError('');
    setMicStatus('connecting');

    try {
      // 1. Request microphone permission
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setMicError('Microphone permission denied');
        setMicStatus('error');
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } catch {}
        return;
      }

      // 2. Configure audio mode for recording on iOS
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
      });

      // 3. Open WebSocket connection
      const wsUrl = buildMicUrl(ip, port);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = async () => {
        setMicStatus('streaming');
        isStreamingRef.current = true;
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}
        // Start the native real-time PCM audio stream
        try {
          await audioStream.start();
        } catch (e) {
          console.warn('AudioStream start error:', e);
          setMicError('Failed to start audio capture');
          setMicStatus('error');
          stopMicStreaming();
        }
      };

      ws.onerror = (err) => {
        console.warn('WebSocket connection error:', err);
        setMicError('Connection to PC failed');
        setMicStatus('error');
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } catch {}
        stopMicStreaming();
      };

      ws.onclose = () => {
        if (isStreamingRef.current) {
          stopMicStreaming();
        }
      };
    } catch (err) {
      console.warn('Mic start error:', err);
      setMicError('Failed to start microphone');
      setMicStatus('error');
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}
      stopMicStreaming();
    }
  }, [ip, port, audioStream, stopMicStreaming]);

  const onMicScreenTap = useCallback(async () => {
    if (micStatus === 'streaming' || micStatus === 'connecting') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
      await stopMicStreaming();
    } else {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } catch {}
      await startMicStreaming();
    }
  }, [micStatus, startMicStreaming, stopMicStreaming]);

  /* ===================================================================
   * Settings Modal Handlers
   * =================================================================== */
  const saveSettings = useCallback(async () => {
    const cleanIp = normalizeIp(draftIp);
    const cleanPort = normalizePort(draftPort);
    setIp(cleanIp);
    setPort(cleanPort);
    setDraftIp(cleanIp);
    setDraftPort(cleanPort);

    // If switching out of mic mode, stop any active stream
    if (!draftMicMode && micMode) {
      await stopMicStreaming();
    }
    setMicMode(draftMicMode);

    try {
      await Promise.all([
        AsyncStorage.setItem(STORE_IP, cleanIp),
        AsyncStorage.setItem(STORE_PORT, cleanPort),
        AsyncStorage.setItem(STORE_MIC_MODE, draftMicMode ? '1' : '0'),
      ]);
    } catch {}
    Keyboard.dismiss();
    setSettingsOpen(false);
  }, [draftIp, draftPort, draftMicMode, micMode, stopMicStreaming]);

  const resetSettings = useCallback(() => {
    setDraftIp(DEFAULT_IP);
    setDraftPort(DEFAULT_PORT);
    setDraftMicMode(false);
  }, []);

  // Determine active background color
  const getBackgroundColor = () => {
    if (!micMode) {
      return armed ? RED : BLACK;
    }
    switch (micStatus) {
      case 'streaming':
        return BLUE_STREAMING;
      case 'connecting':
        return BLUE_CONNECTING;
      case 'error':
        return '#1b263b';
      default:
        return BLUE_IDLE;
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: getBackgroundColor() }]}>
      <StatusBar style="light" />

      {/* Settings cog - sits above the button */}
      <Pressable
        accessibilityLabel="Open settings"
        onPress={() => {
          setDraftIp(ip);
          setDraftPort(port);
          setDraftMicMode(micMode);
          setSettingsOpen(true);
        }}
        style={styles.gear}
        hitSlop={16}
      >
        <Text style={styles.gearText}>⚙</Text>
      </Pressable>

      {/* Mode Banner / Indicator in Panic Mode or Mic Mode */}
      {micMode ? (
        /* ================= Full-Screen Blue MIC Button ================= */
        <Pressable
          accessibilityLabel={
            micStatus === 'streaming'
              ? 'Microphone active, tap to stop streaming'
              : 'Tap to stream microphone audio to PC'
          }
          accessibilityRole="button"
          onPress={onMicScreenTap}
          style={styles.micButtonContainer}
        >
          {/* Animated Halo Ring when streaming */}
          {micStatus === 'streaming' && (
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  transform: [{ scale: pulseAnim }],
                  opacity: pulseAnim.interpolate({
                    inputRange: [1, 1.25],
                    outputRange: [0.6, 0.05],
                  }),
                },
              ]}
            />
          )}

          {/* Central Mic Visual */}
          <View style={styles.micCenterContent}>
            {micStatus === 'connecting' ? (
              <ActivityIndicator size="large" color="#ffffff" style={styles.micSpinner} />
            ) : (
              <MicIcon size={84} color="#ffffff" active={micStatus === 'streaming'} />
            )}

            <Text style={styles.micTitle}>
              {micStatus === 'streaming'
                ? 'LIVE STREAMING'
                : micStatus === 'connecting'
                ? 'CONNECTING...'
                : micStatus === 'error'
                ? 'CONNECTION FAILED'
                : 'MIC TO PC'}
            </Text>

            <Text style={styles.micSubtitle}>
              {micStatus === 'streaming'
                ? 'Tap anywhere to stop'
                : micStatus === 'connecting'
                ? `Connecting to ${ip}:${port}...`
                : micStatus === 'error'
                ? micError || 'Tap to retry'
                : 'Tap anywhere to stream audio'}
            </Text>

            {/* Target endpoint pill */}
            <View style={styles.endpointBadge}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      micStatus === 'streaming'
                        ? '#00e676'
                        : micStatus === 'connecting'
                        ? '#ffea00'
                        : micStatus === 'error'
                        ? '#ff1744'
                        : '#ffffff',
                  },
                ]}
              />
              <Text style={styles.endpointText}>{buildMicUrl(ip, port)}</Text>
            </View>
          </View>
        </Pressable>
      ) : (
        /* ================= Full-Screen Red PANIC Button ================= */
        <Pressable
          accessibilityLabel={armed ? 'Fire panic routine' : 'Double tap to re-arm'}
          accessibilityRole="button"
          onPress={onPanicScreenTap}
          style={styles.fill}
        />
      )}

      {/* Settings Modal */}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSettingsOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>App Settings</Text>

            {/* Mode Toggle Row */}
            <View style={styles.switchRow}>
              <View style={styles.switchTextContainer}>
                <Text style={styles.switchLabel}>Enable Wireless Mic Mode</Text>
                <Text style={styles.switchDescription}>
                  {draftMicMode
                    ? 'Mic button connects to PC via WebSocket'
                    : 'Red button sends HTTP panic trigger'}
                </Text>
              </View>
              <Switch
                value={draftMicMode}
                onValueChange={setDraftMicMode}
                trackColor={{ false: '#3a3a3c', true: '#0052cc' }}
                thumbColor={draftMicMode ? '#ffffff' : '#e0e0e0'}
                ios_backgroundColor="#3a3a3c"
              />
            </View>

            <View style={styles.divider} />

            <Text style={styles.label}>PC IP address</Text>
            <TextInput
              value={draftIp}
              onChangeText={setDraftIp}
              placeholder={DEFAULT_IP}
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              returnKeyType="next"
              style={styles.input}
            />

            <Text style={styles.label}>Port</Text>
            <TextInput
              value={draftPort}
              onChangeText={setDraftPort}
              placeholder={DEFAULT_PORT}
              placeholderTextColor="#888"
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={saveSettings}
              style={styles.input}
            />

            {/* Target URL Preview */}
            <Text style={styles.label}>Target Endpoint</Text>
            <Text style={styles.preview}>
              {draftMicMode ? buildMicUrl(draftIp, draftPort) : buildPanicUrl(draftIp, draftPort)}
            </Text>

            <View style={styles.row}>
              <Pressable onPress={resetSettings} style={[styles.btn, styles.btnGhost]}>
                <Text style={styles.btnGhostText}>Reset</Text>
              </Pressable>
              <Pressable onPress={() => setSettingsOpen(false)} style={[styles.btn, styles.btnGhost]}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveSettings}
                style={[styles.btn, draftMicMode ? styles.btnBlue : styles.btnRed]}
              >
                <Text style={styles.btnActionText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gear: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  gearText: { color: '#fff', fontSize: 24, opacity: 0.95 },

  /* Mic Screen Styles */
  micButtonContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micCenterContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  micSpinner: {
    marginBottom: 20,
    transform: [{ scale: 1.5 }],
  },
  pulseRing: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(0, 212, 255, 0.45)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  micTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 28,
    textAlign: 'center',
  },
  micSubtitle: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  endpointBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  endpointText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  /* Settings Modal Styles */
  sheetWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#16181d',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 38,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sheetTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 16 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  switchTextContainer: {
    flex: 1,
    paddingRight: 12,
  },
  switchLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  switchDescription: {
    color: '#8e8e93',
    fontSize: 13,
    marginTop: 3,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 14,
  },
  label: { color: '#a0a0a5', fontSize: 13, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: '#22252c',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  preview: {
    color: '#60a5fa',
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    fontSize: 14,
    fontWeight: '600',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 22 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnGhost: { backgroundColor: '#2a2d36' },
  btnGhostText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnRed: { backgroundColor: '#e10600' },
  btnBlue: { backgroundColor: '#0052cc' },
  btnActionText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
