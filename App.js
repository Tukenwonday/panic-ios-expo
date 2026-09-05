import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_IP,
  DEFAULT_PORT,
  SUCCESS_MARKER,
  buildPanicUrl,
  normalizeIp,
  normalizePort,
} from './lib/panic';

const STORE_IP = '@panic/ip';
const STORE_PORT = '@panic/port';

export default function App() {
  const [ip, setIp] = useState(DEFAULT_IP);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [draftIp, setDraftIp] = useState(DEFAULT_IP);
  const [draftPort, setDraftPort] = useState(DEFAULT_PORT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | sending | success | error
  const [message, setMessage] = useState('Tap anywhere to trigger');
  const scale = useRef(new Animated.Value(1)).current;
  const abortRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [sIp, sPort] = await Promise.all([
          AsyncStorage.getItem(STORE_IP),
          AsyncStorage.getItem(STORE_PORT),
        ]);
        if (sIp) {
          setIp(sIp);
          setDraftIp(sIp);
        }
        if (sPort) {
          setPort(sPort);
          setDraftPort(sPort);
        }
      } catch {
        // keep defaults
      }
    })();
    return () => {
      try {
        abortRef.current?.abort();
      } catch {}
    };
  }, []);

  const pressIn = useCallback(() => {
    Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 40 }).start();
  }, [scale]);

  const pressOut = useCallback(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }).start();
  }, [scale]);

  const fire = useCallback(async () => {
    if (phase === 'sending') return;
    const url = buildPanicUrl(ip, port);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {}
    setPhase('sending');
    setMessage(`Sending to ${url}…`);
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
      setPhase('success');
      setMessage(SUCCESS_MARKER);
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } catch (e) {
      const msg =
        e?.name === 'AbortError'
          ? 'Timed out — same Wi-Fi? Server running?'
          : 'Unreachable — same Wi-Fi? IP correct? Port 8080 open?';
      setPhase('error');
      setMessage(msg);
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}
    } finally {
      clearTimeout(t);
    }
  }, [ip, port, phase]);

  const saveSettings = useCallback(async () => {
    const cleanIp = normalizeIp(draftIp);
    const cleanPort = normalizePort(draftPort);
    setIp(cleanIp);
    setPort(cleanPort);
    setDraftIp(cleanIp);
    setDraftPort(cleanPort);
    try {
      await Promise.all([
        AsyncStorage.setItem(STORE_IP, cleanIp),
        AsyncStorage.setItem(STORE_PORT, cleanPort),
      ]);
    } catch {}
    setPhase('idle');
    setMessage('Tap anywhere to trigger');
    setSettingsOpen(false);
  }, [draftIp, draftPort]);

  const resetSettings = useCallback(() => {
    setDraftIp(DEFAULT_IP);
    setDraftPort(DEFAULT_PORT);
  }, []);

  const urlPreview = buildPanicUrl(ip, port);
  const isSending = phase === 'sending';

  return (
    <LinearGradient
      colors={phase === 'success' ? ['#0d7a3f', '#063d20'] : phase === 'error' ? ['#7a0d0d', '#3d0606'] : ['#ff2b2b', '#8f0000']}
      style={styles.fill}
    >
      <StatusBar style="light" />
      {/* settings cog - sits above the big button */}
      <Pressable
        accessibilityLabel="Open settings"
        onPress={() => {
          setDraftIp(ip);
          setDraftPort(port);
          setSettingsOpen(true);
        }}
        style={styles.gear}
        hitSlop={16}
      >
        <Text style={styles.gearText}>⚙</Text>
      </Pressable>

      {/* the whole screen IS the button */}
      <Pressable
        accessibilityLabel="Panic button. Activates panic routine on your PC."
        accessibilityRole="button"
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={fire}
        disabled={isSending}
        style={styles.fill}
      >
        <Animated.View style={[styles.center, { transform: [{ scale }] }]}>
          <Text style={styles.kicker}>MYSCRIPT • REMOTE</Text>
          <Text style={styles.panic}>PANIC</Text>
          <Text style={styles.url}>{urlPreview}</Text>
          <View style={styles.pill}>
            {isSending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.pillText}>
                {phase === 'success' ? '✓ ' : phase === 'error' ? '✕ ' : '● '}
                {message}
              </Text>
            )}
          </View>
          <Text style={styles.hint}>Same Wi-Fi as PC • Server must show Running</Text>
        </Animated.View>
      </Pressable>

      <Modal visible={settingsOpen} animationType="slide" transparent onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Panic server</Text>
            <Text style={styles.label}>PC IP address</Text>
            <TextInput
              value={draftIp}
              onChangeText={setDraftIp}
              placeholder={DEFAULT_IP}
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              style={styles.input}
            />
            <Text style={styles.label}>Port</Text>
            <TextInput
              value={draftPort}
              onChangeText={setDraftPort}
              placeholder={DEFAULT_PORT}
              placeholderTextColor="#888"
              keyboardType="number-pad"
              style={styles.input}
            />
            <Text style={styles.preview}>{buildPanicUrl(draftIp, draftPort)}</Text>
            <View style={styles.row}>
              <Pressable onPress={resetSettings} style={[styles.btn, styles.btnGhost]}>
                <Text style={styles.btnGhostText}>Reset</Text>
              </Pressable>
              <Pressable onPress={() => setSettingsOpen(false)} style={[styles.btn, styles.btnGhost]}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveSettings} style={[styles.btn, styles.btnRed]}>
                <Text style={styles.btnRedText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  kicker: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 4,
    marginBottom: 8,
  },
  panic: {
    color: '#fff',
    fontSize: 84,
    fontWeight: '900',
    letterSpacing: 6,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 6 },
    textShadowRadius: 18,
  },
  url: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: '600',
  },
  pill: {
    marginTop: 22,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    maxWidth: '100%',
  },
  pillText: { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  hint: {
    marginTop: 14,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    textAlign: 'center',
  },
  gear: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearText: { color: '#fff', fontSize: 24 },
  sheetWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#151515',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  sheetTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  label: { color: '#bbb', fontSize: 13, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: '#222',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: '600',
  },
  preview: { color: '#8ab4ff', marginTop: 12, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnGhost: { backgroundColor: '#2a2a2a' },
  btnGhostText: { color: '#fff', fontWeight: '700' },
  btnRed: { backgroundColor: '#e10600' },
  btnRedText: { color: '#fff', fontWeight: '800' },
});
