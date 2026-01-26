# Music Segment Detector

Audio music segment detection library - Automatically detect music segments from WAV audio files.

English | [中文](./README_ZH.md)

## Features

- Multi-feature analysis (RMS, energy, MFCC, spectral centroid, etc.)
- Automatic detection of music segment start and end times
- Customizable detection parameters
- No external dependencies (no ffmpeg required)

## Installation

```bash
npm install music-segment-detector
```

## Usage

```typescript
import { analyzeAudio, detectMusicSegments } from "music-segment-detector";

// 1. Analyze WAV audio file (with progress callback)
const features = await analyzeAudio("audio.wav", 2048, 512, (progress) => {
  console.log(`Analysis progress: ${(progress * 100).toFixed(1)}%`);
});

// 1-2. Use Worker parallel processing (recommended for large files, 2.5-3x faster)
const features = await analyzeAudio(
  "audio.wav",
  2048,
  512,
  (progress) => {
    console.log(`Analysis progress: ${(progress * 100).toFixed(1)}%`);
  },
  {
    useWorkers: true, // Enable Worker parallel processing
    numWorkers: 4, // Optional, defaults to CPU core count
  },
);

// 2. Detect music segments
const segments = detectMusicSegments(features, {
  energyPercentile: 50, // Energy percentile threshold (0-100)
  minSegmentDuration: 25, // Minimum segment duration in seconds
  maxGapDuration: 15, // Maximum gap duration in seconds
  smoothWindowSize: 4, // Smoothing window size in seconds
});

// 3. Use detected segments
segments.forEach((segment) => {
  console.log(`Segment: ${segment.startTime}s - ${segment.endTime}s`);
  console.log(`Duration: ${segment.duration}s`);
  console.log(`Confidence: ${segment.confidence}`);
});
```

## API

### `analyzeAudio(audioPath, windowSize?, hopSize?, onProgress?, options?)`

Analyze a WAV audio file and extract features.

- `audioPath`: Path to WAV file
- `windowSize`: Analysis window size (default: 2048)
- `hopSize`: Window hop size (default: 512)
- `onProgress`: Optional progress callback function `(progress: number) => void`, parameter is progress value between 0-1
- `options`: Optional configuration
  - `useWorkers`: Enable Worker parallel processing (default: false)
  - `numWorkers`: Number of workers (default: CPU core count, max 8)
- Returns: `Promise<AudioFeatures[]>`

### `detectMusicSegments(features, config?)`

Detect music segments from audio features.

- `features`: Array of audio features
- `config`: Detection configuration (optional)
  - `energyPercentile`: Energy percentile threshold (0-100, default: 50)
  - `minSegmentDuration`: Minimum segment duration in seconds (default: 25)
  - `maxGapDuration`: Maximum gap duration in seconds (default: 15)
  - `smoothWindowSize`: Smoothing window size in seconds (default: 4)
- Returns: `MusicSegment[]`

### `saveSegmentsToJson(segments, outputPath, mediaFileName)`

Save detection results to JSON format.

- `segments`: Array of music segments
- `outputPath`: Output file path
- `mediaFileName`: Media file name
- Returns: `Promise<void>`

### `getFeatureStats(features)`

Get statistical information of audio features (for debugging and analysis).

- `features`: Array of audio features
- Returns: Statistics object containing min, max, mean, median for each feature

## Type Definitions

```typescript
interface AudioFeatures {
  timestamp: number;
  rms: number;
  energy: number;
  zcr: number;
  spectralEnergy: number;
  variance: number;
  mfcc: number[];
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlatness: number;
}

interface AnalyzeAudioOptions {
  useWorkers?: boolean; // Enable Worker parallel processing
  numWorkers?: number; // Number of workers (defaults to CPU core count)
}

interface MusicSegment {
  startTime: number;
  endTime: number;
  duration: number;
  confidence: number;
  name?: string;
}

interface DetectionConfig {
  energyPercentile?: number;
  minSegmentDuration?: number;
  maxGapDuration?: number;
  smoothWindowSize?: number;
}
```

## How It Works

1. **Feature Extraction**: Analyze audio using sliding windows to extract multi-dimensional features (energy, MFCC, spectral features, etc.)
2. **Multi-Feature Scoring**: Score each time window based on 7 features:
   - Energy intensity
   - Energy stability
   - Spectral centroid (timbre brightness)
   - Spectral flatness (tone vs noise)
   - MFCC continuity (timbre consistency)
   - Zero-crossing rate
   - Spectral rolloff
3. **Post-processing**: Smoothing, merging adjacent segments, filtering short segments

## Performance Optimization

For large audio files, it's recommended to enable Worker parallel processing for better performance:

- **Single-threaded mode** (default): Suitable for small files (< 1 minute) or low-spec environments
- **Worker parallel mode**: Suitable for large files, 2.5-3x performance boost (on 4-core CPU)
  - Automatically adjusts worker count based on file size
  - Automatically falls back to single-threaded mode if workers fail
  - Supports progress aggregation and error handling

## Notes

- Only supports WAV format audio files
- For other formats, use tools like ffmpeg to convert to WAV first
- Detection accuracy depends on audio quality and configuration parameters
- Worker mode requires Node.js 16+ version

## License

MIT
