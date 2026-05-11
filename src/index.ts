import * as net from 'net';

interface SimulatorConfig {
  host: string;
  port: number;
  vehicleId: string;
  imei: string;
  intervalMs: number;
  latitude: number;
  longitude: number;
  reconnectTest: boolean;
  packetsPerSession: number;
}

interface SimulatedData {
  lat: number;
  lng: number;
  speed: number;
  voltage: number;
  temp: number;
  rpm: number;
}

// CRC-16-IBM (polynomial 0x1021, initial 0x0000)
function crc16(data: Buffer): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  return crc & 0xFFFF;
}

let sessionCount = 0;

class GhostFleetSimulator {
  private config: SimulatorConfig;
  private running = false;
  private authenticated = false;

  constructor(config: SimulatorConfig) {
    this.config = config;
  }

  start(): void {
    this.running = true;
    this.runSimulation();
    console.log(`Ghost Fleet simulator started for vehicle: ${this.config.vehicleId} (IMEI: ${this.config.imei})`);
  }

  stop(): void {
    this.running = false;
    console.log('Ghost Fleet simulator stopped');
  }

  private runSimulation(): void {
    if (!this.running) return;

    sessionCount++;
    const { reconnectTest, packetsPerSession, vehicleId, intervalMs } = this.config;

    const client = new net.Socket();
    let ackBuffer = Buffer.alloc(0);
    let packetsSentThisSession = 0;

    client.connect(this.config.port, this.config.host, () => {
      // Send raw IMEI (15 ASCII digits, no framing)
      client.write(Buffer.from(this.config.imei, 'ascii'));
      console.log(`[${vehicleId}] Sent IMEI: ${this.config.imei}`);
    });

    client.on('data', (chunk: Buffer) => {
      if (!this.authenticated) {
        // Expect single byte 0x01 as login ACK
        if (chunk.length > 0 && chunk[0] === 0x01) {
          this.authenticated = true;
          console.log(`[${vehicleId}] Authenticated successfully`);
          // Send first telemetry
          const data = this.generateSimulatedData();
          const packet = this.buildCodec8ExtendedPacket(data);
          client.write(packet);
          packetsSentThisSession++;
          console.log(`[${vehicleId}] Sent telemetry: temp=${data.temp}°C, voltage=${data.voltage}V, rpm=${data.rpm}, speed=${data.speed}km/h`);
        } else {
          console.error(`[${vehicleId}] Auth failed: ${chunk.toString('hex')}`);
          client.end();
        }
        return;
      }

      // Accumulate ACK responses (4 bytes big-endian record count)
      ackBuffer = Buffer.concat([ackBuffer, chunk]);
      while (ackBuffer.length >= 4) {
        const recordCount = ackBuffer.readUInt32BE(0);
        console.log(`[${vehicleId}] Server ACK: ${recordCount} records confirmed`);
        ackBuffer = ackBuffer.slice(4);
      }
    });

    client.on('close', () => {
      this.authenticated = false;
      if (reconnectTest && sessionCount >= 2) {
        console.log(`[${vehicleId}] reconnect-test: ${packetsPerSession * 2} packets sent across 2 sessions — verify Supabase row count`);
        process.exit(0);
      }
      if (this.running) {
        console.log(`[${vehicleId}] Connection closed, reconnecting...`);
        setTimeout(() => this.runSimulation(), intervalMs);
      }
    });

    client.on('error', (err) => {
      console.error(`[${vehicleId}] Connection error:`, err.message);
      if (this.running) {
        setTimeout(() => this.runSimulation(), intervalMs);
      }
    });

    // Schedule next telemetry at interval
    const scheduleNext = () => {
      if (!this.running || !this.authenticated) return;

      setTimeout(() => {
        if (!this.running || !this.authenticated) return;
        const data = this.generateSimulatedData();
        const packet = this.buildCodec8ExtendedPacket(data);
        client.write(packet);
        packetsSentThisSession++;
        console.log(`[${vehicleId}] Sent telemetry: temp=${data.temp}°C, voltage=${data.voltage}V, rpm=${data.rpm}, speed=${data.speed}km/h`);

        if (reconnectTest && packetsSentThisSession >= packetsPerSession) {
          console.log(`[${vehicleId}] reconnect-test: session ${sessionCount} closed after ${packetsSentThisSession} packets`);
          client.destroy();
          return;
        }

        scheduleNext();
      }, intervalMs);
    };

    // Wait for auth before scheduling
    const waitForAuth = setInterval(() => {
      if (this.authenticated) {
        clearInterval(waitForAuth);
        scheduleNext();
      }
      if (!this.running) {
        clearInterval(waitForAuth);
      }
    }, 100);
  }

  private generateSimulatedData(): SimulatedData {
    const baseLat = this.config.latitude;
    const baseLng = this.config.longitude;

    const scenario = Math.random();
    let temp = 85 + Math.random() * 10; // Normal: 85-95°C
    let voltage = 12.4 + Math.random() * 0.8; // Normal: 12.4-13.2V
    let rpm = 1500 + Math.random() * 1500; // Normal: 1500-3000

    // 10% chance of overheating
    if (scenario < 0.1) {
      temp = 105 + Math.random() * 5; // Hot: 105-110°C
    }

    // 5% chance of low battery
    if (scenario > 0.9) {
      voltage = 11.5 + Math.random() * 0.5; // Low: 11.5-12.0V
    }

    return {
      lat: baseLat + (Math.random() - 0.5) * 0.01,
      lng: baseLng + (Math.random() - 0.5) * 0.01,
      speed: Math.floor(30 + Math.random() * 50),
      voltage,
      temp: Math.floor(temp),
      rpm: Math.floor(rpm)
    };
  }

  private buildCodec8ExtendedPacket(data: SimulatedData): Buffer {
    const timestamp = BigInt(Date.now());
    const latInt = Math.floor(data.lat * 10_000_000);
    const lngInt = Math.floor(data.lng * 10_000_000);
    const speedInt = data.speed * 10; // km/h × 10
    const voltageMv = Math.floor(data.voltage * 1000);
    const tempX10 = Math.floor(data.temp * 10);

    // Build IO elements
    const ioElements: Buffer[] = [];

    // IO ID 7045: Vehicle Speed (type 2 = uint16 BE, km/h)
    const speedBuf = Buffer.alloc(4);
    speedBuf.writeUInt16BE(7045, 0);
    speedBuf[2] = 0x02;
    speedBuf.writeUInt16BE(data.speed, 3);
    ioElements.push(speedBuf);

    // IO ID 7059: Control Voltage (type 2 = uint16 BE, mV)
    const voltBuf = Buffer.alloc(4);
    voltBuf.writeUInt16BE(7059, 0);
    voltBuf[2] = 0x02;
    voltBuf.writeUInt16BE(voltageMv, 3);
    ioElements.push(voltBuf);

    // IO ID 7040: Coolant Temperature (type 2 = uint16 BE, °C×10)
    const tempBuf = Buffer.alloc(4);
    tempBuf.writeUInt16BE(7040, 0);
    tempBuf[2] = 0x02;
    tempBuf.writeUInt16BE(tempX10, 3);
    ioElements.push(tempBuf);

    // IO ID 7044: Engine RPM (type 3 = uint32 BE)
    const rpmBuf = Buffer.alloc(6);
    rpmBuf.writeUInt16BE(7044, 0);
    rpmBuf[2] = 0x03;
    rpmBuf.writeUInt32BE(data.rpm, 3);
    ioElements.push(rpmBuf);

    const ioData = Buffer.concat(ioElements);
    const ioCount = 4; // number of IO elements

    // Fixed AVL record (28 bytes)
    const avlFixed = Buffer.alloc(29);
    avlFixed.writeBigUInt64BE(timestamp, 0);
    avlFixed[8] = 0; // priority
    avlFixed.writeInt32BE(lngInt, 9);
    avlFixed.writeInt32BE(latInt, 13);
    avlFixed.writeInt16BE(0, 17); // altitude
    avlFixed.writeUInt16BE(0, 19); // angle
    avlFixed.writeUInt16BE(8, 21); // satellites
    avlFixed.writeUInt16BE(speedInt, 23);
    avlFixed.writeUInt16BE(0, 25); // event ID
    avlFixed.writeUInt16BE(ioCount, 27);

    const avlRecord = Buffer.concat([avlFixed, ioData]);

    // Build payload: codec ID + num records + AVL records + num records repeat
    const header = Buffer.alloc(3);
    header[0] = 0x8E; // codec ID
    header.writeUInt16BE(1, 1); // num records

    const trailer = Buffer.alloc(2);
    trailer.writeUInt16BE(1, 0); // num records repeat

    const payload = Buffer.concat([header, avlRecord, trailer]);

    // CRC-16 over payload
    const crc = crc16(payload);
    const crcBuf = Buffer.alloc(2);
    crcBuf.writeUInt16BE(crc, 0);

    // Full packet: preamble + length + payload + CRC
    const preamble = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const dataLength = payload.length + 2; // payload + CRC
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(dataLength, 0);

    return Buffer.concat([preamble, lengthBuf, payload, crcBuf]);
  }
}

// Configuration from environment
const config: SimulatorConfig = {
  host: process.env.PARSER_HOST || 'localhost',
  port: parseInt(process.env.PARSER_PORT || '5050', 10),
  vehicleId: process.env.VEHICLE_ID || 'ghost-vehicle-01',
  imei: process.env.DEVICE_IMEI || '359632098765432',
  intervalMs: parseInt(process.env.SEND_INTERVAL_MS || '5000', 10),
  latitude: parseFloat(process.env.LATITUDE || '37.7749'),
  longitude: parseFloat(process.env.LONGITUDE || '-122.4194'),
  reconnectTest: process.env.RECONNECT_TEST === 'true',
  packetsPerSession: parseInt(process.env.PACKETS_PER_SESSION || '5', 10)
};

// Start simulator
const simulator = new GhostFleetSimulator(config);
simulator.start();
console.log('Emitting FMC003 IO IDs: 7059(voltage mV), 7040(temp °C×10), 7044(rpm), 7045(speed km/h)');
if (config.reconnectTest) {
  console.log(`[${config.vehicleId}] RECONNECT_TEST mode: ${config.packetsPerSession} packets × 2 sessions = ${config.packetsPerSession * 2} total expected in Supabase`);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  simulator.stop();
  process.exit(0);
});
