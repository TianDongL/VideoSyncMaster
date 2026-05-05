import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'

console.log("Main process script loaded.");
process.on('uncaughtException', (error) => {
  console.error("Uncaught exception in main process:", error);
});
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { spawn, exec, ChildProcess } from 'child_process'
import fs from 'fs'

const activeDownloads = new Map<string, ChildProcess>();

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let activeBackendProcess: any = null


function createWindow() {
  console.log("createWindow called");
  // ... existing createWindow code ...
  win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1500,
    minHeight: 750,
    icon: path.join(process.env.VITE_PUBLIC, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false // Allow loading local resources (file://)
    },
    autoHideMenuBar: true, // Hide the default menu bar (File, Edit, etc.)
  })
  console.log("BrowserWindow created, id:", win.id);

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

// Check if VC++ Runtime is installed by looking for common DLLs
async function checkVCRuntimeInstalled(): Promise<boolean> {
  // Check for vcruntime140.dll in System32
  const systemRoot = process.env.SYSTEMROOT || 'C:\\Windows';
  const dllPath = path.join(systemRoot, 'System32', 'vcruntime140.dll');
  return fs.existsSync(dllPath);
}

// Install VC++ Runtime from bundled installer
async function installVCRuntime(projectRoot: string): Promise<boolean> {
  const vcRedistPath = path.join(projectRoot, 'VC_redist.x64.exe');

  if (!fs.existsSync(vcRedistPath)) {
    console.log('[VCRuntime] VC_redist.x64.exe not found, skipping installation.');
    return false;
  }

  console.log('[VCRuntime] Installing VC++ Runtime...');

  return new Promise((resolve) => {
    const installProcess = spawn(vcRedistPath, ['/install', '/quiet', '/norestart'], {
      stdio: 'ignore'
    });

    installProcess.on('close', (code) => {
      if (code === 0 || code === 3010) { // 3010 = success, reboot required
        console.log('[VCRuntime] Installation successful.');
        resolve(true);
      } else {
        console.error('[VCRuntime] Installation failed with code:', code);
        resolve(false);
      }
    });

    installProcess.on('error', (err) => {
      console.error('[VCRuntime] Installation error:', err);
      resolve(false);
    });
  });
}

// Check and install VC++ Runtime if needed
async function checkAndInstallVCRuntime(): Promise<void> {
  const isInstalled = await checkVCRuntimeInstalled();

  if (isInstalled) {
    console.log('[VCRuntime] VC++ Runtime is already installed.');
    return;
  }

  console.log('[VCRuntime] VC++ Runtime not detected, attempting installation...');

  // Determine project root
  const projectRoot = app.isPackaged
    ? path.dirname(process.resourcesPath)
    : path.resolve(__dirname, '..', '..');

  const success = await installVCRuntime(projectRoot);

  if (!success) {
    // Show a dialog to inform the user
    const { dialog: earlyDialog } = require('electron');
    earlyDialog.showMessageBoxSync({
      type: 'warning',
      title: '运行时组件缺失',
      message: 'Microsoft Visual C++ 运行时库安装失败。\n\n如果程序无法正常运行，请手动运行程序目录下的 VC_redist.x64.exe 进行安装。',
      buttons: ['确定']
    });
  }
}

app.whenReady().then(async () => {
  console.log("App is ready, checking VC++ Runtime...");

  // Check and install VC++ Runtime before creating window
  await checkAndInstallVCRuntime();

  console.log("Creating window...");
  createWindow()


  // IPC Handler for converting path to file URL (robust encoding)
  ipcMain.handle('get-file-url', async (_event, filePath: string) => {
    return pathToFileURL(filePath).href
  })

  // IPC Handler for saving files (used for temp json)
  ipcMain.handle('save-file', async (_event: any, filePath: string, content: string) => {
    return new Promise((resolve, reject) => {
      fs.writeFile(filePath, content, 'utf-8', (err: any) => {
        if (err) reject(err)
        else resolve(true)
      })
    })
  })

  // IPC Handler for file dialog
  ipcMain.handle('dialog:openFile', async (_event, options) => {
    if (!win) return { canceled: true, filePaths: [] }
    return await dialog.showOpenDialog(win, options)
  })

  ipcMain.handle('dialog:showSaveDialog', async (_event, options) => {
    if (!win) return { canceled: true, filePath: undefined }
    return await dialog.showSaveDialog(win, options)
  })

  // IPC Handler for directory creation
  ipcMain.handle('ensure-dir', async (_event: any, dirPath: string) => {
    return new Promise((resolve, reject) => {
      fs.mkdir(dirPath, { recursive: true }, (err: any) => {
        if (err) reject(err)
        else resolve(true)
      })
    })
  })

  // IPC Handler to get paths
  ipcMain.handle('get-paths', async () => {
    const projectRoot = app.isPackaged
      ? path.dirname(process.resourcesPath)
      : path.resolve(process.env.APP_ROOT, '..');
    const outputDir = path.join(projectRoot, 'output');
    return { projectRoot, outputDir };
  })

  // IPC Handler for Python Backend
  ipcMain.handle('run-backend', async (_event: any, args: any[]) => {
    return new Promise((resolve, reject) => {
      console.log('Running backend with args:', args)

      const projectRoot = app.isPackaged
        ? path.dirname(process.resourcesPath)
        : path.resolve(process.env.APP_ROOT, '..');

      // Uniform logic for Dev and Prod since structures are now identical
      const pythonExe = path.join(projectRoot, 'python', 'python.exe');
      const scriptPath = path.join(projectRoot, 'backend', 'main.py');
      const modelsDir = path.join(projectRoot, 'models', 'index-tts', 'hub');

      console.log('Spawning Backend:', { pythonExe, scriptPath, modelsDir });

      const finalPythonExe = (app.isPackaged || fs.existsSync(pythonExe)) ? pythonExe : 'python';

      if (finalPythonExe !== 'python' && !fs.existsSync(finalPythonExe)) {
        reject(new Error(`Python environment not found at ${finalPythonExe}`));
        return;
      }

      if (!fs.existsSync(scriptPath)) {
        reject(new Error(`Backend script not found at ${scriptPath}`));
        return;
      }

      const backendProcess = spawn(finalPythonExe, [scriptPath, '--json', '--model_dir', modelsDir, ...args], {
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      });

      activeBackendProcess = backendProcess


      let outputData = ''
      let errorData = ''

      if (backendProcess) {
        backendProcess.stdout.on('data', (data: any) => {
          const str = data.toString()

          const lines = str.split('\n');
          lines.forEach((line: string) => {
            // Parse progress markers: [PROGRESS] 50
            const progressMatch = line.match(/\[PROGRESS\]\s*(\d+)/);
            if (progressMatch) {
              const p = parseInt(progressMatch[1], 10);
              _event.sender.send('backend-progress', p);
            }

            // Parse partial results: [PARTIAL] json
            const partialMatch = line.match(/\[PARTIAL\]\s*(.*)/);
            if (partialMatch) {
              try {
                const pData = JSON.parse(partialMatch[1].trim());
                _event.sender.send('backend-partial-result', pData);
              } catch (e) {
                console.error("Failed to parse partial:", e);
              }
            }

            // Parse dependency installation markers: [DEPS_INSTALLING] package
            const depsMatch = line.match(/\[DEPS_INSTALLING\]\s*(.*)/);
            if (depsMatch) {
              const packageDesc = depsMatch[1].trim();
              _event.sender.send('backend-deps-installing', packageDesc);
            }

            // Parse dependency completion markers: [DEPS_DONE] package
            const depsDoneMatch = line.match(/\[DEPS_DONE\]\s*(.*)/);
            if (depsDoneMatch) {
              _event.sender.send('backend-deps-done');
            }
          });

          console.log('[Py Stdout]:', str)
          outputData += str
        })

        backendProcess.stderr.on('data', (data: any) => {
          const str = data.toString()
          console.error('[Py Stderr]:', str)
          errorData += str
        })

        backendProcess.on('close', (code: number) => {
          if (activeBackendProcess === backendProcess) activeBackendProcess = null;
          if (code !== 0) {
            reject(new Error(`Python process exited with code ${code}. Error: ${errorData}`))
            return
          }

          // Parse JSON output
          try {
            const startMarker = '__JSON_START__'
            const endMarker = '__JSON_END__'
            const startIndex = outputData.indexOf(startMarker)
            const endIndex = outputData.lastIndexOf(endMarker) // Use lastIndexOf for safety

            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
              let jsonFullStr = outputData.substring(startIndex + startMarker.length, endIndex).trim()

              // [ROBUST] Find the actual JSON object boundaries within the markers
              const firstBrace = jsonFullStr.indexOf('{')
              const lastBrace = jsonFullStr.lastIndexOf('}')
              const firstBracket = jsonFullStr.indexOf('[')
              const lastBracket = jsonFullStr.lastIndexOf(']')

              // Determine if it's an object or array based on what comes first
              let startIdx = -1;
              let endIdx = -1;

              // If both exist, take the earlier one. If only one exists, take it.
              if (firstBrace !== -1 && firstBracket !== -1) {
                if (firstBrace < firstBracket) {
                  startIdx = firstBrace;
                  endIdx = lastBrace;
                } else {
                  startIdx = firstBracket;
                  endIdx = lastBracket;
                }
              } else if (firstBrace !== -1) {
                startIdx = firstBrace;
                endIdx = lastBrace;
              } else if (firstBracket !== -1) {
                startIdx = firstBracket;
                endIdx = lastBracket;
              }

              if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const cleanJsonStr = jsonFullStr.substring(startIdx, endIdx + 1)
                const result = JSON.parse(cleanJsonStr)
                resolve(result)
              } else {
                // Fallback (e.g. simple primitives or clean string)
                const result = JSON.parse(jsonFullStr)
                resolve(result)
              }
            } else {
              console.warn('JSON markers not found or invalid in output')
              resolve({ rawOutput: outputData, rawError: errorData })
            }
          } catch (e) {
            console.error('Failed to parse backend output. Raw:', outputData);
            reject(new Error(`Failed to parse backend output: ${e}`))
          }
        })
      } else {
        reject(new Error("Failed to spawn backend process"));
      }
    })
  })

  ipcMain.handle('cache-video', async (_event, filePath: string) => {
    try {
      // Determine .cache folder path
      let projectRoot;
      if (app.isPackaged) {
        projectRoot = path.dirname(process.resourcesPath);
      } else {
        projectRoot = path.resolve(process.env.APP_ROOT, '..');
      }
      const cacheDir = path.join(projectRoot, '.cache');

      // Ensure .cache exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // 1. If input file is already in .cache, assume it's cached and return as is.
      // Normalize paths for comparison
      const normalizedInput = path.normalize(filePath);
      const normalizedCache = path.normalize(cacheDir);

      if (normalizedInput.startsWith(normalizedCache)) {
        return normalizedInput;
      }

      // 2. Compute stable filename based on input path hash
      // This ensures same file path maps to same cached file
      const crypto = require('node:crypto');
      const hash = crypto.createHash('md5').update(normalizedInput).digest('hex');
      const basename = path.basename(filePath);
      // Limit filename length just in case
      const safeBasename = `${hash.substring(0, 12)}_${basename}`;
      const destPath = path.join(cacheDir, safeBasename);

      // 3. Check if we already have it
      if (fs.existsSync(destPath)) {
        console.log(`Using existing cached file for: ${filePath}`);
        return destPath;
      }

      // 4. Copy if new
      console.log(`Caching new file: ${filePath} -> ${destPath}`);
      await fs.promises.copyFile(filePath, destPath);

      return destPath;
    } catch (error) {
      console.error('Failed to cache video:', error);
      throw error;
    }
  })

  // IPC Handler to open folder
  ipcMain.handle('open-folder', async (_event, filePath: string) => {
    try {
      // if filePath is file, show item in folder. If dir, open path.
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          await shell.openPath(filePath);
        } else {
          shell.showItemInFolder(filePath);
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error("Failed to open folder:", e);
      return false;
    }
  })

  // IPC Handler to open file externally (system default player)
  ipcMain.handle('open-external', async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath);
      return true;
    } catch (e) {
      console.error("Failed to open external:", e);
      return false;
    }
  })

  // IPC Handler to kill backend
  ipcMain.handle('kill-backend', async () => {
    if (activeBackendProcess) {
      try {
        const pid = activeBackendProcess.pid;
        console.log(`Killing python process ${pid}...`);

        if (process.platform === 'win32') {
          // Force kill tree
          const { exec } = await import('child_process');
          exec(`taskkill /pid ${pid} /T /F`);
        } else {
          activeBackendProcess.kill('SIGKILL');
        }
        activeBackendProcess = null;
        return true;
      } catch (e) {
        console.error("Failed to kill backend:", e);
        return false;
      }
    }
    return true; // No process running, technically success
  })
  // IPC Handler to open backend log
  ipcMain.handle('open-backend-log', async () => {
    try {
      let projectRoot;
      if (app.isPackaged) {
        projectRoot = path.dirname(process.resourcesPath);
      } else {
        projectRoot = path.resolve(process.env.APP_ROOT, '..');
      }

      const logPath = path.join(projectRoot, 'logs', 'backend_debug.log');

      if (!fs.existsSync(logPath)) {
        console.error(`Log file not found at: ${logPath}`);
        return { success: false, error: 'Log file not found' };
      }

      const error = await shell.openPath(logPath);
      if (error) {
        console.error(`Failed to open log: ${error}`);
        return { success: false, error };
      }
      return { success: true };
    } catch (e) {
      console.error("Failed to open backend log:", e);
      return { success: false, error: String(e) };
    }
  })

  // IPC Handler to repair python environment
  ipcMain.handle('fix-python-env', async (_event) => {
    return new Promise((resolve) => {
      try {
        const projectRoot = app.isPackaged
          ? path.dirname(process.resourcesPath)
          : path.resolve(process.env.APP_ROOT, '..');

        const pythonExe = path.join(projectRoot, 'python', 'python.exe');
        const requirementsPath = path.join(projectRoot, 'requirements.txt');

        if (!fs.existsSync(pythonExe)) {
          resolve({ success: false, error: `找不到 Python 解释器。请确认 python 文件夹存在于 ${projectRoot}` });
          return;
        }

        if (!fs.existsSync(requirementsPath)) {
          resolve({ success: false, error: `找不到 requirements.txt。请确认文件存在于 ${projectRoot}` });
          return;
        }

        console.log(`[FixEnv] Starting repair... Python: ${pythonExe}, Req: ${requirementsPath}`);

        const installProcess = spawn(pythonExe, ['-m', 'pip', 'install', '-r', requirementsPath], {
          env: { ...process.env, PYTHONUTF8: '1' }
        });

        let output = '';
        let errorOut = '';

        installProcess.stdout.on('data', (data) => {
          console.log(`[Pip]: ${data}`);
          output += data.toString();
        });

        installProcess.stderr.on('data', (data) => {
          console.error(`[Pip Err]: ${data}`);
          errorOut += data.toString();
        });

        installProcess.on('close', (code) => {
          if (code === 0) {
            console.log('[FixEnv] Success!');
            resolve({ success: true, output });
          } else {
            console.error('[FixEnv] Failed code:', code);
            resolve({ success: false, error: `Pip install failed (Code ${code}). \nError: ${errorOut}` });
          }
        });

        installProcess.on('error', (err) => {
          resolve({ success: false, error: `Spawn error: ${err.message}` });
        });

      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });
  })

  // IPC Handler to check python environment (list missing deps)
  ipcMain.handle('check-python-env', async (_event) => {
    return new Promise((resolve) => {
      try {
        const projectRoot = app.isPackaged
          ? path.dirname(process.resourcesPath)
          : path.resolve(process.env.APP_ROOT, '..');

        const pythonExe = path.join(projectRoot, 'python', 'python.exe');
        const requirementsPath = path.join(projectRoot, 'requirements.txt');
        const checkScriptPath = path.join(projectRoot, 'backend', 'check_requirements.py');

        if (!fs.existsSync(pythonExe)) {
          resolve({ success: false, status: 'missing_python', error: `找不到 Python 解释器。请确认 python 文件夹存在于 ${projectRoot}` });
          return;
        }
        if (!fs.existsSync(requirementsPath)) {
          resolve({ success: false, error: "requirements.txt not found" });
          return;
        }
        if (!fs.existsSync(checkScriptPath)) {
          resolve({ success: false, error: "check_requirements.py not found" });
          return;
        }

        const checkProcess = spawn(pythonExe, [checkScriptPath, requirementsPath, '--json'], {
          env: { ...process.env, PYTHONUTF8: '1' }
        });

        let output = '';
        checkProcess.stdout.on('data', (data) => output += data.toString());
        checkProcess.stderr.on('data', (data) => console.error('[CheckEnv Err]:', data.toString()));

        checkProcess.on('close', (code) => {
          try {
            // Attempt to find JSON in output
            const jsonStart = output.indexOf('{');
            const jsonEnd = output.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
              const jsonStr = output.substring(jsonStart, jsonEnd + 1);
              const result = JSON.parse(jsonStr);
              resolve({ success: true, missing: result.missing || [] });
            } else {
              // No JSON found
              if (code === 0 && !output.trim()) resolve({ success: true, missing: [] }); // Empty output usually OK if logic implies success, but our script prints success msg.
              // Actually our script prints "All good" if no JSON.
              // Ideally we look for success status or non-zero code.
              if (code !== 0) resolve({ success: false, error: "Dependency check failed (non-zero exit)" });
              else resolve({ success: true, missing: [] });
            }
          } catch (e: any) {
            resolve({ success: false, error: `Parse error: ${e.message}` });
          }
        });

        checkProcess.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });

      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });
  })

  // Helper function to resolve Models Root
  const resolveModelsRoot = () => {
    let modelsRoot = '';
    let projectRoot = '';

    if (app.isPackaged) {
      projectRoot = path.dirname(process.resourcesPath);
      if (process.env.PORTABLE_EXECUTABLE_DIR) {
        modelsRoot = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'models');
      } else {
        modelsRoot = path.join(projectRoot, 'models');
      }
    } else {
      // In Dev: Strict Project Root Only
      projectRoot = path.resolve(process.env.APP_ROOT, '..');
      modelsRoot = path.join(projectRoot, 'models');
    }
    return { modelsRoot, projectRoot };
  };

  // IPC Handler to check model status
  ipcMain.handle('check-model-status', async (_event) => {
    return new Promise((resolve) => {
      try {
        const { modelsRoot } = resolveModelsRoot();
        console.log('[CheckModel] Models Root:', modelsRoot);

        const checkDir = (subpath: string[]) => {
          // Check variations
          for (const p of subpath) {
            const fullPath = path.join(modelsRoot, p);
            if (fs.existsSync(fullPath)) return true;
          }
          return false;
        };

        // Specific checks
        const status = {
          whisperx: checkDir(['faster-whisper-large-v3-turbo-ct2', 'whisperx/faster-whisper-large-v3-turbo-ct2']),
          alignment: checkDir(['alignment']),
          index_tts: checkDir(['index-tts', 'index-tts/hub']),
          qwen: checkDir(['Qwen2.5-7B-Instruct', 'qwen/Qwen2.5-7B-Instruct']),
          qwen_tokenizer: checkDir(['Qwen3-TTS-Tokenizer-12Hz', 'Qwen/Qwen3-TTS-Tokenizer-12Hz']),
          qwen_17b_base: checkDir(['Qwen3-TTS-12Hz-1.7B-Base', 'Qwen/Qwen3-TTS-12Hz-1.7B-Base']),
          qwen_17b_design: checkDir(['Qwen3-TTS-12Hz-1.7B-VoiceDesign', 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign']),
          qwen_17b_custom: checkDir(['Qwen3-TTS-12Hz-1.7B-CustomVoice', 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice']),
          qwen_06b_base: checkDir(['Qwen3-TTS-12Hz-0.6B-Base', 'Qwen/Qwen3-TTS-12Hz-0.6B-Base']),
          qwen_06b_custom: checkDir(['Qwen3-TTS-12Hz-0.6B-CustomVoice', 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice']),
          qwen_asr_06b: checkDir(['Qwen3-ASR-0.6B', 'Qwen/Qwen3-ASR-0.6B']),
          qwen_asr_17b: checkDir(['Qwen3-ASR-1.7B', 'Qwen/Qwen3-ASR-1.7B']),
          qwen_asr_aligner: checkDir(['Qwen3-ForcedAligner-0.6B', 'Qwen/Qwen3-ForcedAligner-0.6B']),
          rife: checkDir(['rife', 'rife-ncnn-vulkan'])
        };

        resolve({ success: true, status, root: modelsRoot });

      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });
  });

  // IPC Handler to check file existence (Robust check)
  ipcMain.handle('check-file-exists', async (_event, filePath: string) => {
    try {
      if (!filePath) return false;
      return fs.existsSync(filePath);
    } catch (e) {
      console.error("Check file exists error:", e);
      return false;
    }
  });


  // IPC Handler to Cancel Download
  // IPC Handler to Cancel Download
  ipcMain.handle('cancel-download', async (_event, args) => {
    const { key, model } = args; // Expect key, fallback to model
    const trackingKey = key || model;

    const proc = activeDownloads.get(trackingKey);
    if (proc) {
      console.log(`[DownloadModel] Cancelling download for ${trackingKey} (PID: ${proc.pid})`);

      // Force kill
      if (process.platform === 'win32' && proc.pid) {
        exec(`taskkill /pid ${proc.pid} /T /F`, (err) => {
          if (err) console.error("Taskkill error:", err);
        });
      }

      proc.kill(); // Fallback/Standard kill
      activeDownloads.delete(trackingKey);
      return { success: true };
    }
    return { success: false, error: 'Download not found' };
  });

  // IPC Handler to cancel general file download
  ipcMain.handle('cancel-file-download', async (_event, args) => {
    const { key } = args;
    // Re-use logic if possible, or maintain separate map
    const proc = activeDownloads.get(key);
    if (proc) {
      console.log(`[DownloadFile] Cancelling ${key} (PID: ${proc.pid})`);
      if (process.platform === 'win32' && proc.pid) {
        exec(`taskkill /pid ${proc.pid} /T /F`, () => { });
      }
      proc.kill();
      activeDownloads.delete(key);
      return { success: true };
    }
    return { success: false, error: 'Not found' };
  });

  // IPC Handler for Generic File Download (e.g. RIFE ncnn)
  ipcMain.handle('download-file', async (_event, args) => {
    return new Promise((resolve) => {
      try {
        const { url, targetDir, key, name } = args;
        const { modelsRoot, projectRoot } = resolveModelsRoot();

        const finalDir = path.join(modelsRoot, targetDir);
        if (!fs.existsSync(finalDir)) {
          fs.mkdirSync(finalDir, { recursive: true });
        }

        console.log(`[DownloadFile] ${name} -> ${finalDir}`);

        const pythonExe = getPythonExe(projectRoot);

        // Python script to download and unzip
        // Using python ensures we don't need extra node deps like 'adm-zip' or 'axios' if not bundled
        const script = `
import sys
import os
import urllib.request
import zipfile
import shutil

url = "${url}"
out_dir = r"${finalDir.replace(/\\/g, '\\\\')}"
zip_path = os.path.join(out_dir, "temp_download.zip")

def progress(count, block_size, total_size):
    percent = int(count * block_size * 100 / total_size)
    # limit output freq
    if count % 100 == 0:
        print(f"PROGRESS:{percent}", flush=True)

try:
    print(f"Downloading {url}...")
    urllib.request.urlretrieve(url, zip_path, reporthook=progress)
    print("Download complete. Extracting...")
    
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(out_dir)
        
    print("Extraction complete.")
    os.remove(zip_path)
    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {e}")
`;
        const proc = spawn(pythonExe, ['-c', script], {
          env: { ...process.env, PYTHONUTF8: '1' }
        });

        if (key) activeDownloads.set(key, proc);

        let output = '';
        let errorOut = '';

        proc.stdout.on('data', (data) => {
          const s = data.toString();
          console.log(`[DownloadFile]: ${s}`);
          output += s;
        });
        proc.stderr.on('data', (data) => {
          const s = data.toString();
          console.error(`[DownloadFile Err]: ${s}`);
          errorOut += s;
        });

        proc.on('close', (code) => {
          if (key) activeDownloads.delete(key);
          if (code === 0 && output.includes('SUCCESS')) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: `Failed (Code ${code})\n${errorOut}` });
          }
        });

      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });
  });

  // Helper to resolve python path (refactored from download-model)
  function getPythonExe(projectRoot: string) {
    if (app.isPackaged) {
      let p = path.join(process.resourcesPath, 'python', 'python.exe');
      if (fs.existsSync(p)) return p;
      return path.join(projectRoot, 'python', 'python.exe');
    } else {
      let p = path.join(projectRoot, 'python', 'python.exe');
      if (fs.existsSync(p)) return p;
      return 'python';
    }
  }

  // IPC Handler for Model Download
  ipcMain.handle('download-model', async (_event, args) => {
    return new Promise((resolve) => {
      try {
        const { model, localDir, key } = args;
        const trackingKey = key || model;

        // Resolve closest/active models root
        const { modelsRoot, projectRoot } = resolveModelsRoot();

        // subpath should be relative to models directory, but args.localDir 'models/index-tts/hub' includes 'models/'
        // We need to strip 'models/' prefix if we are joining with modelsRoot
        const relativePath = localDir.replace(/^models[\\/]/, '');
        const targetPath = path.join(modelsRoot, relativePath);

        console.log(`[DownloadModel] Target: ${targetPath}`);

        // Ensure directory exists
        if (!fs.existsSync(targetPath)) {
          fs.mkdirSync(targetPath, { recursive: true });
        }

        // Determine python path
        let pythonExe = '';
        if (app.isPackaged) {
          pythonExe = path.join(process.resourcesPath, 'python', 'python.exe');
          if (!fs.existsSync(pythonExe)) {
            pythonExe = path.join(projectRoot, 'python', 'python.exe');
          }
        } else {
          if (fs.existsSync(path.join(projectRoot, 'python', 'python.exe'))) {
            pythonExe = path.join(projectRoot, 'python', 'python.exe');
          } else {
            pythonExe = 'python';
          }
        }

        // Construct Python Script
        // We use python -c to run modelscope download
        // Escape backslashes for python string
        const safeTarget = targetPath.replace(/\\/g, '\\\\');
        const script = `
try:
    from modelscope.hub.snapshot_download import snapshot_download
    model_id = '${model}'
    target_dir = '${safeTarget}'
    print(f"Downloading {model_id} to {target_dir}...")
    snapshot_download(model_id, local_dir=target_dir)
    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {e}")
`;

        console.log(`[DownloadModel] Spawning python...`);

        // Log to logs/backend_debug.log
        const logFile = path.join(projectRoot, 'logs', 'backend_debug.log');
        const logDir = path.dirname(logFile);
        if (!fs.existsSync(logDir)) {
          try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) { console.error("Failed to create log dir", e); }
        }

        let logStream: fs.WriteStream | null = null;
        try {
          logStream = fs.createWriteStream(logFile, { flags: 'a' });
          logStream.write(`\n[${new Date().toISOString()}] [DownloadModel] Starting download: ${model} -> ${targetPath}\n`);
        } catch (e) {
          console.error("Failed to create log stream", e);
        }

        const proc = spawn(pythonExe, ['-c', script], {
          env: { ...process.env, PYTHONUTF8: '1' }
        });

        activeDownloads.set(trackingKey, proc);

        let output = '';
        let errorOut = '';

        proc.stdout.on('data', (data) => {
          const s = data.toString();
          console.log(`[ModelScope]: ${s}`);
          output += s;
          if (logStream) logStream.write(s);
        });
        proc.stderr.on('data', (data) => {
          const s = data.toString();
          console.error(`[ModelScope Err]: ${s}`);
          errorOut += s;
          if (logStream) logStream.write(`[STDERR] ${s}`);
        });

        proc.on('close', (code) => {
          if (activeDownloads.has(trackingKey)) {
            activeDownloads.delete(trackingKey);
          }
          if (logStream) {
            logStream.write(`\n[${new Date().toISOString()}] [DownloadModel] Finished with code ${code}\n`);
            logStream.end();
          }

          if (code === 0 && output.includes('SUCCESS')) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: `Process failed (Code ${code}). \n${errorOut}\n${output}` });
          }
        });

      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });
  });
})
