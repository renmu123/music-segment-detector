import fs from "fs/promises";
import * as WavDecoder from "wav-decoder";
import Meyda from "meyda";
import { WorkerPool } from "./workerPool.js";

export interface AudioFeatures {
  timestamp: number;
  rms: number; // 均方根能量
  energy: number; // 能量
  zcr: number; // 过零率
  spectralEnergy: number; // 高频能量
  variance: number; // 能量方差（音乐通常更稳定）
  mfcc: number[] | Float32Array; // MFCC系数（前13个）
  spectralCentroid: number; // 频谱质心（音色明亮度）
  spectralRolloff: number; // 频谱滚降（高频能量分布）
  spectralFlatness: number; // 频谱平坦度（噪声vs音调）
}

export interface AnalyzeAudioOptions {
  useWorkers?: boolean; // 是否使用 Worker 并行处理
  numWorkers?: number; // Worker 数量（默认为 CPU 核心数）
}

/**
 * 从 WAV 文件读取音频数据
 */
async function readWavFile(
  filePath: string,
): Promise<{ sampleRate: number; channelData: Float32Array }> {
  const buffer = await fs.readFile(filePath);
  const audioData = await WavDecoder.decode(buffer.buffer);

  // 如果是多声道，只取第一个声道
  const originalData = audioData.channelData[0];
  const sampleRate = audioData.sampleRate;

  // 将数据转换为SharedArrayBuffer以在Worker间共享
  const dataSize = originalData.length * originalData.BYTES_PER_ELEMENT;
  const sharedBuffer = new SharedArrayBuffer(dataSize);
  const channelData = new Float32Array(sharedBuffer);
  channelData.set(originalData);

  return { sampleRate, channelData };
}

/**
 * 计算 RMS（均方根）
 */
function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * 计算过零率
 */
function calculateZCR(samples: Float32Array): number {
  let count = 0;
  for (let i = 1; i < samples.length; i++) {
    if (
      (samples[i] >= 0 && samples[i - 1] < 0) ||
      (samples[i] < 0 && samples[i - 1] >= 0)
    ) {
      count++;
    }
  }
  return count / samples.length;
}

/**
 * 简单的 FFT 能量分布计算（高频能量）
 */
function calculateSpectralEnergy(samples: Float32Array): number {
  // 简化版：计算高频分量（通过差分近似）
  let highFreqEnergy = 0;
  for (let i = 1; i < samples.length; i++) {
    const diff = samples[i] - samples[i - 1];
    highFreqEnergy += diff * diff;
  }
  return highFreqEnergy / samples.length;
}

/**
 * 计算方差
 */
function calculateVariance(samples: Float32Array, mean: number): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const diff = samples[i] - mean;
    sum += diff * diff;
  }
  return sum / samples.length;
}

/**
 * 使用 Worker 并行计算音频特征
 */
async function analyzeAudioParallel(
  channelData: Float32Array,
  sampleRate: number,
  windowSize: number,
  hopSize: number,
  onProgress?: (progress: number) => void,
  numWorkers?: number,
): Promise<AudioFeatures[]> {
  const pool = new WorkerPool({ numWorkers });
  try {
    const result = await pool.execute(
      channelData,
      windowSize,
      hopSize,
      sampleRate,
      onProgress,
    );

    return result;
  } catch (error) {
    // Worker 失败时回退到单线程模式
    console.warn(
      "Worker parallel processing failed, falling back to single-threaded mode:",
      error,
    );
    return analyzeAudioSingleThread(
      channelData,
      sampleRate,
      windowSize,
      hopSize,
      onProgress,
    );
  }
}

/**
 * 单线程模式计算音频特征
 */
function analyzeAudioSingleThread(
  channelData: Float32Array,
  sampleRate: number,
  windowSize: number,
  hopSize: number,
  onProgress?: (progress: number) => void,
): AudioFeatures[] {
  const features: AudioFeatures[] = [];

  // 滑动窗口分析
  const totalWindows = Math.floor((channelData.length - windowSize) / hopSize);

  for (let i = 0; i < totalWindows; i++) {
    const start = i * hopSize;
    const end = start + windowSize;
    const window = channelData.slice(start, end);

    const timestamp = start / sampleRate;

    // 时域特征
    const rms = calculateRMS(window);
    const energy = rms * rms;
    const zcr = calculateZCR(window);
    const spectralEnergy = calculateSpectralEnergy(window);

    // 计算方差
    let mean = 0;
    for (let j = 0; j < window.length; j++) {
      mean += Math.abs(window[j]);
    }
    mean /= window.length;
    const variance = calculateVariance(window, mean);

    // 使用 Meyda 一次性提取多个特征（更高效）
    const meydaFeatures = Meyda.extract(
      ["mfcc", "spectralCentroid", "spectralRolloff", "spectralFlatness"],
      window,
    ) as any;

    const mfcc = (meydaFeatures?.mfcc as number[]) || new Array(13).fill(0);
    const spectralCentroid = meydaFeatures?.spectralCentroid || 0;
    const spectralRolloff = meydaFeatures?.spectralRolloff || 0;
    const spectralFlatness = meydaFeatures?.spectralFlatness || 0;

    features.push({
      timestamp,
      rms,
      energy,
      zcr,
      spectralEnergy,
      variance,
      mfcc,
      spectralCentroid,
      spectralRolloff,
      spectralFlatness,
    });

    // 调用进度回调
    if (onProgress && i % 100 === 0) {
      onProgress((i + 1) / totalWindows);
    }
  }

  // 确保最后报告 100% 进度
  if (onProgress) {
    onProgress(1);
  }

  return features;
}

/**
 * 计算音频特征
 * @param audioPath WAV 音频文件路径
 * @param windowSize 分析窗口大小（样本数）
 * @param hopSize 窗口跳跃大小（样本数）
 * @param onProgress 进度回调函数，参数为 0-1 之间的进度值
 * @param options 可选配置项，包括是否使用 Worker 并行处理
 */
export async function analyzeAudio(
  audioPath: string,
  windowSize: number = 2048,
  hopSize: number = 512,
  onProgress?: (progress: number) => void,
  options?: AnalyzeAudioOptions,
): Promise<AudioFeatures[]> {
  const { sampleRate, channelData } = await readWavFile(audioPath);

  // 如果启用 Worker 并行处理
  if (options?.useWorkers) {
    return analyzeAudioParallel(
      channelData,
      sampleRate,
      windowSize,
      hopSize,
      onProgress,
      options.numWorkers,
    );
  }

  // 默认使用单线程模式
  return analyzeAudioSingleThread(
    channelData,
    sampleRate,
    windowSize,
    hopSize,
    onProgress,
  );
}

/**
 * 计算特征的统计信息（用于调试和阈值设定）
 */
export function getFeatureStats(features: AudioFeatures[]) {
  const stats = {
    rms: { min: Infinity, max: -Infinity, mean: 0, median: 0 },
    energy: { min: Infinity, max: -Infinity, mean: 0, median: 0 },
    zcr: { min: Infinity, max: -Infinity, mean: 0, median: 0 },
    spectralEnergy: { min: Infinity, max: -Infinity, mean: 0, median: 0 },
    variance: { min: Infinity, max: -Infinity, mean: 0, median: 0 },
    spectralCentroid: { min: Infinity, max: -Infinity, mean: 0, median: 0 },
    spectralRolloff: { min: Infinity, max: -Infinity, mean: 0, median: 0 },
    spectralFlatness: { min: Infinity, max: -Infinity, mean: 0, median: 0 },
    mfcc: [] as Array<{
      min: number;
      max: number;
      mean: number;
      median: number;
    }>,
  };

  // 收集所有值用于计算中位数
  const values: { [key: string]: number[] } = {
    rms: [],
    energy: [],
    zcr: [],
    spectralEnergy: [],
    variance: [],
    spectralCentroid: [],
    spectralRolloff: [],
    spectralFlatness: [],
  };

  // 初始化MFCC统计
  const numMfcc = features[0]?.mfcc?.length || 13;
  for (let i = 0; i < numMfcc; i++) {
    stats.mfcc.push({ min: Infinity, max: -Infinity, mean: 0, median: 0 });
    values[`mfcc${i}`] = [];
  }

  features.forEach((f) => {
    // 处理标量特征
    const scalarKeys = [
      "rms",
      "energy",
      "zcr",
      "spectralEnergy",
      "variance",
      "spectralCentroid",
      "spectralRolloff",
      "spectralFlatness",
    ];

    for (const key of scalarKeys) {
      const value = (f as any)[key];
      if (!isNaN(value) && isFinite(value)) {
        (stats as any)[key].min = Math.min((stats as any)[key].min, value);
        (stats as any)[key].max = Math.max((stats as any)[key].max, value);
        (stats as any)[key].mean += value;
        values[key].push(value);
      }
    }

    // 处理MFCC特征
    if (f.mfcc) {
      f.mfcc.forEach((value, i) => {
        if (!isNaN(value) && isFinite(value)) {
          stats.mfcc[i].min = Math.min(stats.mfcc[i].min, value);
          stats.mfcc[i].max = Math.max(stats.mfcc[i].max, value);
          stats.mfcc[i].mean += value;
          values[`mfcc${i}`].push(value);
        }
      });
    }
  });

  // 计算均值和中位数
  const scalarKeys = [
    "rms",
    "energy",
    "zcr",
    "spectralEnergy",
    "variance",
    "spectralCentroid",
    "spectralRolloff",
    "spectralFlatness",
  ];

  for (const key of scalarKeys) {
    (stats as any)[key].mean /= features.length;

    // 计算中位数
    const sorted = values[key].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    (stats as any)[key].median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
  }

  // 计算MFCC的均值和中位数
  for (let i = 0; i < stats.mfcc.length; i++) {
    stats.mfcc[i].mean /= features.length;

    const sorted = values[`mfcc${i}`].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    stats.mfcc[i].median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
  }

  return stats;
}
