import { useState, useEffect, useRef } from 'react'
import './App.css'
import VideoUpload from './components/VideoUpload'
import Timeline, { Segment } from './components/Timeline'
import TranslationPanel from './components/TranslationPanel'
import ModernBackground from './components/ModernBackground'
import Sidebar from './components/Sidebar'
import ModelManager from './components/ModelManager';
import TTSConfig from './components/TTSConfig';
import ASRHub from './components/ASRHub';
import TranslationConfig from './components/TranslationConfig';
import ConfirmDialog from './components/ConfirmDialog';
import AboutView from './components/AboutView';
import MergeConfig from './components/MergeConfig';
import { useVideoProject } from './hooks/useVideoProject';
import { segmentsToSRT } from './utils/srt';


function App() {
  const {
    videoPath, setVideoPath,
    originalVideoPath, setOriginalVideoPath,
    mergedVideoPath,
    segments, setSegments,
    translatedSegments, setTranslatedSegments,
    videoStrategy, setVideoStrategy,
    status, setStatus,
    loading, setLoading,
    dubbingLoading,
    generatingSegmentId,
    retranslatingSegmentId,
    progress,
    isIndeterminate,
    targetLang, setTargetLang,
    asrService, handleAsrServiceChange,
    asrOriLang, setAsrOriLang,
    ttsService, handleTtsServiceChange,
    batchSize, setBatchSize,
    cloneBatchSize, setCloneBatchSize,
    maxNewTokens, setMaxNewTokens,
    feedback, setFeedback,
    installingDeps, setInstallingDeps,
    depsPackageName, setDepsPackageName,
    handleASR,
    handleTranslate,
    handleReTranslate,
    handleRetryErrors,
    handleGenerateSingleDubbing,
    handleGenerateAllDubbing,
    handleMergeVideo,
    handleSRTUpload,
    handleTargetSRTUpload,
    handleOneClickRun,
    handleTranslateAndDub,
    handleStop,
    hasErrors
  } = useVideoProject();

  const [playingAudioIndex, setPlayingAudioIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingVideoIndex, setPlayingVideoIndex] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0)
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const timeIndex = segments.findIndex((seg: Segment) => currentTime >= seg.start && currentTime < seg.end);
  const activeIndex = editingIndex !== null ? editingIndex : timeIndex;
  const [seekTime, setSeekTime] = useState<number | null>(null)
  const [playUntilTime, setPlayUntilTime] = useState<number | null>(null);

  const [leftWidth, setLeftWidth] = useState(() => parseInt(localStorage.getItem('leftWidth') || '400'));
  const [timelineWidth, setTimelineWidth] = useState(() => parseInt(localStorage.getItem('timelineWidth') || '500'));
  const timelineRef = useRef<HTMLDivElement>(null);
  const translationRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef<null | 'timeline' | 'translation'>(null);

  const [showRepairConfirm, setShowRepairConfirm] = useState(false);
  const [repairConfirmMessage, setRepairConfirmMessage] = useState('');
  const [repairResult, setRepairResult] = useState<{ success: boolean; message: string } | null>(null);
  const [missingDeps, setMissingDeps] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<'home' | 'models' | 'asr' | 'tts' | 'translation' | 'merge' | 'about'>(() => (localStorage.getItem('currentView') as any) || 'home');

  useEffect(() => {
    const checkEnv = async () => {
      try {
        const result = await (window as any).ipcRenderer.invoke('check-python-env');

        if (result && !result.success) {
          if (result.status === 'missing_python') {
            setStatus("未检测到 Python 环境 (根目录下无 python 文件夹)，请手动下载或放置便携版 Python。");
          } else {
            console.error("Env Check Failed:", result.error);
          }
        } else if (result && result.success && result.missing) {
          setMissingDeps(result.missing);
          if (result.missing.length > 0) {
            console.log("Missing dependencies:", result.missing);
            setStatus(`检测到运行环境缺失依赖，请点击左下角【修复运行环境】工具图标进行修复。`);
          }
        }
      } catch (e) {
        console.error("Failed to check env:", e);
      }
    };
    checkEnv();
  }, []);

  // Persistence for Settings
  useEffect(() => { localStorage.setItem('leftWidth', leftWidth.toString()); }, [leftWidth]);
  useEffect(() => { localStorage.setItem('timelineWidth', timelineWidth.toString()); }, [timelineWidth]);
  useEffect(() => { localStorage.setItem('currentView', currentView); }, [currentView]);



  useEffect(() => {
    const validateLayout = () => {
      const sidebarWidth = 80;
      const minTranslationWidth = 350;
      const minLeftWidth = 250;
      const minTimelineWidth = 300;
      const margins = 40;

      const totalAvailable = window.innerWidth - sidebarWidth - margins;
      const currentTotal = leftWidth + timelineWidth + minTranslationWidth;

      if (currentTotal > totalAvailable) {
        let availableForTwoColumns = totalAvailable - minTranslationWidth;
        if (availableForTwoColumns < minLeftWidth + minTimelineWidth) {
          availableForTwoColumns = minLeftWidth + minTimelineWidth;
        }

        let newLeft = leftWidth;
        let newTimeline = timelineWidth;

        if (newLeft + newTimeline > availableForTwoColumns) {
          const overflow = (newLeft + newTimeline) - availableForTwoColumns;
          const timelineShrinkable = newTimeline - minTimelineWidth;

          if (timelineShrinkable >= overflow) {
            newTimeline -= overflow;
          } else {
            newTimeline = minTimelineWidth;
            const remainingOverflow = overflow - timelineShrinkable;
            newLeft = Math.max(minLeftWidth, newLeft - remainingOverflow);
          }
        }

        if (newLeft !== leftWidth) setLeftWidth(newLeft);
        if (newTimeline !== timelineWidth) setTimelineWidth(newTimeline);
      }
    };

    validateLayout();
    window.addEventListener('resize', validateLayout);
    return () => window.removeEventListener('resize', validateLayout);
  }, [leftWidth, timelineWidth]);


  // Pause media when switching views
  useEffect(() => {
    if (currentView !== 'home') {
      if (videoRef.current) {
        videoRef.current.pause();
      }

      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingAudioIndex(null);
    }
  }, [currentView]);





  useEffect(() => {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-bg');
    document.body.style.backgroundColor = '';
    localStorage.setItem('bgMode', 'dark');
  }, []);

  // Drag state refs to avoid closure staleness and re-renders
  const dragState = useRef<{
    startX: number;
    startLeftWidth: number;
    startTimelineWidth: number;
    target: 'left' | 'middle' | null;
  }>({ startX: 0, startLeftWidth: 0, startTimelineWidth: 0, target: null });

  // Drag handlers using Refs to avoid closure staleness
  const handleDragMove = useRef((e: MouseEvent) => {
    if (!dragState.current.target) return;

    const { startX, startLeftWidth, startTimelineWidth, target } = dragState.current;
    const deltaX = e.clientX - startX;

    const minTranslationWidth = 350;
    const minTimelineWidth = 300;
    const minLeftWidth = 250;

    const sidebarWidth = 80; // Buffer safe assumption
    const availableContentWidth = window.innerWidth - sidebarWidth;

    if (target === 'left') {
      const maxLeft = availableContentWidth - timelineWidth - minTranslationWidth - 40;
      const newW = Math.max(minLeftWidth, Math.min(maxLeft, startLeftWidth + deltaX));
      setLeftWidth(newW);
    } else if (target === 'middle') {
      const maxTimeline = availableContentWidth - leftWidth - minTranslationWidth - 40;
      const newW = Math.max(minTimelineWidth, Math.min(maxTimeline, startTimelineWidth + deltaX));
      setTimelineWidth(newW);
    }
  }).current;

  const handleDragUp = useRef(() => {
    dragState.current.target = null;
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragUp);
  }).current;

  const startDrag = (e: React.MouseEvent, target: 'left' | 'middle') => {
    e.preventDefault();
    dragState.current = {
      startX: e.clientX,
      startLeftWidth: leftWidth,
      startTimelineWidth: timelineWidth,
      target: target
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragUp);
  };


  // Sync Scroll Handler
  const handleScroll = (source: 'timeline' | 'translation') => {
    const sourceEl = source === 'timeline' ? timelineRef.current : translationRef.current;
    const targetEl = source === 'timeline' ? translationRef.current : timelineRef.current;

    if (!sourceEl || !targetEl) return;
    if (isScrollingRef.current && isScrollingRef.current !== source) return;

    isScrollingRef.current = source;

    // Calculate percentage or exact position? exact is better if height matches.
    // But content height might differ due to text length. Percentage is safer for now.
    // Or just map index to index? No, simple scroll sync for now.
    const percentage = sourceEl.scrollTop / (sourceEl.scrollHeight - sourceEl.clientHeight);
    targetEl.scrollTop = percentage * (targetEl.scrollHeight - targetEl.clientHeight);

    // Debounce reset
    clearTimeout((window as any).scrollTimeout);
    (window as any).scrollTimeout = setTimeout(() => {
      isScrollingRef.current = null;
    }, 50);
  };








  const handlePlaySegmentAudio = async (index: number, audioPath: string) => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    if (playingAudioIndex === index) {
      audioEl.pause();
      setPlayingAudioIndex(null);
      return;
    }

    try {
      const url = await (window as any).ipcRenderer.invoke('get-file-url', audioPath);
      audioEl.src = `${url}?t=${Date.now()}`;
      audioEl.play().catch(e => {
        console.error("Audio play failed", e);
        setPlayingAudioIndex(null);
        setStatus("播放失败: " + (e.message || "未知错误"));
      });

      setPlayingAudioIndex(index);
    } catch (err: any) {
      console.error("Failed to get audio URL", err);
      setStatus("加载音频失败: " + err.message);
    }
  };

  // Modified to support pause toggle
  const handlePlaySegment = (startTime: number, endTime?: number, index?: number) => {
    // If we have an index and it matches currently playing video segment, toggle pause
    if (index !== undefined && playingVideoIndex === index) {
      if (videoRef.current) {
        if (videoRef.current.paused) {
          videoRef.current.play().catch(e => console.error(e));
        } else {
          videoRef.current.pause();
          setPlayingVideoIndex(null);
        }
      }
      return;
    }

    // Switch to new segment
    if (index !== undefined) {
      setPlayingVideoIndex(index);
    } else {
      setPlayingVideoIndex(null);
    }

    setSeekTime(null);
    setTimeout(() => {
      setSeekTime(startTime);
      if (endTime) {
        // Subtle offset to prevent jumping to next segment at end
        setPlayUntilTime(endTime - 0.05);
      } else {
        setPlayUntilTime(null);
      }
    }, 10);
  };





  const handleOpenLog = async () => {
    try {
      const result = await (window as any).ipcRenderer.invoke('open-backend-log');
      if (!result.success) {
        setStatus(`无法打开日志: ${result.error}`);
      }
    } catch (e: any) {
      console.error(e);
      setStatus(`打开日志失败: ${e.message}`);
    }
  };

  const handleExportSRT = async () => {
    if (segments.length === 0) return;
    try {
      const srtContent = segmentsToSRT(segments);
      const result = await (window as any).ipcRenderer.invoke('dialog:showSaveDialog', {
        title: '导出原始字幕',
        defaultPath: 'subtitle.srt',
        filters: [{ name: 'Subtitle Files', extensions: ['srt'] }]
      });

      if (!result.canceled && result.filePath) {
        await (window as any).ipcRenderer.invoke('save-file', result.filePath, srtContent);
        setStatus(`字幕已成功导出至: ${result.filePath}`);
      }
    } catch (e) {
      console.error('Export failed:', e);
      setStatus('导出失败: ' + String(e));
    }
  };

  const handleExportTranslatedSRT = async () => {
    if (translatedSegments.length === 0) return;
    try {
      const srtContent = segmentsToSRT(translatedSegments);
      const result = await (window as any).ipcRenderer.invoke('dialog:showSaveDialog', {
        title: '导出翻译字幕',
        defaultPath: 'translated_subtitle.srt',
        filters: [{ name: 'Subtitle Files', extensions: ['srt'] }]
      });

      if (!result.canceled && result.filePath) {
        await (window as any).ipcRenderer.invoke('save-file', result.filePath, srtContent);
        setStatus(`翻译字幕已成功导出至: ${result.filePath}`);
      }
    } catch (e) {
      console.error('Export failed:', e);
      setStatus('导出失败: ' + String(e));
    }
  };

  const handleRepairEnv = async () => {
    if (loading) return; // Prevent if already busy

    let message = "这将尝试自动安装/修复 Python 依赖。过程可能需要几分钟，且需联网。\n是否继续？";
    if (missingDeps.length > 0) {
      message = `检测到以下缺失的依赖项:\n\n${missingDeps.join(', ')}\n\n点击“确定”将尝试自动安装这些依赖。\n过程可能需要几分钟，且需联网。是否继续？`;
    }

    setRepairConfirmMessage(message);
    setShowRepairConfirm(true);
  };

  const confirmRepairAction = async () => {
    setShowRepairConfirm(false);

    // Continue with original logic
    setLoading(true);
    setInstallingDeps(true);
    setDepsPackageName('正在修复运行环境 (pip install)...');
    // setIsIndeterminate(true); // Redundant with overlay

    try {
      const result = await (window as any).ipcRenderer.invoke('fix-python-env');
      if (result && result.success) {
        setStatus("环境修复完成！请重启软件以生效。");
        setRepairResult({ success: true, message: "修复完成！建议重启软件。" });
        setMissingDeps([]); // Clear flag
      } else {
        setStatus(`修复失败: ${result.error}`);
        setRepairResult({ success: false, message: `修复失败: ${result.error}\n请检查日志或网络。` });
      }
    } catch (e: any) {
      setStatus(`修复请求异常: ${e.message}`);
      console.error(e);
    } finally {
      setLoading(false);
      setInstallingDeps(false);
      setDepsPackageName('');
      // setIsIndeterminate(false);
    }
  };




  return (
    <div className="container" style={{ display: 'flex', flexDirection: 'row', height: '100vh', padding: '20px', boxSizing: 'border-box' }}>

      <ConfirmDialog
        isOpen={showRepairConfirm}
        title="修复运行环境"
        message={repairConfirmMessage}
        onConfirm={confirmRepairAction}
        onCancel={() => setShowRepairConfirm(false)}
        isLightMode={false}
        confirmText="确定修复"
        cancelText="取消"
        confirmColor="#22c55e"
      />

      <ConfirmDialog
        isOpen={!!repairResult}
        title="系统提示"
        message={repairResult?.message || ""}
        onConfirm={() => setRepairResult(null)}
        isLightMode={false}
        confirmText="确定"
        cancelText="" // Hide cancel
        onCancel={undefined}
        confirmColor={repairResult?.success ? "#22c55e" : "#ef4444"}
      />

      <ConfirmDialog
        isOpen={!!feedback}
        title={feedback?.title || ''}
        message={feedback?.message || ''}
        onConfirm={() => {
          // Auto redirect if error related to preview or language mismatch
          if (feedback?.type === 'error' && (
            feedback.message.includes('预览') ||
            feedback.message.includes('Preview') ||
            feedback.message.includes('设计') ||
            feedback.message.includes('语言') ||
            feedback.message.includes('Language')
          )) {
            setCurrentView('tts');
          }
          setFeedback(null);
        }}
        isLightMode={false}
        confirmText={feedback?.type === 'error' ? "前往设置" : "确定"}
        confirmColor={feedback?.type === 'success' ? '#10b981' : '#3b82f6'}
        onCancel={() => setFeedback(null)}
        cancelText="取消"
      />

      {/* Smooth Background Transition Layer (z-index 0) */}


      <ModernBackground mode="dark" />

      <div className="blob-extra-blue" />
      <div className="blob-extra-orange" />

      <style>{`
        @keyframes indeterminate-progress {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }
      `}</style>

      {/* Main Content Wrapper (z-index 2) */}
      <Sidebar
        activeService={currentView}
        onServiceChange={(s) => setCurrentView(s as any)}
        onOpenLog={handleOpenLog}
        onRepairEnv={handleRepairEnv}
        onOpenModels={() => setCurrentView('models')}
        hasMissingDeps={missingDeps.length > 0}

        themeMode={'dark'}
      />
      <div className="content-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '20px', position: 'relative' }}>
        <ModernBackground mode="dark" />
        {/* Workflow Step Bar */}
        <div style={{ marginTop: '0px', marginBottom: '20px', display: 'flex', justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)' }}>
            <button
              onClick={handleOneClickRun}
              disabled={loading || dubbingLoading || generatingSegmentId !== null || !originalVideoPath}
              title={!originalVideoPath ? "请先选择视频" : "自动执行所有步骤"}
              style={{
                padding: '8px 40px',
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '24px',
                fontSize: '0.9em',
                fontWeight: 'bold',
                cursor: (loading || dubbingLoading || generatingSegmentId !== null || !originalVideoPath) ? 'not-allowed' : 'pointer',
                opacity: (loading || dubbingLoading || generatingSegmentId !== null || !originalVideoPath) ? 0.6 : 1,
                backdropFilter: 'blur(10px)',
                transition: 'all 0.2s',
                zIndex: 10
              }}
            >
              🚀 一键运行
            </button>
          </div>


          <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}>
            {/* Unified Config Card */}
            <div className="glass-panel" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              padding: '8px 20px',
              borderRadius: '20px',
              fontSize: '0.85em',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
              whiteSpace: 'nowrap'
            }}>
              {/* ASR Config */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span title="识别引擎" style={{ opacity: 0.8 }}>🎙️</span>
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>
                  ASR: <b style={{ color: '#fff' }}>{asrService === 'qwen' ? 'Qwen3' : (asrService === 'whisperx' ? 'WhisperX' : asrService.toUpperCase())}</b>
                </span>
                {asrService === 'qwen' && (
                  <select
                    value={asrOriLang}
                    onChange={(e) => setAsrOriLang(e.target.value)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: '#a7f3d0',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '2px 8px',
                      fontSize: '0.9em',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      outline: 'none',
                      marginLeft: '5px'
                    }}
                  >
                    <option value="Chinese" style={{ background: '#2d3748' }}>中文</option>
                    <option value="English" style={{ background: '#2d3748' }}>英语</option>
                    <option value="Cantonese" style={{ background: '#2d3748' }}>粤语</option>
                    <option value="Japanese" style={{ background: '#2d3748' }}>日语</option>
                    <option value="Korean" style={{ background: '#2d3748' }}>韩语</option>
                    <option value="German" style={{ background: '#2d3748' }}>德语</option>
                    <option value="French" style={{ background: '#2d3748' }}>法语</option>
                    <option value="Spanish" style={{ background: '#2d3748' }}>西班牙语</option>
                    <option value="Russian" style={{ background: '#2d3748' }}>俄语</option>
                  </select>
                )}
              </div>

              <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.1)' }} />

              {/* TTS Config */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span title="配音引擎" style={{ opacity: 0.8 }}>🗣️</span>
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>
                  TTS: <b style={{ color: '#fff' }}>{ttsService === 'qwen' ? 'Qwen3' : 'IndexTTS'}</b>
                </span>
                {ttsService === 'qwen' && (
                  <span style={{
                    color: '#a7f3d0',
                    fontSize: '0.9em',
                    fontWeight: 'bold',
                    background: 'rgba(255, 255, 255, 0.1)',
                    padding: '2px 10px',
                    borderRadius: '12px',
                    marginLeft: '5px'
                  }}>
                    {(() => {
                      const mode = localStorage.getItem('qwen_mode') || 'clone';
                      const map: any = { 'clone': '克隆', 'preset': '预置', 'design': '设计' };
                      return map[mode] || mode;
                    })()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Hidden Audio Player for controlling playback */}
        <audio
          ref={audioRef}
          style={{ display: 'none' }}
          onEnded={() => setPlayingAudioIndex(null)}
          onError={(e) => {
            console.error("Audio playback error", e);
            setPlayingAudioIndex(null);
            setStatus("播放失败: 无法加载音频文件");
          }}
        />

        {
          status && (
            <div style={{ padding: '10px', background: 'rgba(99,102,241,0.2)', borderRadius: '8px', marginBottom: '10px', textAlign: 'center', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '15px' }}>
              <div>{status}</div>
              {(loading || dubbingLoading || generatingSegmentId !== null) && (
                <button
                  onClick={handleStop}
                  style={{
                    background: '#ef4444',
                    color: 'white',
                    border: 'none',
                    padding: '4px 12px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '0.9em'
                  }}
                >
                  ⏹ 停止任务
                </button>
              )}
              {!(loading || dubbingLoading || generatingSegmentId !== null) && (
                <button
                  onClick={() => setStatus('')}
                  title="清除消息"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    opacity: 0.6,
                    cursor: 'pointer',
                    padding: '4px',
                    fontSize: '1.2em',
                    lineHeight: 1
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )
        }

        {/* Progress Bar */}
        {
          (loading || dubbingLoading) && (
            <div style={{ width: '100%', height: '8px', background: '#374151', borderRadius: '4px', marginBottom: '15px', overflow: 'hidden', position: 'relative' }}>
              <div
                className={isIndeterminate ? "progress-bar-indeterminate" : ""}
                style={{
                  height: '100%',
                  background: '#22c55e', // Green
                  width: isIndeterminate ? '30%' : `${progress}%`,
                  transition: isIndeterminate ? 'none' : 'width 0.3s ease-out',
                  position: 'absolute',
                  left: isIndeterminate ? undefined : 0,
                  borderRadius: '4px'
                }}
              />
            </div>
          )
        }

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {currentView === 'home' && (
            <div className="workbench-layout">
              {/* Left Column: Video & Upload */}
              <div className="workbench-column" style={{ width: leftWidth, overflowY: 'auto', paddingRight: '10px' }}>
                <VideoUpload
                  onFileSelected={(path) => {
                    setVideoPath(path);
                    setOriginalVideoPath(path);
                  }}
                  currentPath={videoPath}
                  onTimeUpdate={setCurrentTime}
                  seekTime={seekTime}
                  playUntilTime={playUntilTime}
                  videoRef={videoRef}
                  onVideoPause={() => setPlayingVideoIndex(null)}
                  disabled={loading || dubbingLoading || generatingSegmentId !== null}
                  onUserSeek={() => setPlayUntilTime(null)}
                />

                {/* Merged Video Display Section */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ marginTop: 0, marginBottom: '10px', color: 'var(--text-primary)' }}>4. 合并后的视频</h3>

                  {/* Merged Video Player */}
                  {mergedVideoPath && (
                    <div style={{ marginBottom: '15px', position: 'relative', background: 'black', borderRadius: '4px', overflow: 'hidden' }}>
                      <video
                        src={(mergedVideoPath.startsWith('file:') ? mergedVideoPath : `file:///${encodeURI(mergedVideoPath.replace(/\\/g, '/'))}`) + `?v=${Date.now()}`}
                        controls
                        style={{ width: '100%', display: 'block' }}
                      />
                      <div
                        style={{
                          padding: '8px',
                          background: 'rgba(0,0,0,0.7)',
                          fontSize: '0.85em',
                          color: '#9ca3af',
                          wordBreak: 'break-all',
                          cursor: 'pointer'
                        }}
                        onClick={() => (window as any).ipcRenderer.invoke('open-external', mergedVideoPath)}
                        title="点击调用系统播放器打开"
                      >
                        {mergedVideoPath.split(/[\\/]/).pop()} <span style={{ color: '#6366f1' }}>(点击打开)</span>
                      </div>
                    </div>
                  )}

                  {!mergedVideoPath && (
                    <div style={{
                      padding: '40px 20px',
                      textAlign: 'center',
                      color: 'var(--text-secondary)',
                      fontSize: '0.9em',
                      border: '2px dashed var(--border-color)',
                      borderRadius: '4px',
                      marginBottom: '15px'
                    }}>
                      合并完成后将在此显示
                    </div>
                  )}

                  {/* Action Buttons */}
                  <button
                    onClick={() => handleMergeVideo()}
                    disabled={loading || dubbingLoading || !videoPath || translatedSegments.length === 0}
                    className="btn"
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: loading || dubbingLoading || translatedSegments.length === 0 ? '#4b5563' : '#10b981',
                      cursor: loading || dubbingLoading || translatedSegments.length === 0 ? 'not-allowed' : 'pointer',
                      opacity: loading || dubbingLoading || translatedSegments.length === 0 ? 0.7 : 1,
                      marginBottom: '10px'
                    }}
                  >
                    {dubbingLoading ? '处理中...' : '开始合并'}
                  </button>
                  <button
                    onClick={() => (window as any).ipcRenderer.invoke('open-folder', mergedVideoPath)}
                    disabled={!mergedVideoPath}
                    className="btn"
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: mergedVideoPath ? '#6366f1' : '#4b5563',
                      cursor: mergedVideoPath ? 'pointer' : 'not-allowed',
                      opacity: mergedVideoPath ? 1 : 0.7
                    }}
                  >
                    📂 打开文件所在文件夹
                  </button>
                </div>
              </div>

              <div className="resizer workbench-resizer" onMouseDown={(e) => startDrag(e, 'left')}>
                <div style={{ width: '2px', height: '20px', background: 'rgba(255,255,255,0.2)' }} />
              </div>

              {/* Center Column: Original Timeline */}
              <div className="workbench-column" style={{ width: timelineWidth }}>
                <Timeline
                  segments={segments}
                  currentTime={currentTime}
                  onUpdateSegment={(idx, txt) => {
                    const newSegs = [...segments];
                    newSegs[idx].text = txt;
                    setSegments(newSegs);
                  }}
                  onPlaySegment={(start, end) => handlePlaySegment(start, end, segments.findIndex(s => s.start === start))}
                  domRef={timelineRef}
                  onScroll={() => handleScroll('timeline')}
                  onASR={handleASR}
                  loading={loading || dubbingLoading}
                  videoPath={videoPath}
                  playingVideoIndex={playingVideoIndex}
                  activeIndex={activeIndex}
                  onEditStart={setEditingIndex}
                  onEditEnd={() => setEditingIndex(null)}
                  onUploadSubtitle={handleSRTUpload}
                  onExport={handleExportSRT}
                />
              </div>

              <div className="resizer workbench-resizer" onMouseDown={(e) => startDrag(e, 'middle')}>
                <div style={{ width: '2px', height: '20px', background: 'rgba(255,255,255,0.2)' }} />
              </div>

              {/* Right Column: Translation Timeline */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: '300px' }}>
                <TranslationPanel
                  segments={segments}
                  translatedSegments={translatedSegments}
                  setTranslatedSegments={setTranslatedSegments}
                  targetLang={targetLang}
                  setTargetLang={setTargetLang}
                  onTranslate={() => handleTranslate()}
                  onTranslateAndDub={handleTranslateAndDub}
                  onGenerateAll={() => handleGenerateAllDubbing()}
                  onGenerateSingle={handleGenerateSingleDubbing}
                  onPlayAudio={handlePlaySegmentAudio}
                  generatingSegmentId={generatingSegmentId}
                  retranslatingSegmentId={retranslatingSegmentId}
                  domRef={translationRef}
                  onScroll={() => handleScroll('translation')}
                  onUploadSubtitle={handleTargetSRTUpload}
                  hasVideo={!!originalVideoPath}
                  currentTime={currentTime}
                  dubbingLoading={dubbingLoading}
                  onReTranslate={handleReTranslate}
                  loading={loading}
                  playingAudioIndex={playingAudioIndex}
                  activeIndex={activeIndex}
                  onEditStart={setEditingIndex}
                  onEditEnd={() => setEditingIndex(null)}
                  ttsService={ttsService}
                  hasErrors={hasErrors}
                  onRetryErrors={handleRetryErrors}
                  onExport={handleExportTranslatedSRT}
                />
              </div>
            </div>
          )}

          {currentView === 'asr' && (
            <div style={{ flex: 1, margin: '10px', overflow: 'auto' }}>
              <ASRHub asrService={asrService} onServiceChange={handleAsrServiceChange} themeMode={'dark'} />
            </div>
          )}
          {currentView === 'tts' && (
            <div style={{ flex: 1, margin: '10px', overflow: 'auto' }}>
              <TTSConfig
                themeMode={'dark'}
                activeService={ttsService}
                onServiceChange={handleTtsServiceChange}
                onQwenModeChange={() => { }}
                batchSize={batchSize}
                setBatchSize={setBatchSize}
                cloneBatchSize={cloneBatchSize}
                setCloneBatchSize={setCloneBatchSize}
                maxNewTokens={maxNewTokens}
                setMaxNewTokens={setMaxNewTokens}
              />
            </div>
          )}
          {currentView === 'translation' && (
            <div style={{ flex: 1, margin: '10px', overflow: 'auto' }}>
              <TranslationConfig />
            </div>
          )}
          {currentView === 'merge' && (
            <div style={{ flex: 1, margin: '10px', overflow: 'auto' }}>
              <MergeConfig
                themeMode={'dark'}
                videoStrategy={videoStrategy}
                setVideoStrategy={setVideoStrategy}
              />
            </div>
          )}
          {currentView === 'models' && (
            <div style={{ flex: 1, margin: '10px', overflow: 'auto' }}>
              <ModelManager themeMode={'dark'} />
            </div>
          )}
          {currentView === 'about' && (
            <div style={{ flex: 1, margin: '10px', overflow: 'auto' }}>
              <AboutView themeMode={'dark'} />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showRepairConfirm}
        onConfirm={confirmRepairAction}
        onCancel={() => setShowRepairConfirm(false)}
        title="修复运行环境"
        message={repairConfirmMessage}
        isLightMode={false}
      />

      <ConfirmDialog
        isOpen={!!feedback}
        title={feedback?.title || ''}
        message={feedback?.message || ''}
        onConfirm={() => setFeedback(null)}
        onCancel={() => setFeedback(null)}
        isLightMode={false}
      />

      {
        installingDeps && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(20px)' }}>
            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '40px', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
              <div className="spinner" style={{ width: '50px', height: '50px', border: '4px solid rgba(255,255,255,0.1)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 20px' }}></div>
              <h2 style={{ color: '#fff' }}>正在同步 AI 运行环境</h2>
              <p style={{ color: '#aaa' }}>安装核心组件: {depsPackageName || '...'}</p>
            </div>
          </div>
        )
      }
    </div >
  )
}


export default App
