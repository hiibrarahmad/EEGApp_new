// App.tsx
import {decode as atob, encode as btoa} from 'base-64';

// Polyfill atob/btoa
if (typeof global.atob !== 'function') global.atob = atob;
if (typeof global.btoa !== 'function') global.btoa = btoa;

import React, {useState, useEffect, useRef} from 'react';
import {
  SafeAreaView,
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
const MAX_HISTORY = 50;

const App: React.FC = () => {
  const manager = useRef(new BleManager()).current;
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connected, setConnected] = useState<Device | null>(null);
  const [sequence, setSequence] = useState(0);
  const [channels, setChannels] = useState<number[]>([0, 0, 0, 0]);
  const [history, setHistory] = useState<number[]>([]);
  const [count, setCount] = useState(0);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (Platform.OS === 'android' && Platform.Version >= 23) {
      PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
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
        setDevices(ds =>
          ds.some(d => d.id === dev.id) ? ds : [...ds, dev]
        );
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

      // reset metrics
      startTimeRef.current = Date.now();
      setCount(0);
      setHistory([]);

      d.monitorCharacteristicForService(
        UART_SERVICE,
        UART_CHAR_RX,
        (_err, char: Characteristic | null) => {
          if (!char?.value) return;
          const raw = Uint8Array.from(
            atob(char.value),
            c => c.charCodeAt(0)
          );
          const dv = new DataView(raw.buffer);
          const seq = dv.getUint16(0, true);
          const chans: number[] = [];
          for (let i = 0; i < 4; i++) {
            chans.push(dv.getFloat32(2 + i * 4, true));
          }

          setSequence(seq);
          setChannels(chans);
          setHistory(h => {
            const next = [...h, chans[0]];
            if (next.length > MAX_HISTORY) next.shift();
            return next;
          });
          setCount(c => c + 1);
        }
      );
    } catch (e: any) {
      Alert.alert('Connection error', e.message);
    }
  };

  const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
  const speed = elapsedSec > 0 ? count / elapsedSec : 0;
  const screenWidth = Dimensions.get('window').width - 40;
  const hasData = history.length > 1;

  if (!connected) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Scan for EEG BLE (Niura)…</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={startScan}
          disabled={scanning}>
          {scanning ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Scan</Text>
          )}
        </TouchableOpacity>

        <FlatList
          data={devices}
          keyExtractor={i => i.id}
          renderItem={({item}) => (
            <TouchableOpacity
              style={styles.deviceItem}
              onPress={() => connectAndMonitor(item)}>
              <Text style={styles.deviceName}>{item.name}</Text>
              <Text style={styles.deviceId}>{item.id}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !scanning && (
              <Text style={{marginTop: 20}}>No devices found</Text>
            )
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Connected: {connected.name}</Text>

      <View style={styles.card}>
        <Text style={styles.seq}>Seq: {sequence}</Text>
        {channels.map((v, i) => (
          <View key={i} style={styles.channelRow}>
            <Text style={styles.chanLabel}>Ch{i + 1}:</Text>
            <Text style={styles.chanValue}>{v.toFixed(2)} µV</Text>
          </View>
        ))}
      </View>

      <Text style={styles.chartTitle}>Channel 1 Trend</Text>
      {hasData ? (
        <LineChart
          data={{datasets: [{data: history, strokeWidth: 2}]}}
          width={screenWidth}
          height={150}
          withDots={false}
          withInnerLines={false}
          withOuterLines={false}
          chartConfig={{
            backgroundGradientFrom: '#f4f6fc',
            backgroundGradientTo: '#f4f6fc',
            decimalPlaces: 2,
            propsForBackgroundLines: {stroke: '#eee'},
            color: () => '#5568f6',
          }}
          style={{marginVertical: 8, borderRadius: 8}}
        />
      ) : (
        <Text style={{textAlign: 'center', marginVertical: 24, color: '#666'}}>
          Waiting for data…
        </Text>
      )}

      <View style={styles.footer}>
        <Text style={styles.speed}>
          Speed: {speed.toFixed(1)} segments/sec
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, padding: 20, backgroundColor: '#fff'},
  title: {fontSize: 20, fontWeight: '600', marginBottom: 12},
  button: {
    backgroundColor: '#5568f6',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {color: '#fff', fontSize: 16},
  deviceItem: {padding: 12, borderBottomWidth: 1, borderColor: '#ddd'},
  deviceName: {fontSize: 16, fontWeight: '500'},
  deviceId: {fontSize: 12, color: '#666'},
  card: {
    backgroundColor: '#f9faff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  seq: {fontSize: 18, fontWeight: '600', marginBottom: 8},
  channelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  chanLabel: {fontSize: 16},
  chanValue: {fontSize: 16, fontWeight: '500'},
  chartTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 8,
    textAlign: 'center',
  },
  footer: {marginTop: 12, alignItems: 'center'},
  speed: {fontSize: 16, fontWeight: '500'},
});

export default App;
