import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEP_SPECS = Object.freeze([
  {
    id: 'cadquery',
    name: '高精度 CAD 实体内核 (CadQuery / OpenCASCADE)',
    name_en: 'Precision CAD Solid Kernel (CadQuery / OCCT)',
    purpose: '将参数化模型草稿编译为真平滑圆角 / NURBS 曲面的工业级 .STEP 与 .STL 实体，供模具厂直接修模。',
    purpose_en: 'Compiles parametric drafts into smooth-fillet OpenCASCADE B-Rep .STEP and .STL solids.',
    used_by: ['精品工作台 · 模型草稿', 'CAD MCP'],
    used_by_en: ['Boutique CAD Studio', 'CAD MCP'],
    size_hint: '~180 MB',
    kind: 'python_venv',
    venv_name: 'cad-venv',
    packages: ['cadquery'],
    import_check: 'import cadquery; print(getattr(cadquery, "__version__", "ok"))',
    fallback_note: '不安装也可继续使用内置零依赖快速草稿引擎',
    fallback_note_en: 'Built-in zero-dep draft engine remains available without installing',
  },
  {
    id: 'whisper_model',
    name: '本地离线视频语音模型 (Whisper Base Q5)',
    name_en: 'Local Offline Video ASR Model (Whisper Base Q5)',
    purpose: '让 AI 在本机直接识别商品视频口播并生成时间轴字幕，零音频上传云端。',
    purpose_en: 'Enables offline local speech transcription inside browser_video_read with zero cloud uploads.',
    used_by: ['本地网页视频阅读 (browser_video_read)'],
    used_by_en: ['Local Video Reader (browser_video_read)'],
    size_hint: '~59 MB',
    kind: 'http_file',
    target_rel: ['media-models', 'ggml-base-q5_1.bin'],
    min_bytes: 45 * 1024 * 1024,
    urls: [
      'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
    ],
    fallback_note: '不安装时仅抽取视频画面帧与网页自带字幕',
    fallback_note_en: 'Frame extraction and page captions still work without this model',
  },
  {
    id: 'ffmpeg',
    name: '本地音视频解码器 (FFmpeg)',
    name_en: 'Local Video/Audio Decoder (FFmpeg)',
    purpose: '支持网页商品视频抽帧、音频提取与本地 Whisper 离线语音识别。',
    purpose_en: 'Required for web video decoding, frame extraction, and local Whisper audio filters.',
    used_by: ['本地网页视频阅读 (browser_video_read)'],
    used_by_en: ['Local Video Reader (browser_video_read)'],
    size_hint: '~95 MB',
    kind: 'system_tool',
    binary: 'ffmpeg',
    winget_id: 'Gyan.FFmpeg',
    brew_pkg: 'ffmpeg',
    fallback_note: '未安装时无法解码本地视频音轨',
    fallback_note_en: 'Audio transcription requires FFmpeg',
  },
  {
    id: 'sourcing_1688_cli',
    name: '1688 本地寻源 Skill 依赖 (keyring + httpx)',
    name_en: '1688 Local Sourcing Skill Runtime (keyring + httpx)',
    purpose: '补全 1688-product-find 本地 CLI/Skill 所需 Python 依赖，避免缺失 keyring 报错。',
    purpose_en: 'Installs isolated keyring, httpx, and requests for local 1688-product-find skill workflows.',
    used_by: ['精品工作台 · 1688 寻源 Skill'],
    used_by_en: ['Boutique 1688 Sourcing Skill'],
    size_hint: '~18 MB',
    kind: 'python_venv',
    venv_name: 'sourcing-venv',
    packages: ['keyring', 'httpx', 'requests'],
    import_check: 'import keyring, httpx, requests; print(getattr(httpx, "__version__", "ok"))',
    fallback_note: '未安装时可继续使用塞星 1688 网页工作台或 1688 MCP',
    fallback_note_en: 'Web handoff and 1688 MCP remain available without local CLI deps',
  },
]);

const MIRROR_PYPI = 'https://pypi.tuna.tsinghua.edu.cn/simple';
const isWin = process.platform === 'win32';

export function getSpecById(id) {
  return DEP_SPECS.find(s => s.id === id) || null;
}

export function venvPythonPath(dataDir, venvName) {
  const base = path.join(dataDir, 'runtimes', venvName);
  return isWin ? path.join(base, 'Scripts', 'python.exe') : path.join(base, 'bin', 'python');
}

function execCapture(cmd, args, opts = {}) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = res => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env || process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return done({ ok: false, code: -1, stdout: '', stderr: err.message });
    }
    const timer = opts.timeoutMs ? setTimeout(() => {
      try { child.kill(); } catch {}
      done({ ok: false, code: -2, stdout, stderr: stderr + '\nTIMEOUT' });
    }, opts.timeoutMs) : null;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', d => {
      stdout += d;
      if (opts.onLine) {
        for (const line of String(d).split(/\r?\n/)) {
          if (line.trim()) opts.onLine(line.trim());
        }
      }
    });
    child.stderr?.on('data', d => {
      stderr += d;
      if (opts.onLine) {
        for (const line of String(d).split(/\r?\n/)) {
          if (line.trim()) opts.onLine(line.trim());
        }
      }
    });
    child.once('error', err => {
      if (timer) clearTimeout(timer);
      done({ ok: false, code: -1, stdout, stderr: err.message });
    });
    child.once('close', code => {
      if (timer) clearTimeout(timer);
      done({ ok: code === 0, code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    if (opts.onSpawn) opts.onSpawn(child);
  });
}

function findWinGetFfmpeg() {
  if (!isWin) return null;
  const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const pkgRoot = path.join(localApp, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(pkgRoot)) return null;
  try {
    const dirs = fs.readdirSync(pkgRoot).filter(d => d.toLowerCase().includes('ffmpeg'));
    for (const d of dirs) {
      const base = path.join(pkgRoot, d);
      const direct = path.join(base, 'bin', 'ffmpeg.exe');
      if (fs.existsSync(direct)) return direct;
      for (const sub of fs.readdirSync(base)) {
        const nested = path.join(base, sub, 'bin', 'ffmpeg.exe');
        if (fs.existsSync(nested)) return nested;
      }
    }
  } catch {}
  return null;
}

export function resolveFfmpegBinary(dataDir) {
  if (dataDir) {
    const localBin = path.join(dataDir, 'runtimes', 'ffmpeg', 'bin', isWin ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(localBin)) return localBin;
  }
  const wingetBin = findWinGetFfmpeg();
  if (wingetBin) return wingetBin;
  return 'ffmpeg';
}

async function detectUvBinary(dataDir) {
  const candidates = [];
  if (dataDir) candidates.push(path.join(dataDir, 'runtimes', 'bin', isWin ? 'uv.exe' : 'uv'));
  candidates.push('uv');
  candidates.push(path.join(os.homedir(), '.local', 'bin', isWin ? 'uv.exe' : 'uv'));
  candidates.push(path.join(os.homedir(), '.cargo', 'bin', isWin ? 'uv.exe' : 'uv'));
  for (const c of candidates) {
    if (path.isAbsolute(c) && !fs.existsSync(c)) continue;
    const r = await execCapture(c, ['--version'], { timeoutMs: 4000 });
    if (r.ok && /uv\s+\d/i.test(r.stdout)) return c;
  }
  return null;
}

async function detectBasePython() {
  const candidates = isWin
    ? [['python', []], ['py', ['-3']], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [cmd, prefix] of candidates) {
    const r = await execCapture(cmd, [...prefix, '-c', 'import sys; print(sys.executable); print(sys.version.split()[0])'], { timeoutMs: 5000 });
    if (r.ok && r.stdout) {
      const lines = r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const exe = lines[0];
      const ver = lines[1] || '';
      if (exe && !/WindowsApps/i.test(exe) && /^3\.(9|10|11|12|13)/.test(ver)) {
        return { cmd: exe, version: ver };
      }
    }
  }
  return null;
}

export class DependencyManager {
  constructor(dataDir, opts = {}) {
    this.dataDir = dataDir;
    this.runtimesDir = path.join(dataDir, 'runtimes');
    this.manifestPath = path.join(this.runtimesDir, 'manifest.json');
    this.activeJobs = new Map(); // id -> { cancel: fn, state }
    this.customRunner = opts.customRunner || null; // test injection hook
    this.manifest = this._loadManifest();
  }

  _loadManifest() {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return { version: 1, consents: {}, installed: {} };
  }

  _saveManifest() {
    fs.mkdirSync(this.runtimesDir, { recursive: true });
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), 'utf8');
  }

  installTargetPath(spec) {
    if (spec.kind === 'python_venv') return path.join(this.runtimesDir, spec.venv_name);
    if (spec.kind === 'http_file') return path.join(this.dataDir, ...spec.target_rel);
    if (spec.kind === 'system_tool') return isWin ? 'WinGet / PATH (Gyan.FFmpeg)' : 'Homebrew / System PATH';
    return this.runtimesDir;
  }

  async check(id) {
    const spec = getSpecById(id);
    if (!spec) throw new Error(`未知依赖项: ${id}`);

    const active = this.activeJobs.get(id);
    const targetPath = this.installTargetPath(spec);
    const base = {
      id: spec.id,
      name: spec.name,
      name_en: spec.name_en,
      purpose: spec.purpose,
      purpose_en: spec.purpose_en,
      used_by: spec.used_by,
      used_by_en: spec.used_by_en,
      size_hint: spec.size_hint,
      kind: spec.kind,
      install_path: targetPath,
      fallback_note: spec.fallback_note,
      fallback_note_en: spec.fallback_note_en,
      installing: Boolean(active),
      progress: active ? active.state : null,
      removable: false,
      installed: false,
      source: 'missing',
      version: '',
      binary_path: '',
    };

    if (spec.kind === 'python_venv') {
      const venvPy = venvPythonPath(this.dataDir, spec.venv_name);
      if (fs.existsSync(venvPy)) {
        const r = await execCapture(venvPy, ['-c', spec.import_check], { timeoutMs: 12000 });
        if (r.ok) {
          return {
            ...base,
            installed: true,
            source: 'isolated_venv',
            removable: true,
            version: r.stdout.split(/\r?\n/).pop() || 'ok',
            binary_path: venvPy,
          };
        }
      }
      // Also check system python if available (read-only, non-removable)
      const sysPy = await detectBasePython();
      if (sysPy) {
        const r = await execCapture(sysPy.cmd, ['-c', spec.import_check], { timeoutMs: 12000 });
        if (r.ok) {
          return {
            ...base,
            installed: true,
            source: 'system_python',
            removable: false,
            version: r.stdout.split(/\r?\n/).pop() || 'ok',
            binary_path: sysPy.cmd,
          };
        }
      }
      return base;
    }

    if (spec.kind === 'http_file') {
      const filePath = path.join(this.dataDir, ...spec.target_rel);
      if (fs.existsSync(filePath)) {
        const st = fs.statSync(filePath);
        if (st.size >= (spec.min_bytes || 1024)) {
          return {
            ...base,
            installed: true,
            source: 'local_model',
            removable: true,
            version: `${(st.size / (1024 * 1024)).toFixed(1)} MB`,
            binary_path: filePath,
          };
        }
      }
      return base;
    }

    if (spec.kind === 'system_tool' && spec.binary === 'ffmpeg') {
      const bin = resolveFfmpegBinary(this.dataDir);
      const r = await execCapture(bin, ['-version'], { timeoutMs: 5000 });
      if (r.ok) {
        const first = (r.stdout.split(/\r?\n/)[0] || '').trim();
        const verMatch = first.match(/ffmpeg version\s+([^\s]+)/i);
        const managed = bin.startsWith(this.runtimesDir);
        return {
          ...base,
          installed: true,
          source: managed ? 'isolated_binary' : 'system_path',
          removable: managed,
          version: verMatch ? verMatch[1] : 'installed',
          binary_path: bin,
        };
      }
      return base;
    }

    return base;
  }

  async listAll() {
    const items = [];
    for (const spec of DEP_SPECS) {
      items.push(await this.check(spec.id));
    }
    return {
      runtimes_dir: this.runtimesDir,
      items,
    };
  }

  async resolvePythonFor(id) {
    const status = await this.check(id);
    if (!status.installed || !status.binary_path) return null;
    return status;
  }

  cancel(id) {
    const job = this.activeJobs.get(id);
    if (!job) return { cancelled: false };
    job.cancelled = true;
    try { job.cancel(); } catch {}
    return { cancelled: true, id };
  }

  async uninstall(id) {
    const spec = getSpecById(id);
    if (!spec) throw new Error(`未知依赖项: ${id}`);
    if (this.activeJobs.has(id)) throw new Error('该依赖正在安装中，请先取消后再卸载。');

    if (spec.kind === 'python_venv') {
      const dir = path.join(this.runtimesDir, spec.venv_name);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } else if (spec.kind === 'http_file') {
      const file = path.join(this.dataDir, ...spec.target_rel);
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      const part = file + '.part';
      if (fs.existsSync(part)) fs.rmSync(part, { force: true });
    } else if (spec.kind === 'system_tool') {
      const dir = path.join(this.runtimesDir, spec.binary);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    delete this.manifest.installed[id];
    this._saveManifest();
    return this.check(id);
  }

  async install(id, opts = {}) {
    const spec = getSpecById(id);
    if (!spec) throw new Error(`未知依赖项: ${id}`);
    if (opts.approved !== true) {
      const err = new Error('CONSENT_REQUIRED: 必须先征得用户同意才能下载和安装本地依赖。');
      err.code = 'CONSENT_REQUIRED';
      throw err;
    }
    if (this.activeJobs.has(id)) {
      throw new Error(`${spec.name} 正在安装中，请稍候。`);
    }

    // Record explicit user consent timestamp
    this.manifest.consents[id] = {
      approved: true,
      approved_at: new Date().toISOString(),
      reason: String(opts.reason || 'user_confirmed'),
    };
    this._saveManifest();

    const job = {
      cancelled: false,
      child: null,
      abortController: new AbortController(),
      state: { id, status: 'installing', pct: 3, stage: '已获用户同意，准备隔离环境…', log: '' },
      cancel: () => {
        job.cancelled = true;
        try { job.abortController.abort(); } catch {}
        try { if (job.child) job.child.kill(); } catch {}
      },
    };
    this.activeJobs.set(id, job);

    const report = (pct, stage, log = '', status = 'installing') => {
      job.state = { id, status, pct, stage, log: String(log || '').slice(-280) };
      if (typeof opts.onProgress === 'function') {
        try { opts.onProgress(job.state); } catch {}
      }
    };

    try {
      report(5, '正在检查本机环境…');
      if (this.customRunner) {
        await this.customRunner(spec, { report, job, dataDir: this.dataDir });
      } else if (spec.kind === 'python_venv') {
        await this._installPythonVenv(spec, job, report);
      } else if (spec.kind === 'http_file') {
        await this._installHttpFile(spec, job, report);
      } else if (spec.kind === 'system_tool') {
        await this._installSystemTool(spec, job, report);
      }

      if (job.cancelled) {
        report(0, '用户已取消安装', '', 'cancelled');
        throw new Error('INSTALL_CANCELLED: 用户已取消安装。');
      }

      report(94, '正在校验依赖可用性…', '', 'verifying');
      const verified = await this.check(id);
      if (!verified.installed) {
        throw new Error(`安装流程完成但校验未通过，请查看日志或检查网络连接后重试。`);
      }

      this.manifest.installed[id] = {
        installed_at: new Date().toISOString(),
        version: verified.version,
        source: verified.source,
        binary_path: verified.binary_path,
      };
      this._saveManifest();
      report(100, `✓ ${spec.name} 安装并校验完成（${verified.version}）`, '', 'installed');
      return verified;
    } catch (err) {
      const status = job.cancelled ? 'cancelled' : 'error';
      report(0, err?.message || String(err), '', status);
      throw err;
    } finally {
      this.activeJobs.delete(id);
    }
  }

  async _installPythonVenv(spec, job, report) {
    fs.mkdirSync(this.runtimesDir, { recursive: true });
    const venvDir = path.join(this.runtimesDir, spec.venv_name);
    const venvPy = venvPythonPath(this.dataDir, spec.venv_name);

    const uvBin = await detectUvBinary(this.dataDir);
    let basePy = uvBin ? null : await detectBasePython();

    if (!uvBin && !basePy) {
      // Customer's machine has neither uv nor Python — try OS package manager bootstrap!
      report(10, '未检测到 Python，正在尝试自动部署 Python 3.11…');
      if (isWin) {
        const wg = await execCapture('winget', ['install', '--id', 'Python.Python.3.11', '-e', '--accept-package-agreements', '--accept-source-agreements'], {
          onSpawn: c => { job.child = c; },
          onLine: l => report(15, '正在通过 WinGet 部署 Python 3.11…', l),
        });
        if (!wg.ok) throw new Error('本机未安装 Python 3.11 且 WinGet 自动安装失败，请先安装 Python 3.11+ 或 uv 后重试。');
      } else if (process.platform === 'darwin') {
        const br = await execCapture('brew', ['install', 'python@3.11'], {
          onSpawn: c => { job.child = c; },
          onLine: l => report(15, '正在通过 Homebrew 部署 Python 3.11…', l),
        });
        if (!br.ok) throw new Error('本机未安装 Python 3.11，请先安装 Python 3.11+ 或 uv 后重试。');
      } else {
        throw new Error('本机未检测到 Python 3.11+ 或 uv，请先安装 python3-venv 或 uv。');
      }
      basePy = await detectBasePython();
      if (!basePy) throw new Error('Python 已安装但需要重新打开浏览器识别 PATH，请重启后再试。');
    }

    if (job.cancelled) return;

    if (!fs.existsSync(venvPy)) {
      report(20, `正在创建隔离虚拟环境 (${spec.venv_name})…`);
      if (uvBin) {
        const r = await execCapture(uvBin, ['venv', venvDir, '--python', '3.11', '--seed'], {
          onSpawn: c => { job.child = c; },
          onLine: l => report(26, 'uv 正在创建隔离 Python 3.11 环境…', l),
        });
        if (!r.ok) {
          // Fallback to uv venv with default discovered python
          const r2 = await execCapture(uvBin, ['venv', venvDir, '--seed'], {
            onSpawn: c => { job.child = c; },
            onLine: l => report(28, 'uv 正在创建隔离环境…', l),
          });
          if (!r2.ok) throw new Error(`创建隔离环境失败: ${r2.stderr || r.stderr}`);
        }
      } else {
        const r = await execCapture(basePy.cmd, ['-m', 'venv', venvDir], {
          onSpawn: c => { job.child = c; },
          onLine: l => report(28, '正在创建 Python 隔离虚拟环境…', l),
        });
        if (!r.ok) throw new Error(`创建 Python 虚拟环境失败: ${r.stderr}`);
      }
    }

    if (job.cancelled) return;

    const pkgLabel = spec.packages.join(' + ');
    report(38, `正在安装 ${pkgLabel}（首次下载可能需要 1–3 分钟）…`);

    const runPkgInstall = async useMirror => {
      if (uvBin) {
        const args = ['pip', 'install', '--python', venvPy, ...spec.packages];
        if (useMirror) args.push('--default-index', MIRROR_PYPI);
        return execCapture(uvBin, args, {
          onSpawn: c => { job.child = c; },
          onLine: l => report(useMirror ? 68 : 58, `正在下载安装 ${pkgLabel}${useMirror ? '（国内镜像加速）' : ''}…`, l),
        });
      }
      const args = ['-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', ...spec.packages];
      if (useMirror) args.push('-i', MIRROR_PYPI, '--trusted-host', 'pypi.tuna.tsinghua.edu.cn');
      return execCapture(venvPy, args, {
        onSpawn: c => { job.child = c; },
        onLine: l => report(useMirror ? 68 : 58, `正在下载安装 ${pkgLabel}${useMirror ? '（国内镜像加速）' : ''}…`, l),
      });
    };

    // Try Tsinghua mirror first if zh locale or fallback seamlessly across both mirrors
    const preferMirrorFirst = /^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale || '');
    let res = await runPkgInstall(preferMirrorFirst);
    if (!res.ok && !job.cancelled) {
      report(62, `主源较慢或不可达，自动切换备用镜像源重试 ${pkgLabel}…`, res.stderr);
      res = await runPkgInstall(!preferMirrorFirst);
    }
    if (!res.ok && !job.cancelled) {
      throw new Error(`安装 ${pkgLabel} 失败: ${(res.stderr || res.stdout || '').slice(-300)}`);
    }
  }

  async _installHttpFile(spec, job, report) {
    const dest = path.join(this.dataDir, ...spec.target_rel);
    const part = dest + '.part';
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    let lastErr = null;
    for (let i = 0; i < spec.urls.length; i++) {
      if (job.cancelled) return;
      const url = spec.urls[i];
      report(10 + i * 5, `正在下载模型文件（源 ${i + 1}/${spec.urls.length}）…`, url);
      try {
        const res = await fetch(url, { signal: job.abortController.signal, redirect: 'follow' });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const total = Number(res.headers.get('content-length') || 0);
        const ws = fs.createWriteStream(part);
        const reader = res.body.getReader();
        let received = 0;
        let lastReportAt = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (job.cancelled) {
              ws.destroy();
              throw new Error('CANCELLED');
            }
            ws.write(Buffer.from(value));
            received += value.byteLength;
            const now = Date.now();
            if (now - lastReportAt > 250) {
              lastReportAt = now;
              const pct = total > 0 ? Math.min(90, Math.round(15 + (received / total) * 75)) : 50;
              const mb = (received / (1024 * 1024)).toFixed(1);
              const totalMb = total > 0 ? ` / ${(total / (1024 * 1024)).toFixed(1)} MB` : ' MB';
              report(pct, `正在下载 ${path.basename(dest)}：${mb}${totalMb}`, url);
            }
          }
          await new Promise((resolve, reject) => {
            ws.end(err => (err ? reject(err) : resolve()));
          });
        } catch (streamErr) {
          try { ws.destroy(); } catch {}
          try { fs.rmSync(part, { force: true }); } catch {}
          throw streamErr;
        }
        const st = fs.statSync(part);
        if (st.size < (spec.min_bytes || 1024)) {
          fs.rmSync(part, { force: true });
          throw new Error(`下载文件不完整（仅 ${st.size} bytes）`);
        }
        fs.renameSync(part, dest);
        return;
      } catch (err) {
        lastErr = err;
        try { fs.rmSync(part, { force: true }); } catch {}
        if (job.cancelled) return;
      }
    }
    throw new Error(`下载 ${spec.name} 失败: ${lastErr?.message || '网络不可达'}`);
  }

  async _installSystemTool(spec, job, report) {
    if (spec.binary !== 'ffmpeg') throw new Error(`暂不支持自动安装 ${spec.binary}`);
    if (isWin) {
      report(25, '正在通过 Windows WinGet 安装 Gyan.FFmpeg…');
      const r = await execCapture('winget', [
        'install', '--id', spec.winget_id, '-e',
        '--accept-package-agreements', '--accept-source-agreements',
      ], {
        onSpawn: c => { job.child = c; },
        onLine: l => report(55, '正在安装 FFmpeg…', l),
      });
      if (!r.ok && !job.cancelled) {
        throw new Error(`WinGet 安装 FFmpeg 失败: ${(r.stderr || r.stdout || '').slice(-260)}`);
      }
      return;
    }
    if (process.platform === 'darwin') {
      report(25, '正在通过 Homebrew 安装 FFmpeg…');
      const r = await execCapture('brew', ['install', spec.brew_pkg], {
        onSpawn: c => { job.child = c; },
        onLine: l => report(55, '正在安装 FFmpeg…', l),
      });
      if (!r.ok && !job.cancelled) {
        throw new Error(`Homebrew 安装 FFmpeg 失败: ${(r.stderr || r.stdout || '').slice(-260)}`);
      }
      return;
    }
    throw new Error('Linux 环境请使用系统包管理器安装 ffmpeg（例如 sudo apt install -y ffmpeg）。');
  }

  /**
   * Execute parametric-cadquery.py with verified isolated/system CadQuery runtime
   * to compile true smooth-fillet OpenCASCADE B-Rep .STEP and .STL files.
   */
  async compileCadQueryDraft(pyPath, outDir) {
    const status = await this.resolvePythonFor('cadquery');
    if (!status) {
      const err = new Error('MISSING_DEPENDENCY: cadquery');
      err.code = 'MISSING_DEPENDENCY';
      err.dependency = await this.check('cadquery');
      throw err;
    }
    const r = await execCapture(status.binary_path, [pyPath, '--out-dir', outDir], {
      cwd: outDir,
      timeoutMs: 90000,
    });
    if (!r.ok) {
      throw new Error(`CadQuery 编译失败: ${(r.stderr || r.stdout || '').slice(-320)}`);
    }
    const markerLine = r.stdout.split(/\r?\n/).reverse().find(l => l.startsWith('VA_CAD_RESULT:'));
    let parsed = null;
    if (markerLine) {
      try { parsed = JSON.parse(markerLine.slice('VA_CAD_RESULT:'.length)); } catch {}
    }
    return {
      ok: true,
      kernel: 'cadquery_occt',
      cadquery_version: status.version,
      python_path: status.binary_path,
      volume_cm3: parsed?.volume_cm3 ?? null,
      step_path: parsed?.step_path || path.join(outDir, 'model-draft.step'),
      stl_path: parsed?.stl_path || path.join(outDir, 'prototype-3dprint.stl'),
      stdout: r.stdout,
    };
  }
}
