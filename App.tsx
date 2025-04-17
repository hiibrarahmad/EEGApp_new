// App.tsx
import {decode as atob, encode as btoa} from 'base-64';

// Polyfill atob/btoa
global.atob = global.atob || atob;
global.btoa = global.btoa || btoa;

import React, {useState, useEffect, useRef} from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  PermissionsAndroid,
  Platform,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import {BleManager, Device, Characteristic} from 'react-native-ble-plx';
import {LineChart} from 'react-native-chart-kit';

const UART_SERVICE = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const UART_CHAR_RX = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
const MAX_HISTORY = 100;

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231'];

const App: React.FC = () => {
  const manager = useRef(new BleManager()).current;
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connected, setConnected] = useState<Device | null>(null);
  const [sequence, setSequence] = useState(0);
  const [channels, setChannels] = useState<number[]>([0, 0, 0, 0]);
  const [histories, setHistories] = useState<number[][]>([[], [], [], []]);
  const [count, setCount] = useState(0);
  const [paused, setPaused] = useState(false);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (Platform.OS === 'android' && Platform.Version >= 23) {
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    }
  }, []);

  const startScan = () => {
    setDevices([]);
    setScanning(true);
    manager.startDeviceScan([UART_SERVICE], null, (error, dev) => {
      if (error) {
        console.warn(error);
        setScanning(false);
        return;
      }
      if (dev?.name) {
        setDevices(ds => (ds.some(d => d.id === dev.id) ? ds : [...ds, dev]));
      }
    });
    setTimeout(() => {
      manager.stopDeviceScan();
      setScanning(false);
    }, 5000);
  };

  const connectAndMonitor = async (device: Device) => {
    try {
      const d = await manager.connectToDevice(device.id);
      await d.discoverAllServicesAndCharacteristics();
      setConnected(d);

      startTimeRef.current = Date.now();
      setCount(0);
      setHistories([[], [], [], []]);

      d.monitorCharacteristicForService(UART_SERVICE, UART_CHAR_RX, (_err, char) => {
        if (!char?.value) return;
        const raw = Uint8Array.from(atob(char.value), c => c.charCodeAt(0));
        const dv = new DataView(raw.buffer);
        const seq = dv.getUint16(0, true);
        const chans: number[] = [];
        for (let i = 0; i < 4; i++) {
          chans.push(dv.getFloat32(2 + i * 4, true));
        }
        setSequence(seq);
        setChannels(chans);
        if (!paused) {
          setHistories(hs =>
            hs.map((h, i) => {
              const next = [...h, chans[i]];
              if (next.length > MAX_HISTORY) next.shift();
              return next;
            })
          );
        }
        setCount(c => c + 1);
      });
    } catch (e: any) {
      Alert.alert('Connection error', e.message);
    }
  };

  const disconnectDevice = async () => {
    if (connected) {
      await manager.cancelDeviceConnection(connected.id);
      setConnected(null);
      setHistories([[], [], [], []]);
      setSequence(0);
      setCount(0);
    }
  };

  const clearData = () => {
    startTimeRef.current = Date.now();
    setCount(0);
    setHistories([[], [], [], []]);
  };

  const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
  const speed = elapsedSec > 0 ? count / elapsedSec : 0;
  const screenWidth = Dimensions.get('window').width - 40;
  const hasCombinedData = histories.some(h => h.length > 1);

  if (!connected) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.header}>EEGApp • BLE Monitor</Text>
        <TouchableOpacity style={styles.scanButton} onPress={startScan} disabled={scanning}>
          {scanning ? <ActivityIndicator color="#fff" /> : <Text style={styles.scanText}>🔍 Scan Devices</Text>}
        </TouchableOpacity>
        <FlatList
          data={devices}
          keyExtractor={i => i.id}
          renderItem={({item}) => (
            <TouchableOpacity style={styles.deviceItem} onPress={() => connectAndMonitor(item)}>
              <Text style={styles.deviceName}>{item.name}</Text>
              <Text style={styles.deviceId}>{item.id}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={!scanning && <Text style={styles.empty}>No devices found</Text>}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Connected: {connected.name}</Text>
      <View style={styles.infoRow}>
        <Text style={styles.info}>Seq: {sequence}</Text>
        <Text style={styles.info}>Speed: {speed.toFixed(1)} seg/s</Text>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.btn} onPress={() => setPaused(!paused)}>
          <Text style={styles.btnText}>{paused ? '▶️ Resume' : '⏸ Pause'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={clearData}>
          <Text style={styles.btnText}>🗑 Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={disconnectDevice}>
          <Text style={styles.btnText}>🔌 Disconnect</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll}>
        {/* Combined chart */}
        <Text style={styles.chartTitle}>Combined Channels</Text>
        {hasCombinedData ? (
          <LineChart
            data={{
              datasets: histories.map((hist, i) => ({
                data: hist,
                color: () => COLORS[i],
                strokeWidth: 2,
              })),
            }}
            width={screenWidth}
            height={220}
            withDots={false}
            withInnerLines={false}
            withOuterLines={false}
            chartConfig={{
              backgroundGradientFrom: '#fff',
              backgroundGradientTo: '#fff',
              decimalPlaces: 2,
              propsForBackgroundLines: {stroke: '#eee'},
              color: opacity => `rgba(0,0,0,${opacity})`,
            }}
            style={styles.combinedChart}
          />
        ) : (
          <Text style={styles.waiting}>Waiting for data…</Text>
        )}

        {/* Individual trends */}
        {histories.map((hist, i) => {
          const hasData = hist.length > 1;
          return (
            <View key={i} style={styles.singleChartBlock}>
              <Text style={styles.chartTitle}>Channel {i + 1}</Text>
              {hasData ? (
                <LineChart
                  data={{datasets: [{data: hist, color: () => COLORS[i]}]}}
                  width={screenWidth}
                  height={120}
                  withDots={false}
                  withInnerLines={false}
                  withOuterLines={false}
                  chartConfig={{
                    backgroundGradientFrom: '#f4f6fc',
                    backgroundGradientTo: '#f4f6fc',
                    decimalPlaces: 2,
                    color: () => COLORS[i],
                    propsForBackgroundLines: {stroke: '#eee'},
                  }}
                  style={styles.singleChart}
                />
              ) : (
                <Text style={styles.waiting}>Waiting for data…</Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#f0f4f8'},
  header: {fontSize: 22, fontWeight: '700', textAlign: 'center', margin: 16},
  scanButton: {
    backgroundColor: '#5568f6',
    marginHorizontal: 40,
    padding: 12,
    borderRadius: 24,
    alignItems: 'center',
  },
  scanText: {color: '#fff', fontSize: 16},
  empty: {textAlign: 'center', marginTop: 24, color: '#666'},
  deviceItem: {padding: 12, marginHorizontal: 20, borderBottomWidth: 1, borderColor: '#dde3ea'},
  deviceName: {fontSize: 16, fontWeight: '500'},
  deviceId: {fontSize: 12, color: '#888'},
  infoRow: {flexDirection: 'row', justifyContent: 'space-around', marginVertical: 12},
  info: {fontSize: 16, fontWeight: '600'},
  buttonRow: {flexDirection: 'row', justifyContent: 'space-around', marginVertical: 8},
  btn: {backgroundColor: '#fff', padding: 10, borderRadius: 20, elevation: 2},
  btnText: {fontSize: 14, fontWeight: '600'},
  scroll: {flex: 1, paddingHorizontal: 20},
  chartTitle: {fontSize: 16, fontWeight: '600', marginBottom: 6, textAlign: 'center'},
  combinedChart: {borderRadius: 12, backgroundColor: '#fff', marginBottom: 24},
  singleChartBlock: {marginBottom: 20},
  singleChart: {borderRadius: 8, backgroundColor: '#fff'},
  waiting: {textAlign: 'center', color: '#666', marginVertical: 12},
});

export default App;
