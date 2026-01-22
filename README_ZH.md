# Music Segment Detector

音频音乐片段识别库 - 从 WAV 音频文件中自动识别音乐片段。

[English](./README.md) | 中文

## 功能特点

- 基于多特征分析（RMS、能量、MFCC、频谱质心等）
- 自动检测音乐片段的开始和结束时间
- 支持自定义检测参数
- 无需外部依赖（不依赖 ffmpeg）

## 安装

```bash
npm install music-segment-detector
```

## 使用方法

```typescript
import { analyzeAudio, detectMusicSegments } from "music-segment-detector";

// 1. 分析 WAV 音频文件（带进度回调）
const features = await analyzeAudio("audio.wav", 2048, 512, (progress) => {
  console.log(`分析进度: ${(progress * 100).toFixed(1)}%`);
});

// 2. 检测音乐片段
const segments = detectMusicSegments(features, {
  energyPercentile: 50, // 能量百分位阈值 (0-100)
  minSegmentDuration: 25, // 最小片段时长（秒）
  maxGapDuration: 15, // 最大间隔时长（秒）
  smoothWindowSize: 4, // 平滑窗口大小（秒）
});

// 4. 使用检测到的片段
segments.forEach((segment) => {
  console.log(`片段: ${segment.startTime}s - ${segment.endTime}s`);
  console.log(`时长: ${segment.duration}s`);
  console.log(`置信度: ${segment.confidence}`);
});
```

## API

### `analyzeAudio(audioPath, windowSize?, hopSize?, onProgress?)`

分析 WAV 音频文件并提取特征。

- `audioPath`: WAV 文件路径
- `windowSize`: 分析窗口大小（默认: 2048）
- `hopSize`: 窗口跳跃大小（默认: 512）
- `onProgress`: 可选的进度回调函数 `(progress: number) => void`，参数为 0-1 之间的进度值
- 返回: `Promise<AudioFeatures[]>`

### `detectMusicSegments(features, config?)`

从音频特征中检测音乐片段。

- `features`: 音频特征数组
- `config`: 检测配置（可选）
  - `energyPercentile`: 能量百分位阈值 (0-100, 默认: 50)
  - `minSegmentDuration`: 最小片段时长秒（默认: 25）
  - `maxGapDuration`: 最大间隔时长秒（默认: 15）
  - `smoothWindowSize`: 平滑窗口大小秒（默认: 4）
- 返回: `MusicSegment[]`

### `getFeatureStats(features)`

获取音频特征的统计信息（用于调试和分析）。

- `features`: 音频特征数组
- 返回: 包含各特征的 min、max、mean、median 的统计对象

## 类型定义

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

## 工作原理

1. **特征提取**: 使用滑动窗口分析音频，提取多维特征（能量、MFCC、频谱等）
2. **多特征综合判断**: 基于 7 种特征对每个时间窗口评分
   - 能量强度
   - 能量稳定性
   - 频谱质心（音色明亮度）
   - 频谱平坦度（音调 vs 噪声）
   - MFCC 连续性（音色一致性）
   - 过零率
   - 频谱滚降
3. **后处理**: 平滑处理、合并相邻片段、过滤短片段

## 注意事项

- 仅支持 WAV 格式音频文件
- 如需处理其他格式，请先使用 ffmpeg 等工具转换为 WAV
- 检测精度取决于音频质量和配置参数

## License

MIT
