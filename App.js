import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_IP,
  DEFAULT_PORT,
  buildPanicUrl,
  normalizeIp,
  normalizePort,
} from './lib/panic';

const STORE_IP = '@panic/ip';
const STORE_PORT = '@panic/port';
const DOUBLE_TAP_MS = 350;

const RED = '#e10600';
const BLACK = '#000000';

export default function App() {
  const [ip, setIp] = useState(DEFAULT_IP);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [draftIp, setDraftIp] = useState(DEFAULT_IP);
  const [draftPort, setDraftPort] = useState(DEFAULT_PORT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // armed (red) = ready, black = fired / sleeping. Double-tap black to re-arm.
  const [armed, setArmed] = useState(true);
  const lastTap = useRef(0);
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

  const onScreenTap = useCallback(() => {
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
    Keyboard.dismiss();
    setSettingsOpen(false);
  }, [draftIp, draftPort]);

  const resetSettings = useCallback(() => {
    setDraftIp(DEFAULT_IP);
    setDraftPort(DEFAULT_PORT);
  }, []);

  return (
    <View style={[styles.fill, { backgroundColor: armed ? RED : BLACK }]}>
      <StatusBar style="light" />
      {/* settings cog - sits above the color field */}
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
        accessibilityLabel={armed ? 'Fire panic routine' : 'Double tap to re-arm'}
        accessibilityRole="button"
        onPress={onScreenTap}
        style={styles.fill}
      />

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
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearText: { color: '#fff', fontSize: 24, opacity: 0.9 },
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
