import { Worker } from "worker_threads";
import { cpus } from "os";
import { fileURLToPath } from "url";
import path from "path";
import type { AudioFeatures } from "./audioAnalyzer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WorkerTask {
  channelData: Float32Array;
  windowSize: number;
  hopSize: number;
  startIdx: number;
  endIdx: number;
  sampleRate: number;
}

export interface WorkerResult {
  features: AudioFeatures[];
  workerId: number;
}

export interface WorkerPoolOptions {
  numWorkers?: number;
  onProgress?: (progress: number) => void;
}

/**
 * Worker 池管理器
 * 用于并行处理音频特征提取
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private numWorkers: number;
  private workerPath: string;

  constructor(options: WorkerPoolOptions = {}) {
    // 默认使用 CPU 核心数，但不超过 8 个
    this.numWorkers = options.numWorkers || Math.min(cpus().length, 8);
    this.workerPath = path.join(__dirname, "audioAnalyzer.worker.js");
  }

  /**
   * 执行并行音频分析
   */
  async execute(
    channelData: Float32Array,
    windowSize: number,
    hopSize: number,
    sampleRate: number,
    onProgress?: (progress: number) => void,
  ): Promise<AudioFeatures[]> {
    const totalWindows = Math.floor(
      (channelData.length - windowSize) / hopSize,
    );

    // 如果窗口数太少，不值得使用多个 worker
    if (totalWindows < this.numWorkers * 10) {
      this.numWorkers = Math.max(1, Math.floor(totalWindows / 10));
    }

    // 计算每个 worker 处理的窗口范围
    const windowsPerWorker = Math.ceil(totalWindows / this.numWorkers);
    const tasks: WorkerTask[] = [];

    for (let i = 0; i < this.numWorkers; i++) {
      const startIdx = i * windowsPerWorker;
      const endIdx = Math.min((i + 1) * windowsPerWorker, totalWindows);

      if (startIdx >= totalWindows) break;

      tasks.push({
        channelData,
        windowSize,
        hopSize,
        startIdx,
        endIdx,
        sampleRate,
      });
    }

    // 创建 workers
    this.createWorkers(tasks.length);

    // 执行任务并收集结果
    const results = await this.executeTasks(tasks, onProgress);

    // 清理 workers
    this.terminate();

    // 按窗口索引排序并合并结果
    return results.flatMap((r) => r.features);
  }

  /**
   * 创建指定数量的 workers
   */
  private createWorkers(count: number): void {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(this.workerPath, {
        // 支持 ESM 模块
        // Node.js 16+ 需要显式指定
      });
      this.workers.push(worker);
    }
  }

  /**
   * 执行所有任务
   */
  private async executeTasks(
    tasks: WorkerTask[],
    onProgress?: (progress: number) => void,
  ): Promise<WorkerResult[]> {
    const progressMap = new Map<number, number>();
    const totalProgress = tasks.reduce(
      (sum, t) => sum + (t.endIdx - t.startIdx),
      0,
    );

    // 为每个 worker 分配任务并等待结果
    const promises = tasks.map((task, idx) => {
      return new Promise<WorkerResult>((resolve, reject) => {
        const worker = this.workers[idx];

        const handleMessage = (msg: any) => {
          if (msg.type === "progress") {
            // 更新进度
            progressMap.set(idx, msg.current);
            if (onProgress) {
              const currentTotal = Array.from(progressMap.values()).reduce(
                (sum, val) => sum + val,
                0,
              );
              onProgress(currentTotal / totalProgress);
            }
          } else if (msg.type === "result") {
            worker.off("message", handleMessage);
            worker.off("error", handleError);
            resolve({
              features: msg.features,
              workerId: idx,
            });
          } else if (msg.type === "error") {
            worker.off("message", handleMessage);
            worker.off("error", handleError);
            reject(new Error(`Worker ${idx} error: ${msg.error}`));
          }
        };

        const handleError = (error: Error) => {
          worker.off("message", handleMessage);
          worker.off("error", handleError);
          reject(error);
        };

        worker.on("message", handleMessage);
        worker.on("error", handleError);

        // 发送任务
        worker.postMessage(task);
      });
    });

    return Promise.all(promises);
  }

  /**
   * 终止所有 workers
   */
  private terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
  }
}
