import { parentPort } from "worker_threads";
import Meyda from "meyda";
import type { AudioFeatures } from "./audioAnalyzer.js";

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

if (!parentPort) {
  throw new Error("This file must be run as a worker thread");
}

parentPort.on("message", (msg) => {
  const { channelData, windowSize, hopSize, startIdx, endIdx, sampleRate } =
    msg;

  const features: AudioFeatures[] = [];
  const totalWindows = endIdx - startIdx;

  try {
    for (let i = startIdx; i < endIdx; i++) {
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

      // 发送进度更新（每 50 个窗口）
      if ((i - startIdx) % 50 === 0) {
        parentPort!.postMessage({
          type: "progress",
          current: i - startIdx,
          total: totalWindows,
        });
      }
    }

    // 发送最终结果
    parentPort!.postMessage({
      type: "result",
      features,
    });
  } catch (error) {
    // 发送错误信息
    parentPort!.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
