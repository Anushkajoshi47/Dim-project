import 'dotenv/config';

/**
 * Prisma throws while *constructing* its client if DATABASE_URL is unset, which
 * would take the whole simulator down before it could fall back to in-memory
 * history. Defaulting it here — this module is imported before db/prisma.ts —
 * means a missing .env degrades to the documented fallback instead of a crash.
 */
process.env.DATABASE_URL ??= 'postgresql://somaiya:somaiya@localhost:5544/somaiyasat?schema=public';

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 4000),

  /**
   * Allowed browser origins, as a comma-separated list.
   *
   * A list rather than a single string because in deployment the dashboard is
   * served from a different host than this API (and platforms like Vercel issue
   * a fresh preview URL per deploy), so more than one origin legitimately needs
   * access. `CORS_ORIGIN=*` allows any origin — acceptable for a public
   * read-only demo, but it also opens the command endpoints, so prefer listing
   * the real frontend URLs.
   */
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  mission: {
    name: 'SomaiyaSat & SomaiyaPod',
    designator: 'KJS-SRS-01',
    operator: 'K. J. Somaiya Institute of Technology — Space Research Society',
  },

  /** Mission epoch. Blank env var => process boot time. */
  epoch: process.env.SIM_EPOCH ? Date.parse(process.env.SIM_EPOCH) : Date.now(),

  /** Simulation speed multiplier. 30x => one 95 min orbit in ~3 min. */
  speed: num(process.env.SIM_SPEED, 30),
  speedPresets: [1, 5, 15, 30, 60, 120],

  /** Tick rates in real (wall-clock) milliseconds. */
  tick: {
    orbit: 1000,
    telemetry: 1000,
    radio: 2000,
    routing: 3000,
    persist: 1500,
  },

  /**
   * Simulated seconds after the epoch at which SomaiyaSat is placed directly
   * over the ground station. The constellation's orbit plane is solved for this
   * at startup so a jury never waits hours for the first pass.
   */
  firstPassOffsetSec: 300,

  /** Fixed simulated amateur ground station — KJSIT, Vidyavihar, Mumbai. */
  groundStation: {
    name: 'KJSIT Vidyavihar GS',
    lat: 19.0728,
    lon: 72.8996,
    altitude: 0.02, // km AMSL
    minElevation: 5, // degrees — below this the pass is unusable
    gainDbi: 14.5, // crossed-yagi
    systemNoiseTempK: 380,
    lineLossDb: 1.8,
  },

  /**
   * Two-spacecraft LEO constellation in a leader–follower formation.
   *
   * Both spacecraft share an altitude, inclination and period; SomaiyaPod
   * simply trails by 9.5° of argument of latitude (~1150 km along track) with a
   * small RAAN offset for cross-track separation. Matching the periods is what
   * makes the formation *stable*: give them different altitudes and the phase
   * offset grows every orbit until, after a few simulated days, they are on
   * opposite sides of the Earth and the crosslink is permanently occulted.
   *
   * Modelling assumption: no differential drag and no station keeping, so the
   * formation holds indefinitely. A real pair would need periodic maintenance.
   */
  satellites: [
    {
      id: 'SOMAIYASAT' as const,
      name: 'SomaiyaSat',
      altitude: 525, // km
      inclination: 97.5, // deg — SSO-like
      raan: 118.0, // deg
      periodMinutes: 95.1,
      /** Argument of latitude at epoch, deg. */
      phase: 0,
    },
    {
      id: 'SOMAIYAPOD' as const,
      name: 'SomaiyaPod',
      altitude: 525,
      inclination: 97.5,
      raan: 118.6,
      periodMinutes: 95.1,
      phase: -9.5,
    },
  ],

  power: {
    /** 2S Li-ion pack. */
    cells: 2,
    // 2S1P of 700 mAh Li-ion ≈ 5.2 Wh — realistic for a 1.5P PocketQube, and
    // small enough that an eclipse produces a visible state-of-charge dip.
    capacityAh: 0.7,
    vMax: 8.4,
    vMin: 6.0,
    internalResistance: 0.22, // ohm, pack + harness
    /** Per-face array area proxy — peak current per face at normal incidence. */
    faces: ['+X', '-X', '+Y', '-Y', '+Z'],
    facePeakCurrent: 0.22, // A
    baseLoad: 0.62, // W, OBC + EPS + sensors
    radioIdleLoad: 0.35, // W
  },

  radio: {
    /** Noise floor at the ground station receiver, dBm (in-band). */
    noiseFloorDbm: -122,
    /** Demodulation threshold used for the link-margin figure, dB. */
    requiredSnrDb: 8,
    historyLength: 90,
    spectrumBins: 64,
    beaconCall: 'AT0KJS',
  },

  routing: {
    /** Onboard downlink queue capacity, packets. */
    queueCapacity: 4096,
    /** Baseline packet generation rate, packets per simulated second. */
    packetRate: 22,
    decisionHistory: 40,
  },

  anomaly: {
    /**
     * Probability per routing tick (3 s) that a spontaneous anomaly begins.
     * 0.012 gives a mean spacing of ~4 minutes of real time — often enough that
     * a jury sees the router react without the vehicle looking permanently sick.
     */
    spontaneousChance: 0.012,
    minDurationSec: 45,
    maxDurationSec: 150,
  },

  eventLogLength: 300,
  commandLogLength: 60,
  /**
   * Ground-track trail / prediction lengths, in simulated seconds.
   * A full orbit either side, so the track renders as the familiar sinusoid
   * with successive revolutions offset westward, rather than a single steep
   * half-orbit line.
   */
  track: {
    trailSeconds: 95 * 60,
    futureSeconds: 95 * 60,
    stepSeconds: 45,
  },
};

export type AppConfig = typeof config;
