import * as net from 'net';

interface SimulatorConfig {
  host: string;
  port: number;
  vehicleId: string;
  intervalMs: number;
  latitude: number;
  longitude: number;
}

interface SimulatedData {
  lat: number;
  lng: number;
  speed: number;
  voltage: number;
  temp: number;
  rpm: number;
  dtcCodes: string[];
}

class GhostFleetSimulator {
  private config: SimulatorConfig;
  private running = false;

  constructor(config: SimulatorConfig) {
    this.config = config;
  }

  start(): void {
    this.running = true;
    this.runSimulation();
    console.log(`Ghost Fleet simulator started for vehicle: ${this.config.vehicleId}`);
  }

  stop(): void {
    this.running = false;
    console.log('Ghost Fleet simulator stopped');
  }

  private runSimulation(): void {
    if (!this.running) return;

    const data = this.generateSimulatedData();
    const packet = this.buildPacket(data);

    const client = new net.Socket();

    client.connect(this.config.port, this.config.host, () => {
      client.write(packet);
      console.log(`[${this.config.vehicleId}] Sent packet: ${packet.toString('hex')}`);
      client.end();
    });

    client.on('close', () => {
      // Schedule next transmission
      setTimeout(() => this.runSimulation(), this.config.intervalMs);
    });

    client.on('error', (err) => {
      console.error(`[${this.config.vehicleId}] Connection error:`, err.message);
      setTimeout(() => this.runSimulation(), this.config.intervalMs);
    });
  }

  private generateSimulatedData(): SimulatedData {
    // Base values with some variation
    const baseLat = this.config.latitude;
    const baseLng = this.config.longitude;

    // Random scenario selection
    const scenario = Math.random();
    let temp = 85 + Math.random() * 10;  // Normal: 85-95°C
    let voltage = 12.4 + Math.random() * 0.8;  // Normal: 12.4-13.2V
    let rpm = 1500 + Math.random() * 1500;  // Normal: 1500-3000
    const dtcCodes: string[] = [];

    // 10% chance of overheating
    if (scenario < 0.1) {
      temp = 105 + Math.random() * 5;  // Hot: 105-110°C
    }

    // 5% chance of low battery
    if (scenario > 0.9) {
      voltage = 11.5 + Math.random() * 0.5;  // Low: 11.5-12.0V
    }

    // 2% chance of DTC
    if (scenario > 0.98) {
      dtcCodes.push('P0420');  // Catalyst efficiency
    }

    return {
      lat: baseLat + (Math.random() - 0.5) * 0.01,
      lng: baseLng + (Math.random() - 0.5) * 0.01,
      speed: Math.floor(30 + Math.random() * 50),
      voltage,
      temp: Math.floor(temp),
      rpm: Math.floor(rpm),
      dtcCodes
    };
  }

  private buildPacket(data: SimulatedData): Buffer {
    // Protocol: SinoTrack/Micodus
    // [0-1] Start: 0x78 0x78
    // [2] Length
    // [3] Protocol: 0x22 (data)
    // [4-7] Latitude (int32, little endian, degrees * 1e6)
    // [8-11] Longitude (int32, little endian, degrees * 1e6)
    // [12] Speed (uint8, km/h)
    // [13-14] Voltage (uint16, little endian, mV)
    // [15] Temp (uint8, °C)
    // [16-17] RPM (uint16, little endian)
    // [18-19] CRC (uint16, little endian)
    // [20-21] Stop: 0x0D 0x0A

    const latInt = Math.floor(data.lat * 1_000_000);
    const lngInt = Math.floor(data.lng * 1_000_000);
    const voltageMv = Math.floor(data.voltage * 1000);
    const rpmInt = Math.floor(data.rpm);

    // Build payload (without start/stop bytes)
    const payload = Buffer.alloc(17);
    payload.writeInt32LE(latInt, 0);
    payload.writeInt32LE(lngInt, 4);
    payload.writeUInt8(data.speed, 8);
    payload.writeUInt16LE(voltageMv, 9);
    payload.writeUInt8(data.temp, 11);
    payload.writeUInt16LE(rpmInt, 12);
    payload.writeUInt16LE(0, 14); // CRC placeholder

    // Calculate CRC (sum of bytes after length byte)
    let crc = 0;
    for (let i = 0; i < payload.length; i++) {
      crc += payload[i];
    }
    crc &= 0xFFFF;
    payload.writeUInt16LE(crc, 14);

    // Build complete packet
    // Total: 2 (start) + 1 (length) + 1 (protocol) + 17 (payload) + 2 (stop) = 23
    const packet = Buffer.alloc(23);
    packet[0] = 0x78;
    packet[1] = 0x78;
    packet[2] = payload.length;  // 17 = payload length (protocol is separate)
    packet[3] = 0x22;  // Data packet protocol
    payload.copy(packet, 4);
    packet[21] = 0x0D;
    packet[22] = 0x0A;

    return packet;
  }
}

// Configuration from environment
const config: SimulatorConfig = {
  host: process.env.PARSER_HOST || 'localhost',
  port: parseInt(process.env.PARSER_PORT || '5050', 10),
  vehicleId: process.env.VEHICLE_ID || 'ghost-vehicle-01',
  intervalMs: parseInt(process.env.SEND_INTERVAL_MS || '5000', 10),
  latitude: parseFloat(process.env.LATITUDE || '37.7749'),
  longitude: parseFloat(process.env.LONGITUDE || '-122.4194')
};

// Start simulator
const simulator = new GhostFleetSimulator(config);
simulator.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
  simulator.stop();
  process.exit(0);
});
