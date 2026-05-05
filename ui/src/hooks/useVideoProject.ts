
import { useState, useEffect, useRef } from 'react';

export interface Segment {
    start: number;
    end: number;
    text: string;
    audioPath?: string;
    audioStatus?: 'none' | 'generating' | 'ready' | 'error' | 'pending';
    audioDuration?: number;
    original_index?: number;
}

export function useVideoProject() {
    // Media States
    const [videoPath, setVideoPath] = useState<string>('');
    const [originalVideoPath, setOriginalVideoPath] = useState<string>('');
    const [mergedVideoPath, setMergedVideoPath] = useState<string>('');
    const [segments, setSegments] = useState<Segment[]>([]);
    const [translatedSegments, setTranslatedSegments] = useState<Segment[]>([]);

    // Status & Progress
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);
    const [dubbingLoading, setDubbingLoading] = useState(false);
    const [progress, setProgress] = useState<number>(0);
    const [isIndeterminate, setIsIndeterminate] = useState<boolean>(false);
    const [videoStrategy, setVideoStrategy] = useState<string>('auto_speedup');
    const [generatingSegmentId, setGeneratingSegmentId] = useState<number | null>(null);
    const [retranslatingSegmentId, setRetranslatingSegmentId] = useState<number | null>(null);

    // Config States (Persisted)
    const [targetLang, setTargetLang] = useState(() => localStorage.getItem('targetLang') || 'English');
    const [asrService, setAsrService] = useState(() => localStorage.getItem('asrService') || 'whisperx');
    const [asrOriLang, setAsrOriLang] = useState(() => {
        const saved = localStorage.getItem('asrOriLang');
        return (saved && saved !== 'None') ? saved : 'Chinese';
    });
    const [ttsService, setTtsService] = useState<'indextts' | 'qwen'>(() => (localStorage.getItem('ttsService') as any) || 'indextts');
    const [batchSize, setBatchSize] = useState(() => parseInt(localStorage.getItem('batchSize') || '1'));
    const [cloneBatchSize, setCloneBatchSize] = useState(() => parseInt(localStorage.getItem('cloneBatchSize') || '1'));
    const [maxNewTokens, setMaxNewTokens] = useState(() => parseInt(localStorage.getItem('maxNewTokens') || '4096'));

    // UI Feedback
    const [feedback, setFeedback] = useState<{ title: string; message: string; type: 'success' | 'error' } | null>(null);
    const [installingDeps, setInstallingDeps] = useState(false);
    const [depsPackageName, setDepsPackageName] = useState('');

    const abortRef = useRef(false);

    // Incompatibility check logic
    const validateServiceIncompatibility = (asr: string, tts: string, changing: 'asr' | 'tts'): { valid: boolean; message?: string } => {
        if (asr === 'qwen' && tts === 'indextts') {
            if (changing === 'asr') {
                return {
                    valid: false,
                    message: "【环境冲突】Qwen3 ASR 无法与 Index-TTS 同时启用。请先进入【配音配置】将引擎从 Index-TTS 切换为 Qwen3。"
                };
            } else {
                return {
                    valid: false,
                    message: "【环境冲突】Index-TTS 无法与 Qwen3 ASR 同时启用。请先进入【识别中心】将引擎从 Qwen3 切换为 WhisperX 或云端 API。"
                };
            }
        }
        return { valid: true };
    };

    const handleAsrServiceChange = (newService: string) => {
        const check = validateServiceIncompatibility(newService, ttsService, 'asr');
        if (!check.valid) {
            setFeedback({ title: "选择冲突", message: check.message!, type: 'error' });
            return false;
        }
        setAsrService(newService);
        return true;
    };

    const handleTtsServiceChange = (newService: 'indextts' | 'qwen') => {
        const check = validateServiceIncompatibility(asrService, newService, 'tts');
        if (!check.valid) {
            setFeedback({ title: "选择冲突", message: check.message!, type: 'error' });
            return false;
        }
        setTtsService(newService);
        return true;
    };

    // Persistence Effect
    useEffect(() => { localStorage.setItem('targetLang', targetLang); }, [targetLang]);
    useEffect(() => { localStorage.setItem('asrService', asrService); }, [asrService]);
    useEffect(() => { localStorage.setItem('asrOriLang', asrOriLang); }, [asrOriLang]);
    useEffect(() => { localStorage.setItem('ttsService', ttsService); }, [ttsService]);
    useEffect(() => { localStorage.setItem('batchSize', batchSize.toString()); }, [batchSize]);
    useEffect(() => { localStorage.setItem('cloneBatchSize', cloneBatchSize.toString()); }, [cloneBatchSize]);
    useEffect(() => { localStorage.setItem('maxNewTokens', maxNewTokens.toString()); }, [maxNewTokens]);

    // IPC Listeners
    useEffect(() => {
        const handleProgress = (_event: any, value: number) => {
            setIsIndeterminate(false);
            setProgress(value);
        };

        const handlePartialResult = (_event: any, data: any) => {
            if (data && typeof data.index === 'number') {
                setTranslatedSegments(prev => {
                    const newSegs = [...prev];
                    if (newSegs[data.index]) {
                        if (data.audio_path !== undefined) {
                            const isSuccess = data.success === true;
                            let status: 'ready' | 'error' = isSuccess ? 'ready' : 'error';

                            // Basic duration safety check
                            if (isSuccess && data.duration) {
                                const seg = newSegs[data.index];
                                const expectedDur = seg.end - seg.start;
                                if (data.duration - expectedDur > 5.0) status = 'error';
                            }

                            if (isSuccess && !data.audio_path) status = 'error';

                            newSegs[data.index] = {
                                ...newSegs[data.index],
                                audioPath: data.audio_path,
                                audioStatus: status,
                                audioDuration: data.duration
                            };
                        }
                        if (data.text !== undefined) {
                            newSegs[data.index] = {
                                ...newSegs[data.index],
                                text: data.text
                            };
                        }
                    }
                    return newSegs;
                });
            }
        };

        const handleDepsInstalling = (_event: any, pkgName: string) => {
            setInstallingDeps(true);
            setDepsPackageName(pkgName);
        };

        const handleDepsDone = () => {
            setInstallingDeps(false);
            setDepsPackageName('');
        };

        (window as any).ipcRenderer.on('backend-progress', handleProgress);
        (window as any).ipcRenderer.on('backend-partial-result', handlePartialResult);
        (window as any).ipcRenderer.on('backend-deps-installing', handleDepsInstalling);
        (window as any).ipcRenderer.on('backend-deps-done', handleDepsDone);

        return () => {
            const ipc = (window as any).ipcRenderer;
            ipc.off?.('backend-progress', handleProgress);
            ipc.off?.('backend-partial-result', handlePartialResult);
            ipc.off?.('backend-deps-installing', handleDepsInstalling);
            ipc.off?.('backend-deps-done', handleDepsDone);
        };
    }, []);

    // Helper functions (formatted time, etc.)
    const formatTimeSRT = (seconds: number) => {
        const pad = (num: number, size: number) => ('000' + num).slice(size * -1);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
        return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
    };

    // Handlers
    const handleASR = async (): Promise<Segment[] | null> => {
        if (!originalVideoPath) {
            setStatus('请先上传/选择视频');
            return null;
        }

        setLoading(true);
        abortRef.current = false;
        setIsIndeterminate(true);
        setProgress(0);
        setStatus('正在识别字幕...');

        try {
            const paths = await (window as any).ipcRenderer.invoke('get-paths');
            const outputRoot = paths.outputDir;
            const projectRoot = paths.projectRoot;
            const filenameWithExt = originalVideoPath.split(/[\\/]/).pop() || "video.mp4";
            const filenameNoExt = filenameWithExt.replace(/\.[^/.]+$/, "");

            const sessionOutputDir = `${outputRoot}\\${filenameNoExt}`;
            const cacheDir = `${projectRoot}\\.cache\\${filenameNoExt}`;

            await (window as any).ipcRenderer.invoke('ensure-dir', sessionOutputDir);
            await (window as any).ipcRenderer.invoke('ensure-dir', cacheDir);

            const vadOnset = localStorage.getItem('whisper_vad_onset') || '0.700';
            const vadOffset = localStorage.getItem('whisper_vad_offset') || '0.700';

            const result = await (window as any).ipcRenderer.invoke('run-backend', [
                '--action', 'test_asr',
                '--input', originalVideoPath,
                '--asr', asrService,
                '--ori_lang', asrOriLang === 'None' ? '' : asrOriLang,
                '--output_dir', cacheDir,
                '--vad_onset', vadOnset,
                '--vad_offset', vadOffset
            ]);

            if (abortRef.current) return null;

            if (Array.isArray(result)) {
                result.sort((a: any, b: any) => a.start - b.start);
                setSegments(result);

                const srtContent = result.map((seg: any, index: number) => {
                    return `${index + 1}\n${formatTimeSRT(seg.start)} --> ${formatTimeSRT(seg.end)}\n${seg.text}\n`;
                }).join('\n');

                const srtPath = `${cacheDir}\\${filenameNoExt}.srt`;
                await (window as any).ipcRenderer.invoke('save-file', srtPath, srtContent);

                const jsonPath = `${cacheDir}\\audio_segments.json`;
                await (window as any).ipcRenderer.invoke('save-file', jsonPath, JSON.stringify(result, null, 2));

                setStatus(`识别完成！请在下方编辑字幕。`);
                return result;
            } else {
                setStatus('识别失败：输出格式无效。');
                return null;
            }
        } catch (e: any) {
            console.error(e);
            setStatus(`错误: ${e.message}`);
            return null;
        } finally {
            if (!abortRef.current) {
                setLoading(false);
                setIsIndeterminate(false);
                setProgress(0);
            }
        }
    };

    const handleTranslate = async (overrideSegments?: Segment[]): Promise<Segment[] | null> => {
        const segsToUse = overrideSegments || segments;
        if (segsToUse.length === 0) return null;

        setLoading(true);
        abortRef.current = false;
        setIsIndeterminate(true);
        setProgress(0);
        setStatus(`正在翻译 ${segsToUse.length} 个片段到 ${targetLang}...`);

        const placeholders = segsToUse.map(seg => ({
            ...seg,
            text: '...',
            audioPath: undefined,
            audioStatus: undefined
        }));
        setTranslatedSegments(placeholders);

        try {
            if (abortRef.current) return null;

            const inputJson = JSON.stringify(segsToUse);
            const transApiKey = localStorage.getItem('trans_api_key') || '';
            const transApiBaseUrl = localStorage.getItem('trans_api_base_url') || '';
            const transApiModel = localStorage.getItem('trans_api_model') || '';

            const args = [
                '--action', 'translate_text',
                '--input', inputJson,
                '--lang', targetLang,
                '--json'
            ];

            if (transApiKey) {
                args.push('--api_key', transApiKey);
                if (transApiBaseUrl) args.push('--base_url', transApiBaseUrl);
                if (transApiModel) args.push('--model', transApiModel);
            }

            const result = await (window as any).ipcRenderer.invoke('run-backend', args);

            if (abortRef.current) return null;

            if (result && result.success) {
                setTranslatedSegments(result.segments);
                setStatus("翻译完成！");
                return result.segments;
            } else {
                setStatus(`翻译失败`);
                setFeedback({
                    title: "翻译失败 (Translation Error)",
                    message: `API 返回错误: \n${result?.error || 'Unknown Error'}`,
                    type: 'error'
                });
                return null;
            }
        } catch (e: any) {
            console.error(e);
            setStatus(`翻译错误: ${e.message}`);
            return null;
        } finally {
            if (!abortRef.current) {
                setLoading(false);
                setIsIndeterminate(false);
                setProgress(0);
            }
        }
    };

    const handleReTranslate = async (index: number) => {
        if (loading || !translatedSegments[index]) return;

        setLoading(true);
        setRetranslatingSegmentId(index);
        setStatus(`正在重新翻译片段 ${index + 1}...`);

        try {
            const sourceText = segments[index].text;

            const transApiKey = localStorage.getItem('trans_api_key') || '';
            const transApiBaseUrl = localStorage.getItem('trans_api_base_url') || '';
            const transApiModel = localStorage.getItem('trans_api_model') || '';

            const args = [
                '--action', 'translate_text',
                '--input', sourceText,
                '--lang', targetLang,
                '--json'
            ];

            if (transApiKey) {
                args.push('--api_key', transApiKey);
                if (transApiBaseUrl) args.push('--base_url', transApiBaseUrl);
                if (transApiModel) args.push('--model', transApiModel);
            }

            const result = await (window as any).ipcRenderer.invoke('run-backend', args);

            if (result && result.success) {
                const newText = result.text || (result.segments && result.segments[0]?.text);

                if (newText) {
                    setTranslatedSegments(prev => {
                        const newSegs = [...prev];
                        newSegs[index] = { ...newSegs[index], text: newText };
                        return newSegs;
                    });
                    setStatus("重新翻译完成");
                } else {
                    setStatus("重新翻译失败：返回结果为空");
                }
            } else {
                console.error("Re-translation failed:", result);
                setStatus(`重新翻译失败: ${result?.error || 'Unknown'}`);
            }
        } catch (e: any) {
            console.error(e);
            setStatus(`重新翻译错误: ${e.message}`);
        } finally {
            setProgress(0);
            setLoading(false);
            setIsIndeterminate(false);
            setRetranslatingSegmentId(null);
        }
    };

    const hasErrors = translatedSegments.some(s => s.audioStatus === 'error');

    const handleRetryErrors = async () => {
        const errorSegments = translatedSegments
            .map((seg, idx) => ({ ...seg, original_index: idx }))
            .filter(seg => seg.audioStatus === 'error');

        if (errorSegments.length === 0) {
            setStatus('没有找到需要重试的失败片段');
            return;
        }

        setStatus(`正在重试 ${errorSegments.length} 个失败片段...`);
        await handleGenerateAllDubbing(errorSegments);
    };

    const handleGenerateSingleDubbing = async (index: number) => {
        if (!originalVideoPath) return;
        const segment = translatedSegments[index];
        if (!segment) return;

        setTranslatedSegments(prev => {
            const newSegs = [...prev];
            newSegs[index] = { ...newSegs[index], audioStatus: 'pending' };
            return newSegs;
        });
        setGeneratingSegmentId(index);
        setStatus(`正在重新生成片段 ${index + 1} 的配音...`);

        try {
            const paths = await (window as any).ipcRenderer.invoke('get-paths');
            const projectRoot = paths.projectRoot;
            const filenameWithExt = originalVideoPath.split(/[\\/]/).pop() || "video.mp4";
            const filenameNoExt = filenameWithExt.replace(/\.[^/.]+$/, "");
            const cacheDir = `${projectRoot}\\.cache\\${filenameNoExt}`;
            const outputPath = `${cacheDir}\\segment_${index}.wav`;

            // Prepare arguments based on selected service
            let extraArgs: string[] = [];
            const qwenTtsModel = localStorage.getItem('qwen_tts_model') || '1.7b'; // Keep model separate if global

            if (ttsService === 'qwen') {
                const qwenMode = localStorage.getItem('qwen_mode') || 'clone';

                // Validation for Design Mode
                if (qwenMode === 'design') {
                    const designRef = localStorage.getItem('qwen_design_ref_audio');
                    if (!designRef) {
                        setFeedback({
                            title: "需要预览",
                            message: "您还没有为【声音设计】合成测试音频。请先在参数设置中点击【合成】以锁定音色效果，确保配音风格一致。",
                            type: 'error'
                        });
                        setGeneratingSegmentId?.(null); // use optional chaining just in case
                        setDubbingLoading?.(false);
                        return null; // Return value might vary between functions, but returning null/void is usually safe here as we abort.
                    }
                }
                extraArgs.push('--qwen_mode', qwenMode);
                extraArgs.push('--qwen_model', qwenTtsModel);

                if (qwenMode === 'preset') {
                    const preset = localStorage.getItem('qwen_preset_voice') || 'Vivian';
                    extraArgs.push('--preset_voice', preset);
                } else if (qwenMode === 'design') {
                    const instruct = localStorage.getItem('qwen_voice_instruction') || '';
                    extraArgs.push('--voice_instruct', instruct);
                    // Use generated design audio as ref if available
                    const designRef = localStorage.getItem('qwen_design_ref_audio');
                    if (designRef) extraArgs.push('--ref_audio', designRef);
                } else {
                    // Clone Mode
                    const refAudio = localStorage.getItem('qwen_ref_audio_path');
                    if (refAudio) extraArgs.push('--ref_audio', refAudio);
                    const refText = localStorage.getItem('qwen_ref_text');
                    if (refText) extraArgs.push('--qwen_ref_text', refText);
                }
            } else {
                // IndexTTS
                const refAudio = localStorage.getItem('tts_ref_audio_path');
                if (refAudio) extraArgs.push('--ref_audio', refAudio);
            }

            const result = await (window as any).ipcRenderer.invoke('run-backend', [
                '--action', 'generate_single_tts',
                '--tts_service', ttsService,
                '--input', originalVideoPath,
                '--output', outputPath,
                '--text', segment.text,
                '--start', segment.start.toString(),
                '--duration', (segment.end - segment.start).toString(),
                '--strategy', videoStrategy,
                ...extraArgs
            ]);

            if (result && result.success) {
                setTranslatedSegments(prev => {
                    const newSegs = [...prev];
                    newSegs[index] = {
                        ...newSegs[index],
                        audioPath: result.audio_path,
                        audioStatus: 'ready',
                        audioDuration: result.duration
                    };
                    return newSegs;
                });
                setStatus(`片段 ${index + 1} 配音生成完成！`);
            } else {
                setTranslatedSegments(prev => {
                    const newSegs = [...prev];
                    newSegs[index] = {
                        ...newSegs[index],
                        audioStatus: 'error',
                        audioPath: result?.audio_path  // Keep audio_path if file exists
                    };
                    return newSegs;
                });
                setStatus(`片段 ${index + 1} 配音生成失败`);
            }
        } catch (e) {
            console.error(e);
            setTranslatedSegments(prev => {
                const newSegs = [...prev];
                newSegs[index] = { ...newSegs[index], audioStatus: 'error' };
                return newSegs;
            });
        } finally {
            setGeneratingSegmentId(null);
        }
    };

    const handleGenerateAllDubbing = async (overrideSegments?: Segment[]): Promise<Segment[] | null> => {
        const segmentsToUse = overrideSegments || translatedSegments;
        if (!originalVideoPath || segmentsToUse.length === 0) return null;

        setDubbingLoading(true);
        abortRef.current = false;
        setStatus('正在批量生成配音...');
        setProgress(0);
        setIsIndeterminate(false);

        try {
            const paths = await (window as any).ipcRenderer.invoke('get-paths');
            const projectRoot = paths.projectRoot;
            const filenameWithExt = originalVideoPath.split(/[\\/]/).pop() || "video.mp4";
            const filenameNoExt = filenameWithExt.replace(/\.[^/.]+$/, "");
            const cacheDir = `${projectRoot}\\.cache\\${filenameNoExt}`;

            const qwenTtsModel = localStorage.getItem('qwen_tts_model') || '1.7b';

            // Save segments to a temporary JSON file
            const tempJsonPath = `${cacheDir}\\segments.json`;
            await (window as any).ipcRenderer.invoke('ensure-dir', cacheDir); // Ensure cache dir exists
            await (window as any).ipcRenderer.invoke('save-file', tempJsonPath, JSON.stringify(segmentsToUse));

            // Prepare arguments based on selected service
            let extraArgs: string[] = [];
            let effectiveBatchSize = batchSize; // Default to standard batch size (Design mode)

            if (ttsService === 'qwen') {
                const qwenMode = localStorage.getItem('qwen_mode') || 'clone';

                // Validation for Design Mode
                if (qwenMode === 'design') {
                    const designRef = localStorage.getItem('qwen_design_ref_audio');
                    if (!designRef) {
                        setFeedback({
                            title: "需要预览",
                            message: "您还没有为【声音设计】合成测试音频。请先在参数设置中点击【合成】以锁定音色效果，确保配音风格一致。",
                            type: 'error'
                        });
                        setGeneratingSegmentId?.(null); // use optional chaining just in case
                        setDubbingLoading?.(false);
                        return null; // Return value might vary between functions, but returning null/void is usually safe here as we abort.
                    }
                }
                extraArgs.push('--qwen_mode', qwenMode);
                extraArgs.push('--qwen_model', qwenTtsModel);

                if (qwenMode === 'preset') {
                    const preset = localStorage.getItem('qwen_preset_voice') || 'Vivian';
                    extraArgs.push('--preset_voice', preset);
                } else if (qwenMode === 'design') {
                    const instruct = localStorage.getItem('qwen_voice_instruction') || '';
                    extraArgs.push('--voice_instruct', instruct);
                    const designRef = localStorage.getItem('qwen_design_ref_audio');
                    if (designRef) extraArgs.push('--ref_audio', designRef);
                    // effectiveBatchSize remains 'batchSize' (Design)
                } else {
                    // Clone Mode
                    effectiveBatchSize = cloneBatchSize; // Use Clone-specific batch size
                    const refAudio = localStorage.getItem('qwen_ref_audio_path');
                    if (refAudio) extraArgs.push('--ref_audio', refAudio);
                    const refText = localStorage.getItem('qwen_ref_text');
                    if (refText) extraArgs.push('--qwen_ref_text', refText);
                }
            } else {
                // IndexTTS
                const refAudio = localStorage.getItem('tts_ref_audio_path');
                if (refAudio) extraArgs.push('--ref_audio', refAudio);
            }

            const result = await (window as any).ipcRenderer.invoke('run-backend', [
                '--action', 'generate_batch_tts',
                '--tts_service', ttsService,
                '--input', originalVideoPath,
                '--output', cacheDir,
                '--ref', tempJsonPath,
                '--batch_size', effectiveBatchSize.toString(),
                '--max_new_tokens', maxNewTokens.toString(),
                '--strategy', videoStrategy,
                ...extraArgs
            ]);

            if (abortRef.current) return null;

            if (result && result.success) {
                // Merge backend results with original segment data

                return new Promise<Segment[]>((resolve) => {
                    setTranslatedSegments(prev => {
                        const newSegs = [...prev];

                        const updatedSegments = segmentsToUse.map(seg => ({ ...seg })); // Clone

                        result.results.forEach((resSeg: any) => {
                            const idx = resSeg.index !== undefined ? resSeg.index : resSeg.original_index;

                            // Update State
                            if (typeof idx === 'number' && idx >= 0 && idx < newSegs.length) {
                                newSegs[idx] = {
                                    ...newSegs[idx],
                                    audioPath: resSeg.audio_path,
                                    audioDuration: resSeg.duration,
                                    audioStatus: resSeg.success ? 'ready' : 'error'
                                };
                            }

                            // Update Return Value
                            if (typeof idx === 'number' && idx >= 0 && idx < updatedSegments.length) {
                                updatedSegments[idx] = {
                                    ...updatedSegments[idx],
                                    audioPath: resSeg.audio_path,
                                    audioDuration: resSeg.duration,
                                    audioStatus: resSeg.success ? 'ready' : 'error'
                                };
                            }
                        });

                        // Resolve with the updated segments for the next step in the chain
                        resolve(updatedSegments);
                        return newSegs;
                    });
                    setStatus('配音批量生成完成！');
                });
            } else {
                setStatus('配音生成失败');
                setFeedback({
                    title: "生成失败",
                    message: `批量配音由于以下原因失败: \n${result?.error || '未知错误'}`,
                    type: 'error'
                });
                return null;
            }
        } catch (e: any) {
            console.error(e);
            setStatus(`配音生成错误: ${e.message}`);
            return null;
        } finally {
            if (!abortRef.current) {
                setDubbingLoading(false);
                setProgress(0);
            }
        }
    };

    const handleMergeVideo = async (overrideSegments?: Segment[]) => {
        const segmentsToUse = overrideSegments || translatedSegments;
        if (!originalVideoPath || segmentsToUse.length === 0) return;

        setLoading(true);
        abortRef.current = false;
        setIsIndeterminate(true);
        setStatus('正在合并视频 (这可能需要几分钟)...');

        try {
            const paths = await (window as any).ipcRenderer.invoke('get-paths');
            const outputRoot = paths.outputDir;
            const filenameWithExt = originalVideoPath.split(/[\\/]/).pop() || "video.mp4";
            const filenameNoExt = filenameWithExt.replace(/\.[^/.]+$/, "");
            const sessionOutputDir = `${outputRoot}\\${filenameNoExt}`;
            const outputVideoPath = `${sessionOutputDir}\\merged.mp4`; // Output file path

            const segmentsForBackend = segmentsToUse.map(seg => ({
                ...seg,
                path: seg.audioPath // Backend expects 'path'
            })).filter(seg => seg.path); // Only include segments with valid audio path

            console.log('[MergeVideo] Segments provided:', segmentsToUse.length);
            console.log('[MergeVideo] Segments with audio:', segmentsForBackend.length);

            if (segmentsForBackend.length === 0) {
                setStatus('合并失败: 未找到有效的配音音频');
                setFeedback({
                    title: "无法合并",
                    message: "没有找到有效的配音音频片段。请确保【步骤3: 语音合成】已成功完成。",
                    type: 'error'
                });
                setLoading(false);
                setIsIndeterminate(false);
                return;
            }

            const tempJsonPath = `${sessionOutputDir}\\segments.json`;
            await (window as any).ipcRenderer.invoke('ensure-dir', sessionOutputDir); // Ensure session output dir exists
            await (window as any).ipcRenderer.invoke('save-file', tempJsonPath, JSON.stringify(segmentsForBackend));

            const result = await (window as any).ipcRenderer.invoke('run-backend', [
                '--action', 'merge_video',
                '--input', originalVideoPath,
                '--output', outputVideoPath,
                '--ref', tempJsonPath,
                '--strategy', videoStrategy
            ]);

            if (abortRef.current) return;

            if (result && result.success) {
                setMergedVideoPath(result.output);
                setStatus('视频合并完成！');
                setFeedback({
                    title: "处理成功",
                    message: "视频已成功合并并保存到输出文件夹。",
                    type: 'success'
                });
            } else {
                setStatus('合并失败');
                setFeedback({
                    title: "合并失败",
                    message: `视频合并失败: \n${result?.error || '未知错误'}`,
                    type: 'error'
                });
            }
        } catch (e: any) {
            console.error(e);
            setStatus(`合并错误: ${e.message}`);
        } finally {
            if (!abortRef.current) {
                setLoading(false);
                setIsIndeterminate(false);
            }
        }
    };

    const parseSRTContent = (text: string): Segment[] => {
        const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const regex = /(\d+)\s*\n\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*\n([\s\S]*?)(?=\n\d+\s*\n\s*\d{2}:\d{2}[:.]|$)/g;

        const newSegments: Segment[] = [];
        let match;
        const parseTime = (t: string) => {
            const cleanT = t.replace(',', '.');
            const [h, m, s] = cleanT.split(':');
            return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
        };

        while ((match = regex.exec(normalizedText)) !== null) {
            const content = match[4].trim();
            if (content) {
                newSegments.push({
                    start: parseTime(match[2]),
                    end: parseTime(match[3]),
                    text: content
                });
            }
        }
        return newSegments;
    };

    const handleSRTUpload = (file: File) => {
        if (!originalVideoPath) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            if (text) {
                const newSegments = parseSRTContent(text);
                if (newSegments.length > 0) {
                    setSegments(newSegments);
                    setStatus(`已加载外部源字幕 (${newSegments.length} 条)`);
                } else {
                    setStatus(`字幕解析失败：未找到有效字幕片段`);
                }
            }
        };
        reader.readAsText(file);
    };

    const handleTargetSRTUpload = (file: File) => {
        if (!originalVideoPath) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            if (text) {
                const newSegments = parseSRTContent(text);
                if (newSegments.length > 0) {
                    const preparedSegments = newSegments.map(s => ({ ...s, audioStatus: 'none' as const }));
                    setTranslatedSegments(preparedSegments);
                    setStatus(`已加载译文字幕 (${newSegments.length} 条)`);
                } else {
                    setStatus(`译文字幕解析失败：未找到有效字幕片段`);
                }
            }
        };
        reader.readAsText(file);
    };

    const handleOneClickRun = async () => {
        if (!originalVideoPath) {
            setStatus("请先选择视频");
            return;
        }
        abortRef.current = false;

        const asrSegs = await handleASR();
        if (!asrSegs) return;

        const transSegs = await handleTranslate(asrSegs);
        if (!transSegs) return;

        // Pass translated segments directly to avoid React async state update issues
        const dubbedSegs = await handleGenerateAllDubbing(transSegs);
        if (!dubbedSegs) return;

        setStatus('等待文件写入...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        await handleMergeVideo(dubbedSegs);
    };

    const handleTranslateAndDub = async () => {
        abortRef.current = false;
        const transSegs = await handleTranslate();
        if (!transSegs) return;

        // Pass translated segments directly to avoid React async state update issues
        const dubbedSegs = await handleGenerateAllDubbing(transSegs);
        if (!dubbedSegs) return;

        await handleMergeVideo(dubbedSegs);
    };

    const handleStop = async () => {
        abortRef.current = true;
        try {
            await (window as any).ipcRenderer.invoke('kill-backend');
            setStatus("任务已由用户停止");
        } catch (e) {
            console.error("Stop failed", e);
        } finally {
            setLoading(false);
            setDubbingLoading(false);
            setIsIndeterminate(false);
            setProgress(0);
            setGeneratingSegmentId(null);  // Clear single generation state
        }
    };

    return {
        // States
        videoPath, setVideoPath,
        originalVideoPath, setOriginalVideoPath,
        mergedVideoPath, setMergedVideoPath,
        segments, setSegments,
        translatedSegments, setTranslatedSegments,
        videoStrategy, setVideoStrategy,
        status, setStatus,
        loading, setLoading,
        dubbingLoading, setDubbingLoading,
        generatingSegmentId, setGeneratingSegmentId,
        retranslatingSegmentId, setRetranslatingSegmentId,
        progress, setProgress,
        isIndeterminate, setIsIndeterminate,
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

        // Handlers
        handleASR,
        handleTranslate,
        handleReTranslate,
        handleRetryErrors,
        handleGenerateSingleDubbing,
        handleGenerateAllDubbing,
        handleMergeVideo,
        parseSRTContent,
        handleSRTUpload,
        handleTargetSRTUpload,
        handleOneClickRun,
        handleTranslateAndDub,
        handleStop,

        // Flags
        hasErrors,

        // Refs
        abortRef,

        // Utilities
        formatTimeSRT
    };
}
