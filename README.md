# Ghost Fleet Simulator

Sends fake OBD2 telemetry packets to the TCP ingestion server for pipeline testing.

## Overview

See [docs/PRD-Ghost-Fleet-Simulator.md](../../docs/PRD-Ghost-Fleet-Simulator.md) for full specification.

## Why Ghost Fleet?

- Test the entire pipeline **before** hardware arrives
- Validate parser logic against real protocol
- Zero cost compared to real 4G data plans
- Easy to simulate error conditions

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

## How It Works

```
Ghost Fleet Simulator
       │
       │ Raw TCP hex packets (same format as real hardware)
       ▼
┌─────────────────┐     ┌───────────┐     ┌───────────┐
│ Parser Server   │────▶│ Supabase  │────▶│ Angular   │
│ (Railway)       │     │ Database  │     │ Dashboard │
└─────────────────┘     └───────────┘     └───────────┘
       ▲
       │
       │ TCP connection
       │
Ghost Fleet (this)
```

## Packet Format

Sends byte-for-byte identical packets to what the Alibaba device sends:

```
78 78 [length] 22 [lat-4bytes] [lng-4bytes] [speed] [voltage-2bytes] [temp] [rpm-2bytes] [crc-2bytes] 0D 0A
```

## Configuration

```bash
PARSER_HOST=localhost          # or your Railway URL
PARSER_PORT=5050
VEHICLE_ID=ghost-vehicle-01
SEND_INTERVAL_MS=5000          # 5 seconds between packets
```

## Simulated Scenarios

| Scenario | Trigger | Effect |
|----------|---------|--------|
| Normal | Default | Temp: 85-95°C, Voltage: 12.4-13.2V |
| Overheating | Random 10% | Temp: 105-110°C → triggers alert |
| Low Battery | Random 5% | Voltage: 11.5-12.0V → triggers alert |
| DTC | Random 2% | P0420 catalyst code set |

## Validation

The ghost fleet exercises:
- [ ] TCP connection handling
- [ ] Hex packet parsing
- [ ] CRC validation
- [ ] JSON transformation
- [ ] Supabase insertion
- [ ] Realtime subscription
- [ ] Angular rendering