import { AudioFeatures, getFeatureStats } from "./audioAnalyzer.js";

export interface MusicSegment {
  startTime: number;
  endTime: number;
  duration: number;
  confidence: number; // 0-1 的置信度
  name?: string; // 片段名称（可选）
}

export interface DetectionConfig {
  // RMS 能量阈值百分位（0-100，如 60 表示超过 60% 的样本）
  energyPercentile?: number;
  // 最小音乐片段时长（秒）
  minSegmentDuration?: number;
  // 最大间隔时长（秒），小于此值的间隔会被合并
  maxGapDuration?: number;
  // 平滑窗口大小（秒）
  smoothWindowSize?: number;
}

const DEFAULT_CONFIG: Required<DetectionConfig> = {
  energyPercentile: 50, // 能量超过中位数
  minSegmentDuration: 25, // 提高到15秒，过滤更多短片段
  maxGapDuration: 15, // 提高到10秒，合并更多相邻片段
  smoothWindowSize: 4, // 提高到3秒，增强平滑效果
};

/**
 * 对布尔序列进行平滑处理
 */
function smoothBooleanSequence(
  sequence: boolean[],
  windowSize: number,
): boolean[] {
  const result: boolean[] = [];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < sequence.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(sequence.length, i + halfWindow + 1);
    const window = sequence.slice(start, end);

    // 如果窗口内大部分为 true，则判定为音乐
    const trueCount = window.filter((v) => v).length;
    result.push(trueCount > window.length / 2);
  }

  return result;
}

/**
 * 检测音乐片段 - 使用多特征综合判断（包括MFCC）
 */
export function detectMusicSegments(
  features: AudioFeatures[],
  config: DetectionConfig = {},
): MusicSegment[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // 计算特征统计信息
  const stats = getFeatureStats(features);

  // 使用百分位数计算阈值
  const energyValues = features.map((f) => f.energy).sort((a, b) => a - b);
  const energyThreshold =
    energyValues[
      Math.floor((energyValues.length * cfg.energyPercentile) / 100)
    ];

  // 计算MFCC相似度阈值（用于检测音乐的连续性）
  const mfccVariances = features.map((f, idx) => {
    if (idx === 0) return 0;
    let variance = 0;
    for (
      let i = 0;
      i < f.mfcc.length && i < features[idx - 1].mfcc.length;
      i++
    ) {
      const diff = f.mfcc[i] - features[idx - 1].mfcc[i];
      variance += diff * diff;
    }
    return Math.sqrt(variance);
  });
  const avgMfccVariance =
    mfccVariances.reduce((a, b) => a + b, 0) / mfccVariances.length;

  // 第一步：基于多特征判断每个时间窗口是否可能是音乐
  const isMusicWindow = features.map((f, idx) => {
    let musicScore = 0;
    let totalWeight = 0;

    // 1. 能量判断（权重：2.0）
    const hasHighEnergy = f.energy > energyThreshold;
    if (hasHighEnergy) {
      musicScore += 2.0;
    }
    totalWeight += 2.0;

    // 2. 能量稳定性判断（权重：1.5）
    if (idx > 0 && idx < features.length - 1) {
      const prevEnergy = features[idx - 1].energy;
      const nextEnergy = features[idx + 1].energy;
      const avgEnergy = (prevEnergy + f.energy + nextEnergy) / 3;

      if (avgEnergy > 0) {
        const variation = Math.abs(f.energy - avgEnergy) / avgEnergy;
        const stabilityScore = 1 - Math.min(variation, 1);

        // 音乐通常更稳定（stabilityScore > 0.3）
        if (stabilityScore > 0.3) {
          musicScore += 1.5 * stabilityScore;
        }
      }
    }
    totalWeight += 1.5;

    // 3. 频谱质心判断（权重：1.0）
    // 音乐通常有更丰富的频率成分，质心在中高频
    const centroidScore =
      f.spectralCentroid > stats.spectralCentroid.mean * 0.7 &&
      f.spectralCentroid < stats.spectralCentroid.mean * 1.3;
    if (centroidScore) {
      musicScore += 1.0;
    }
    totalWeight += 1.0;

    // 4. 频谱平坦度判断（权重：1.0）
    // 音乐的频谱平坦度通常较低（更多音调特性）
    if (f.spectralFlatness < stats.spectralFlatness.median) {
      musicScore += 1.0;
    }
    totalWeight += 1.0;

    // 5. MFCC连续性判断（权重：2.0）
    // 音乐的MFCC变化通常比人声更平滑
    if (idx > 0) {
      const mfccVariance = mfccVariances[idx];
      if (mfccVariance < avgMfccVariance * 1.2) {
        const smoothness =
          1 - Math.min(mfccVariance / (avgMfccVariance * 1.5), 1);
        musicScore += 2.0 * smoothness;
      }
    } else {
      musicScore += 1.0; // 第一帧给一半分数
    }
    totalWeight += 2.0;

    // 6. 过零率判断（权重：0.5）
    // 音乐通常有适中的过零率
    if (f.zcr > stats.zcr.min * 2 && f.zcr < stats.zcr.median * 1.5) {
      musicScore += 0.5;
    }
    totalWeight += 0.5;

    // 7. 频谱滚降判断（权重：0.8）
    // 音乐通常有更多高频内容
    if (f.spectralRolloff > stats.spectralRolloff.mean * 0.8) {
      musicScore += 0.8;
    }
    totalWeight += 0.8;

    // 计算最终得分（0-1）
    const finalScore = musicScore / totalWeight;

    // 阈值设为0.6，即需要60%的特征符合音乐特性
    return finalScore > 0.6;
  });

  // 第二步：平滑处理
  const smoothWindowSamples = Math.floor(
    cfg.smoothWindowSize / (features[1].timestamp - features[0].timestamp),
  );
  const smoothed = smoothBooleanSequence(isMusicWindow, smoothWindowSamples);

  // 第三步：提取连续的音乐片段
  const rawSegments: MusicSegment[] = [];
  let segmentStart: number | null = null;
  let segmentScores: number[] = [];

  for (let i = 0; i < smoothed.length; i++) {
    const isMusic = smoothed[i];
    const timestamp = features[i].timestamp;

    if (isMusic && segmentStart === null) {
      segmentStart = timestamp;
      segmentScores = [];
    }

    if (isMusic && segmentStart !== null) {
      // 收集片段内的置信度分数
      segmentScores.push(isMusicWindow[i] ? 1 : 0);
    }

    if (!isMusic && segmentStart !== null) {
      const avgConfidence =
        segmentScores.length > 0
          ? segmentScores.reduce((a, b) => a + b, 0) / segmentScores.length
          : 0.8;

      rawSegments.push({
        startTime: segmentStart,
        endTime: timestamp,
        duration: timestamp - segmentStart,
        confidence: avgConfidence,
      });
      segmentStart = null;
      segmentScores = [];
    }
  }

  if (segmentStart !== null) {
    const lastTimestamp = features[features.length - 1].timestamp;
    const avgConfidence =
      segmentScores.length > 0
        ? segmentScores.reduce((a, b) => a + b, 0) / segmentScores.length
        : 0.8;

    rawSegments.push({
      startTime: segmentStart,
      endTime: lastTimestamp,
      duration: lastTimestamp - segmentStart,
      confidence: avgConfidence,
    });
  }

  // 第四步：过滤太短的片段和低置信度片段
  const filteredSegments = rawSegments.filter(
    (s) => s.duration >= cfg.minSegmentDuration && s.confidence > 0.5,
  );

  // 第五步：合并相近的片段
  const mergedSegments: MusicSegment[] = [];

  for (const segment of filteredSegments) {
    if (mergedSegments.length === 0) {
      mergedSegments.push(segment);
    } else {
      const lastSegment = mergedSegments[mergedSegments.length - 1];
      const gap = segment.startTime - lastSegment.endTime;

      if (gap <= cfg.maxGapDuration) {
        lastSegment.endTime = segment.endTime;
        lastSegment.duration = lastSegment.endTime - lastSegment.startTime;
      } else {
        mergedSegments.push(segment);
      }
    }
  }

  return mergedSegments;
}

/**
 * 格式化时间为 HH:MM:SS
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
