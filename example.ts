/**
 * 使用示例
 *
 * 这个示例展示了如何使用 music-segment-detector 库来分析音频并检测音乐片段
 */

import { analyzeAudio, detectMusicSegments } from "music-segment-detector";

async function example() {
  try {
    // 1. 分析 WAV 音频文件（带进度回调）
    // 注意：音频文件必须是 WAV 格式
    const audioPath = "path/to/audio.wav";
    const features = await analyzeAudio(
      audioPath,
      2048, // windowSize
      512, // hopSize
      (progress) => {
        console.log(`分析进度: ${(progress * 100).toFixed(1)}%`);
      },
    );

    console.log(`提取了 ${features.length} 个时间窗口的特征`);

    // 2. 检测音乐片段
    // 可以自定义配置参数
    const segments = detectMusicSegments(features, {
      energyPercentile: 50, // 能量百分位阈值 (0-100)，值越大越严格
      minSegmentDuration: 25, // 最小片段时长（秒）
      maxGapDuration: 15, // 最大间隔时长（秒），小于此值的相邻片段会被合并
      smoothWindowSize: 4, // 平滑窗口大小（秒）
    });

    console.log(`检测到 ${segments.length} 个音乐片段`);

    // 3. 使用检测到的片段
    segments.forEach((segment, index) => {
      console.log(`\n片段 ${index + 1}:`);
      console.log(`  起始时间: ${segment.startTime.toFixed(2)}s`);
      console.log(`  结束时间: ${segment.endTime.toFixed(2)}s`);
      console.log(`  时长: ${segment.duration.toFixed(2)}s`);
      console.log(`  置信度: ${(segment.confidence * 100).toFixed(1)}%`);
    });
  } catch (error) {
    console.error("处理失败:", error);
  }
}

// 如果需要更宽松的检测（识别更多片段）
async function detectMoreSegments() {
  const features = await analyzeAudio("audio.wav");

  const segments = detectMusicSegments(features, {
    energyPercentile: 40, // 降低阈值
    minSegmentDuration: 15, // 降低最小时长
    maxGapDuration: 10, // 减小合并范围
  });

  return segments;
}

// 如果需要更严格的检测（只保留最明显的音乐片段）
async function detectStrictSegments() {
  const features = await analyzeAudio("audio.wav");

  const segments = detectMusicSegments(features, {
    energyPercentile: 60, // 提高阈值
    minSegmentDuration: 30, // 提高最小时长
    maxGapDuration: 5, // 减小合并范围
  });

  return segments;
}

// 运行示例
example();
