import sys
import os
import argparse
# import torch # Moved to inside main/functions for safety
import pathlib

# FORCE IMMEDIATE FLUSH
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
print("DEBUG: Pre-import check passed", file=sys.stderr, flush=True)

# [USER REQUEST] Force Offline for manual handling of models
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ["PYTHONUTF8"] = "1"

# Force UTF-8 for stdout/stderr
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')


import subprocess

current_script_dir = os.path.dirname(os.path.abspath(__file__))
if current_script_dir not in sys.path:
    sys.path.insert(0, current_script_dir)

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
# With flat structure, APP_ROOT is consistently the parent of backend/
APP_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
# Detect production by checking for app.asar (typically in resources/) or if sys is frozen
IS_PROD = os.path.exists(os.path.join(APP_ROOT, "resources", "app.asar")) or getattr(sys, 'frozen', False)

# Logging to "logs" folder in App Root (or Project Root)
log_dir = os.path.join(APP_ROOT, "logs")
log_file = os.path.join(log_dir, "backend_debug.log")

try:
    if not os.path.exists(log_dir):
        os.makedirs(log_dir, exist_ok=True)
        
    def debug_log(msg):
        try:
            with open(log_file, "a", encoding="utf-8") as f:
                import datetime
                ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                f.write(f"[{ts}] {msg}\n")
        except:
            print(f"Log Error: {msg}")

    debug_log("Backend starting...")
    debug_log(f"Executable: {sys.executable}")
    debug_log(f"CWD: {os.getcwd()}")
    debug_log(f"App Root: {APP_ROOT}")
    debug_log(f"Is Prod: {IS_PROD}")

except Exception as e:
    print(f"Logging setup failed: {e}")
    # Fallback logger
    def debug_log(msg):
        print(f"[LOG_FAIL] {msg}")

def exception_hook(exc_type, exc_value, exc_traceback):
    import traceback
    error_msg = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
    try:
        debug_log(f"UNHANDLED EXCEPTION:\n{error_msg}")
    except:
        pass
    sys.__excepthook__(exc_type, exc_value, exc_traceback)

sys.excepthook = exception_hook



if not getattr(sys, 'frozen', False):
    try:
        # Portable python is expected to be in APP_ROOT/python/python.exe
        portable_python = os.path.join(APP_ROOT, "python", "python.exe")
        
        if os.path.exists(portable_python):
            # Normalize paths for comparison
            target_py = os.path.abspath(portable_python).lower()
            current_py = sys.executable.lower()
            
            if target_py != current_py:
                print(f"[BOOTSTRAP] Relaunching with portable python: {target_py}")
                # Ensure we pass all original arguments
                cmd = [target_py, __file__] + sys.argv[1:]
                
                # Pass environment but ensure PATH includes python Scripts/Lib (optional, but good)
                env = os.environ.copy()
                
                # Execute
                ret = subprocess.call(cmd, env=env)
                sys.exit(ret)
                
    except Exception as e:
        print(f"[BOOTSTRAP WARNING] Failed to enforce portable python: {e}")

class DualWriter:
    def __init__(self, file_path, original_stream):
        self.file = open(file_path, "a", encoding="utf-8", buffering=1)
        self.original_stream = original_stream

    def write(self, message):
        try:
            self.file.write(message)
            self.original_stream.write(message)
            self.original_stream.flush()
        except:
            pass

    def flush(self):
        try:
            self.file.flush()
            self.original_stream.flush()
        except:
            pass

if log_file:
    sys.stdout = DualWriter(log_file, sys.stdout)
    sys.stderr = DualWriter(log_file, sys.stderr)

# ... (Logging setup done) ...

if not getattr(sys, 'frozen', False):
    # (Portable python check kept as is)
    pass

# Check for --model_dir in sys.argv
MODELS_HUB_DIR = None
if "--model_dir" in sys.argv:
    try:
        idx = sys.argv.index("--model_dir")
        if idx + 1 < len(sys.argv):
            MODELS_HUB_DIR = os.path.abspath(sys.argv[idx + 1])
    except:
        pass

if not MODELS_HUB_DIR:
    # Search for models in common locations
    possible_paths = [
        os.path.join(APP_ROOT, "models", "index-tts", "hub"),  # User installed in Root
        os.path.join(APP_ROOT, "resources", "models", "index-tts", "hub"), # User copied to resources
        os.path.join(CURRENT_DIR, "..", "models", "index-tts", "hub") # Dev / Default
    ]
    
    print(f"[DEBUG] APP_ROOT detected as: {APP_ROOT}")
    print(f"[DEBUG] Checking model paths:")
    
    for p in possible_paths:
        exists = os.path.exists(p)
        content_len = len(os.listdir(p)) if exists else 0
        print(f"  - {p} (Exists: {exists}, Items: {content_len})")
        
        if exists:
            # Check if it actually has content (not just empty folder)
            if content_len > 0: 
                MODELS_HUB_DIR = p
                print(f"  [SELECTED] Found valid model dir at: {p}")
                break
    
    # Fallback if none found with content
    if not MODELS_HUB_DIR:
         print("  [WARNING] No valid model dir found in candidates. Defaulting to Root path.")
         MODELS_HUB_DIR = os.path.join(APP_ROOT, "models", "index-tts", "hub")

if not os.path.exists(MODELS_HUB_DIR):
    print(f"[WARNING] Model directory not found: {MODELS_HUB_DIR}", file=sys.stderr)
    print(f"[WARNING] Local WhisperX models will be unavailable. Free API service (Bcut) can still be used.", file=sys.stderr)
    # Don't exit, allow startup for API usage
    # sys.exit(1)
    
log_location = f"Models found at: {MODELS_HUB_DIR}"
print(log_location)

os.environ["HF_HOME"] = MODELS_HUB_DIR
os.environ["HF_HUB_CACHE"] = MODELS_HUB_DIR
# 禁用HuggingFace自动下载
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

# Setup Portable FFmpeg
# In prod, we bundle ffmpeg into the backend folder, so relative path is same
sys_frozen = getattr(sys, 'frozen', False)
backend_root = os.path.dirname(os.path.abspath(sys.executable)) if sys_frozen else os.path.dirname(os.path.abspath(__file__))
ffmpeg_bin = os.path.join(backend_root, "ffmpeg", "bin")

if os.path.exists(os.path.join(ffmpeg_bin, "ffmpeg.exe")):
    print(f"Using portable FFmpeg from: {ffmpeg_bin}")
    os.environ["PATH"] = ffmpeg_bin + os.pathsep + os.environ["PATH"]
else:
    print("Portable FFmpeg not found, using system PATH.")

def setup_gpu_paths():
    """
    Add PyTorch and NVIDIA cuDNN directories to PATH and DLL search path.
    Essential for Windows portable environments to find cudnn_ops_infer64_8.dll etc.
    MUST be called before 'import torch' to prevent DLL load crashes.
    """
    try:
        # Helper to add valid paths
        def add_path(path):
            if os.path.exists(path):
                # 1. Add to PATH
                if path not in os.environ["PATH"]:
                    os.environ["PATH"] = path + os.pathsep + os.environ["PATH"]
                    # print(f"[DEBUG] Added to PATH: {path}")
                
                # 2. Add to DLL Directory (Python 3.8+ Windows)
                if hasattr(os, 'add_dll_directory'):
                    try:
                        os.add_dll_directory(path)
                        # print(f"[DEBUG] Added DLL Directory: {path}")
                    except Exception as e:
                        pass

        # 1. Proactively add portable python paths (Pre-import fix for hard crashes)
        # This guesses the location of site-packages relative to python.exe
        base_dir = os.path.dirname(sys.executable)
        
        # Candidate: Lib/site-packages (Windows Default/Portable)
        site_packages = os.path.join(base_dir, "Lib", "site-packages")
        if not os.path.exists(site_packages):
             # Try lowercase/variants
             site_packages = os.path.join(base_dir, "lib", "site-packages")

        if os.path.exists(site_packages):
            # Add NVIDIA dependencies explicitly BEFORE torch import
            nvidia_packages = ["cudnn", "cublas", "cuda_runtime", "cudart"]
            for pkg in nvidia_packages:
                for sub in ["bin", "lib"]: # Check both bin and lib
                    p = os.path.join(site_packages, "nvidia", pkg, sub)
                    add_path(p)

            # Add torch/lib
            add_path(os.path.join(site_packages, "torch", "lib"))
        
        # 2. Also try via standard import if it works (Double check)
        try:
            import torch
            torch_path = os.path.dirname(torch.__file__)
            add_path(os.path.join(torch_path, 'lib'))
            
            site_pkgs = os.path.dirname(os.path.dirname(torch.__file__))
            add_path(os.path.join(site_pkgs, "nvidia", "cudnn", "bin"))
        except:
            pass # Ignore import errors here, we relied on heuristic above

    except Exception as e:
        print(f"[WARNING] Failed to patch DLL paths: {e}")


# 238: 
# Lazy Imports moved to functions or after dependency checks
from asr import run_asr
from alignment import align_audio, get_audio_duration, merge_audios_to_video
try:
    import librosa
    import soundfile as sf
except ImportError:
    pass # Will handle later or assume installed, get_audio_duration
from llm import LLMTranslator
import ffmpeg
import json
import shutil
from dependency_manager import ensure_transformers_version, check_gpu_deps

# Global TTS entry points (lazy loaded)
_run_tts = None
_run_batch_tts = None

def get_tts_runner(service="indextts", check_deps=True):
    global _run_tts, _run_batch_tts
    
    # Dependency Check
    if check_deps:
        if service == "qwen":
            print("[Main] Ensuring dependencies for Qwen3-TTS...")
            setup_gpu_paths()
            if ensure_transformers_version("4.57.3"):
                 check_gpu_deps()
                 print("[Main] Qwen3 dependencies ready.")
            else:
                 print("[Main] Failed to setup Qwen3 dependencies.")
                 return None, None
        else:
            # Default/IndexTTS
            print("[Main] Ensuring dependencies for IndexTTS...")
            if ensure_transformers_version("4.52.1"):
                 print("[Main] IndexTTS dependencies ready.")
            else:
                 print("[Main] Failed to setup IndexTTS dependencies.")
                 return None, None
    
    # Import
    try:
        if service == "qwen":
            # Assume we will implement qwen_tts_service
            from qwen_tts_service import run_qwen_tts, run_batch_qwen_tts
            return run_qwen_tts, run_batch_qwen_tts
        else:
            from tts import run_tts, run_batch_tts
            return run_tts, run_batch_tts
    except ImportError as e:
        print(f"[Main] Failed to import TTS service {service}: {e}")
        return None, None



def analyze_video(file_path):
    try:
        probe = ffmpeg.probe(file_path)
        video_stream = next((stream for stream in probe['streams'] if stream['codec_type'] == 'video'), None)
        audio_stream = next((stream for stream in probe['streams'] if stream['codec_type'] == 'audio'), None)
        
        info = {
            "format_name": probe['format'].get('format_name'),
            "duration": float(probe['format'].get('duration', 0)),
            "video_codec": video_stream['codec_name'] if video_stream else None,
            "audio_codec": audio_stream['codec_name'] if audio_stream else None,
            "width": int(video_stream['width']) if video_stream else 0,
            "height": int(video_stream['height']) if video_stream else 0,
        }
        return {"success": True, "info": info}
    except Exception as e:
        return {"success": False, "error": str(e)}

def transcode_video(input_path, output_path):
    print(f"Transcoding {input_path} to {output_path}...")
    try:
        stream = ffmpeg.input(input_path)
        stream = ffmpeg.output(stream, output_path, vcodec='libx264', acodec='aac', preset='fast', crf=23)
        ffmpeg.run(stream, overwrite_output=True, quiet=False)
        return {"success": True, "output": output_path}
    except ffmpeg.Error as e:
        err = e.stderr.decode() if e.stderr else str(e)
        print(f"Transcoding failed: {err}")
        return {"success": False, "error": err}
    except Exception as e:
        print(f"Transcoding failed: {e}")
        return {"success": False, "error": str(e)}

def translate_text(input_text_or_json, target_lang, **kwargs):
    """
    Translates text or a list of segments (JSON string).
    """
    translator = LLMTranslator(**kwargs)
    
    try:
        # Try to parse as JSON list of segments
        import json
        data = json.loads(input_text_or_json)
        
        if isinstance(data, list):
            # [Batch Mode for External API]
            if translator.use_external:
                print(f"Batch Translating {len(data)} segments via External API to {target_lang}...")
                
                # Extract texts
                texts_to_translate = [item.get('text', '') for item in data]
                
                # Perform Batch Translation
                translated_texts = translator.translate_batch(texts_to_translate, target_lang)
                
                # Reassemble
                translated_segments = []
                for i, item in enumerate(data):
                    new_item = item.copy()
                    # Safety check for length mismatch (handled in llm.py but good to be safe)
                    trans_text = translated_texts[i] if i < len(translated_texts) else item.get('text', '')
                    new_item['text'] = trans_text
                    translated_segments.append(new_item)
                    
                    # Optional: Print progress or debug?
                    # Batch is fast, maybe just print first/last or summary
                
                print(f"Batch translation complete. Processed {len(translated_segments)} segments.")
                translator.cleanup()
                return {"success": True, "segments": translated_segments}

            # [Original Loop for Local Model]
            print(f"Translating {len(data)} segments to {target_lang}...")
            translated_segments = []
            for idx, item in enumerate(data):
                original = item.get('text', '')
                if not original:
                    translated_segments.append(item)
                    continue
                    
                print(f"  [{idx+1}/{len(data)}] {original}")
                print(f"[PROGRESS] {int((idx + 1) / len(data) * 100)}", flush=True)
                trans = translator.translate(original, target_lang)
                
                # Stream partial result
                partial_data = {
                    "index": idx,
                    "text": trans if trans else original
                }
                print(f"[PARTIAL] {json.dumps(partial_data)}", flush=True)
                
                new_item = item.copy()
                new_item['text'] = trans if trans else original
                new_item['text'] = trans if trans else original
                translated_segments.append(new_item)
            
            translator.cleanup()
            return {"success": True, "segments": translated_segments}
        else:
            # Simple string
            trans = translator.translate(input_text_or_json, target_lang)
            translator.cleanup()
            return {"success": True, "text": trans}
            
    except json.JSONDecodeError:
        # Not JSON, treat as raw text
        # Not JSON, treat as raw text
        trans = translator.translate(input_text_or_json, target_lang)
        translator.cleanup()
        return {"success": True, "text": trans}
    except Exception as e:
        return {"success": False, "error": str(e)}


# 333: 
def dub_video(input_path, target_lang, output_path, asr_service="whisperx", vad_onset=0.700, vad_offset=0.700, tts_service="indextts", **kwargs):
    print(f"Starting AI Dubbing for {input_path} -> {target_lang} using ASR:{asr_service} TTS:{tts_service}", flush=True)
    
    # 0. Get TTS Runner (This will switch deps if needed)
    run_tts_func, _ = get_tts_runner(tts_service)
    if not run_tts_func:
        return {"success": False, "error": f"Failed to initialize TTS service: {tts_service}"}

    # 1. Initialize LLM
    translator = LLMTranslator(**kwargs)
    
    # 2. Run ASR
    print("Step 1/4: Running ASR...", flush=True)
    
    output_dir_root = os.path.dirname(output_path)
    basename = os.path.splitext(os.path.basename(output_path))[0]
    segments_dir = os.path.join(output_dir_root, f"{basename}_segments") 
    
    
    cache_dir = os.path.join(output_dir_root, ".cache")
    if not os.path.exists(cache_dir):
        os.makedirs(cache_dir)
        
    segments = run_asr(input_path, service=asr_service, output_dir=cache_dir, vad_onset=vad_onset, vad_offset=vad_offset) 
    if not segments:
        return {"success": False, "error": "ASR failed or no speech detected."}
    
    
    output_dir = os.path.dirname(output_path)
    basename = os.path.splitext(os.path.basename(output_path))[0]
    segments_dir = os.path.join(output_dir, f"{basename}_segments")
    
    print(f"DEBUG: Output Path: {output_path}")
    print(f"DEBUG: Segments Dir: {segments_dir}")
    print(f"DEBUG: Input Path: {input_path}")
    
    if os.path.exists(segments_dir):
        shutil.rmtree(segments_dir)
    os.makedirs(segments_dir)

    new_audio_segments = []
    result_segments = [] 
    
    
    print(f"Step 2: Translating {len(segments)} segments...", flush=True)
    
    tts_tasks = []
    
    for idx, seg in enumerate(segments):
        original_text = seg['text']
        start = seg['start']
        end = seg['end']
        duration = max(end - start, 0.1) # Enforce min duration of 0.1s to prevent alignment errors
        
        print(f"  [{idx+1}/{len(segments)}] Translating: {original_text}")
        translated_text = translator.translate(original_text, target_lang)
        print(f"    -> {translated_text}")
        
        if not translated_text:
             print("    Skipping (Translation failed)")
             continue
             
        tts_tasks.append({
            "idx": idx,
            "translated_text": translated_text,
            "start": start,
            "duration": duration,
            "original_seg": seg
        })
        
    print("Translation done. Releasing LLM VRAM...", flush=True)
    translator.cleanup()
    del translator
    
    print(f"Step 3: Cloning Voice for {len(tts_tasks)} segments using {tts_service}...", flush=True)
    
    for item in tts_tasks:
        idx = item['idx']
        translated_text = item['translated_text']
        start = item['start']
        duration = item['duration']
        
        ref_clip_path = os.path.join(segments_dir, f"ref_{idx}.wav")
        tts_output_path = os.path.join(segments_dir, f"dub_{idx}.wav")
        try:
            (
                ffmpeg
                .input(input_path, ss=start, t=duration)
                .output(ref_clip_path, acodec='pcm_s16le', ac=1, ar=24000, loglevel="error")
                .run(overwrite_output=True)
            )
        except Exception as e:
            print(f"    Failed to extract ref audio: {e}")
            continue

        global_ref_override = kwargs.get('ref_audio') # passed from main args 'ref_audio' -> kwargs?? No, main args maps to kwargs 
        effective_ref_audio = ref_clip_path
        if kwargs.get('ref_audio'):
             effective_ref_audio = kwargs.get('ref_audio')
        
        # Call the dynamic runner
        success = run_tts_func(translated_text, effective_ref_audio, tts_output_path, language=target_lang, **kwargs)
        
        if success:
                
            should_align = True
            strategy = kwargs.get('strategy', 'auto_speedup')
            if strategy in ['frame_blend', 'freeze_frame', 'rife']:
                should_align = False
                print(f"    [DubVideo] Strategy is {strategy}, skipping audio alignment.")

            if duration > 0 and should_align:
                try:
                    current_dur = get_audio_duration(tts_output_path)
                    if current_dur and current_dur > duration + 0.1:
                        print(f"    [DubVideo] Segment {idx} duration {current_dur:.2f}s > {duration:.2f}s. Aligning...")
                        temp_aligned = tts_output_path.replace('.wav', '_aligned_temp.wav')
                        if align_audio(tts_output_path, temp_aligned, duration):
                            try:
                                if os.path.exists(tts_output_path):
                                     os.remove(tts_output_path)
                                os.rename(temp_aligned, tts_output_path)
                                print(f"    [DubVideo] Aligned and overwritten: {tts_output_path}")
                            except Exception as e:
                                print(f"    [DubVideo] Failed to overwrite aligned file: {e}")
                except Exception as e:
                    print(f"    [DubVideo] Auto-align warning: {e}")

            new_audio_segments.append({
                'start': start,
                'path': tts_output_path,
                'duration': duration 
            })
            result_segments.append({
                "index": idx,
                "text": translated_text,
                "audio_path": tts_output_path,
                "duration": duration
            })
            
            try:
                os.remove(ref_clip_path)
            except:
                pass
        
    # 4. Merge
    print("Step 4/4: Merging Video...")
    success = merge_audios_to_video(input_path, new_audio_segments, output_path, strategy=kwargs.get('strategy', 'auto_speedup'))
    
    if success:
        return {
            "success": True, 
            "output": output_path, 
            "segments": result_segments # Return path info
        }
    else:
        return {"success": False, "error": "Merging failed."}



def main():
    # Setup GPU paths early to prevent DLL load errors
    setup_gpu_paths()
    
    # Lazy import torch now that paths are set
    global torch
    import torch

    parser = argparse.ArgumentParser(description="VideoSync Backend")
    parser.add_argument("--action", type=str, help="Action to perform: asr, tts, align, merge_video", default="test_asr")
    parser.add_argument("--input", type=str, help="Input file path or JSON string for complex inputs")
    parser.add_argument("--ref", type=str, help="Reference audio path for TTS (or segments JSON for batch)")
    parser.add_argument("--ref_audio", type=str, help="Explicit reference audio path (overrides auto-extraction)")
    parser.add_argument("--output", type=str, help="Output path")
    parser.add_argument("--duration", type=float, help="Target duration in seconds for Alignment")
    parser.add_argument("--lang", type=str, help="Target language for translation/dubbing", default="English")
    parser.add_argument("--ori_lang", type=str, help="Source language for ASR", default="Chinese")
    parser.add_argument("--json", action="store_true", help="Output result as JSON")
    parser.add_argument("--text", type=str, help="Text to speak (for generate_single_tts)")
    parser.add_argument("--start", type=float, help="Start time in seconds (for generate_single_tts)", default=0.0)
    parser.add_argument("--model_dir", type=str, help="Path to models directory (HF_HOME)")
    parser.add_argument("--asr", type=str, help="ASR service to use: whisperx, bcut", default="whisperx")
    parser.add_argument("--temperature", type=float, help="TTS Temperature", default=0.8)
    parser.add_argument("--top_p", type=float, help="Top P", default=0.8)
    parser.add_argument("--repetition_penalty", type=float, help="Repetition Penalty", default=1.0)
    parser.add_argument("--cfg_scale", type=float, help="CFG Scale", default=0.7)
    
    # New Advanced Params
    parser.add_argument("--num_beams", type=int, help="Num Beams for beam search", default=1)
    parser.add_argument("--top_k", type=int, help="Top K sampling", default=5)
    parser.add_argument("--length_penalty", type=float, help="Length Penalty for beam search", default=1.0)
    parser.add_argument("--max_new_tokens", type=int, help="Max New Tokens (mel length limit)", default=2048)
    parser.add_argument("--strategy", type=str, help="Video sync strategy: auto_speedup, freeze_frame, frame_blend", default="auto_speedup")
    parser.add_argument("--output_dir", type=str, help="Output directory for debug/intermediate files")
    parser.add_argument("--vad_onset", type=float, help="VAD onset threshold", default=0.700)
    parser.add_argument("--vad_offset", type=float, help="VAD offset threshold", default=0.700)
    parser.add_argument("--tts_service", type=str, help="TTS Service: indextts or qwen", default="indextts")
    parser.add_argument("--qwen_mode", type=str, help="Qwen TTS Mode: clone, design, preset", default="clone")
    parser.add_argument("--voice_instruct", type=str, help="Voice Design Instruction", default="")
    parser.add_argument("--preset_voice", type=str, help="Preset Voice for Qwen3", default="Vivian")
    parser.add_argument("--qwen_model_size", type=str, help="Qwen Model Size: 1.7B or 0.6B", default="1.7B")
    parser.add_argument("--qwen_ref_text", type=str, help="Reference text for Qwen Clone mode", default="")
    parser.add_argument("--batch_size", type=int, help="Batch Size for TTS", default=10)
    parser.add_argument("--api_key", type=str, help="API Key for External Translation", default=None)
    parser.add_argument("--base_url", type=str, help="Base URL for External Translation", default=None)
    parser.add_argument("--model", type=str, help="Model Name for External Translation", default=None)
    args = parser.parse_args()

    tts_kwargs = {
        "temperature": args.temperature,
        "top_p": args.top_p,
        "top_k": args.top_k,
        "repetition_penalty": args.repetition_penalty,
        "inference_cfg_rate": args.cfg_scale, 
        "cfg_scale": args.cfg_scale, 
        "num_beams": args.num_beams,
        "length_penalty": args.length_penalty,
        "max_new_tokens": args.max_new_tokens,
        "qwen_mode": args.qwen_mode,
        "voice_instruct": args.voice_instruct,
        "preset_voice": args.preset_voice,
        "qwen_model_size": args.qwen_model_size,
        "qwen_model_size": args.qwen_model_size,
        "qwen_ref_text": args.qwen_ref_text,
        "ref_audio": args.ref_audio  # Add explicit ref_audio support for Qwen Design->Clone handoff
    }

    # Pass External API args to kwargs for use in translation
    extra_kwargs = {}
    if args.api_key:
        extra_kwargs['api_key'] = args.api_key
        if args.base_url: extra_kwargs['base_url'] = args.base_url
        if args.model: extra_kwargs['model'] = args.model

    result_data = None
    
    if args.action == "test_asr":
        # ... (Existing ASR code) ...
        if args.input:
            if not args.json:
                print(f"Testing ASR on {args.input} using {args.asr} (Original Language: {args.ori_lang})", flush=True)
            # Pass output_dir for raw saving
            segments = run_asr(args.input, service=args.asr, output_dir=args.output_dir, vad_onset=args.vad_onset, vad_offset=args.vad_offset, language=args.ori_lang)
            if args.json:
                result_data = segments
            else:
                for seg in segments:
                    print(f"[{seg['start']:.2f} -> {seg['end']:.2f}] {seg['text']}")
        else:
            print("Please provide --input to test ASR.")
            
    elif args.action == "translate_text":
        if args.input and args.lang:
            result_data = translate_text(args.input, args.lang, **extra_kwargs)
            if not args.json:
                print(result_data)
        else:
            print("Usage: --action translate_text --input 'Text' --lang 'Chinese'")
            
    elif args.action == "test_tts":
        # Dynamic Dispatch
        tts_service_name = getattr(args, 'tts_service', 'indextts')
        run_tts_func, _ = get_tts_runner(tts_service_name)
        
        if not run_tts_func:
                print(f"Error: Failed to init TTS service {tts_service_name}")
        elif args.input and args.output: # Ref optional for Qwen Design
            if not args.json:
                print(f"Testing TTS ({tts_service_name}).")
            
            target_lang = args.lang if args.lang else "English"
            ref_audio = args.ref if args.ref else None
            
            # Prepare kwargs
            runtime_kwargs = tts_kwargs.copy()
            if hasattr(args, 'qwen_mode'): runtime_kwargs['qwen_mode'] = args.qwen_mode
            if hasattr(args, 'voice_instruct'): runtime_kwargs['voice_instruct'] = args.voice_instruct
            
            try:
                success = run_tts_func(args.input, ref_audio, args.output, language=target_lang, **runtime_kwargs)
                if args.json:
                    result_data = {"success": success, "output": args.output}
            except Exception as e:
                print(f"Error: {e}")
                if args.json: result_data = {"success": False, "error": str(e)}

        else:
            print("Usage: --action test_tts --input 'Text' --ref 'ref.wav' --output 'out.wav' --lang 'Japanese'")
            
    elif args.action == "test_align":
         # ... (keep existing) ...
        if args.input and args.output and args.duration:
            if not args.json:
                print(f"Testing Alignment.")
            success = align_audio(args.input, args.output, args.duration)
            if args.json:
                result_data = {"success": success, "output": args.output}
        else:
            print("Usage: --action test_align --input 'in.wav' --output 'out.wav' --duration 5.0")

    elif args.action == "merge_video":

        if args.input and args.ref and args.output:
            video_path = args.input
            json_path = args.ref
            output_path = args.output
            
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    audio_segments = json.load(f)
                
                if not args.json:
                    print(f"Merging {len(audio_segments)} audio clips into {video_path}")

                # Pre-process segments to ensure they fit in their slots
                for i, seg in enumerate(audio_segments):
                    # We need start and end to define slot
                    if 'start' in seg and 'end' in seg and 'path' in seg:
                         target_duration = float(seg['end']) - float(seg['start'])
                         audio_segments[i]['duration'] = target_duration # Explicitly store for advanced merge
                         audio_path = seg['path']
                         
                         if os.path.exists(audio_path):
                             current_duration = get_audio_duration(audio_path)
                             if current_duration:
                                 # If audio is significantly longer than slot (e.g. > 0.1s diff), compress it.
                                 if current_duration > target_duration + 0.1:
                                     # Check strategy
                                     if args.strategy in ['frame_blend', 'freeze_frame', 'rife']:
                                         print(f"Segment {i} exceeds slot, but strategy is {args.strategy}. Skipping audio alignment.")
                                     else:
                                         print(f"Segment {i} duration ({current_duration:.2f}s) exceeds slot ({target_duration:.2f}s). Aligning...")
                                         
                                         # Create aligned path
                                         aligned_path = audio_path.replace('.wav', '_aligned.wav')
                                         
                                         # Align (compress)
                                         if align_audio(audio_path, aligned_path, target_duration):
                                             # Update path in segment to point to aligned file
                                             audio_segments[i]['path'] = aligned_path
                                         else:
                                             print(f"Failed to align segment {i}, using original.")
                                 else:
                                     pass # Fits or is shorter
                             else:
                                 print(f"Could not get duration for {audio_path}")
                         else:
                             print(f"Audio file not found: {audio_path}")
                
                success = merge_audios_to_video(video_path, audio_segments, output_path, strategy=args.strategy)
                
                if args.json:
                    result_data = {"success": success, "output": output_path}
            except Exception as e:
                print(f"Error loading JSON or merging: {e}")
                if args.json:
                    result_data = {"success": False, "error": str(e)}
        else:
            print("Usage: --action merge_video --input video.mp4 --ref segments.json --output final.mp4")
    
    elif args.action == "analyze_video":
        if args.input:
            result_data = analyze_video(args.input)
            if not args.json:
                print(result_data)
        else:
             print("Please provide --input video path")

    elif args.action == "transcode_video":
        if args.input and args.output:
            result_data = transcode_video(args.input, args.output)
            if not args.json:
                print(result_data)
        else:
            print("Usage: --action transcode_video --input in.mp4 --output out.mp4")

    elif args.action == "dub_video":
        if args.input and args.output:
            target = args.lang if args.lang else "English"
            # Combine tts_kwargs and extra_kwargs (for API keys)
            combined_kwargs = {**tts_kwargs, **extra_kwargs}
            result_data = dub_video(args.input, target, args.output, asr_service=args.asr, strategy=args.strategy, **combined_kwargs)
            if not args.json:
                print(result_data)
        else:
            print("Usage: --action dub_video --input video.mp4 --output dubbed.mp4 --lang 'Chinese'")
    

# 640:
    elif args.action == "generate_single_tts":
        # Generate TTS for a single segment
        # Requires: --input (video), --output (segment audio path), --text (text to speak), --start, --duration, --lang
        
        # Determine TTS Service
        tts_service_name = getattr(args, 'tts_service', 'indextts')
        run_tts_func, _ = get_tts_runner(tts_service_name)
        if not run_tts_func:
             result_data = {"success": False, "error": f"Failed to init TTS: {tts_service_name}"}
             if not args.json: print(result_data)
             # Early exit logic requires handling main's structure. 
             # We will just print JSON at end, so set result_data.
        
        if args.input == 'dummy':
             if args.json:
                 print(json.dumps({"success": True, "message": "Service initialized"}))
             return

        elif args.input and args.output:
            try:
                video_path = args.input
                output_audio = args.output
                text = getattr(args, 'text', None)
                start_time = getattr(args, 'start', 0.0)
                duration = args.duration if args.duration else 3.0
                target_lang = args.lang if args.lang else "English"
                
                if not text:
                    result_data = {"success": False, "error": "Missing --text argument"}
                else:

                    # 1. Extract or Use Reference Audio
                    ref_clip_path = output_audio.replace('.wav', '_ref.wav')
                    
                    # Check if global ref provided
                    if args.ref_audio and os.path.exists(args.ref_audio):
                        print(f"Using explicit reference audio: {args.ref_audio}")
                        ref_clip_path = args.ref_audio
                        # Don't delete user's ref file later
                        should_delete_ref = False
                    else:
                        # Extract from video
                        try:
                            # Use .cache/raw for stricter debugging
                            raw_dir = os.path.join(os.path.dirname(output_audio), ".cache", "raw")
                            os.makedirs(raw_dir, exist_ok=True)
                            raw_ref_path = os.path.join(raw_dir, f"ref_raw_{start_time}.wav")

                            ffmpeg.input(video_path, ss=start_time, t=duration).output(
                                raw_ref_path, acodec='pcm_s16le', ac=1, ar=24000, loglevel="error"
                            ).run(overwrite_output=True)
                            
                            # TRIM SILENCE
                            try:
                                y, sr = librosa.load(raw_ref_path, sr=None)
                                y_trim, _ = librosa.effects.trim(y, top_db=20) # 20dB threshold
                                trim_dur = len(y_trim) / sr
                                
                                if trim_dur < 0.5:
                                    print(f"Warning: Extracted ref audio too short after trim ({trim_dur:.2f}s < 0.5s). May cause hallucination!")
                                    # Logic: Fail or fallback? User requested strictness.
                                    # If strictly failing:
                                    # result_data = {"success": False, "error": "Reference audio contains only silence"}
                                    # return
                                    # But let's just warn for SingleTTS, or maybe use untrimmed if that was better? No, silence is bad.
                                    pass
                                else:
                                    print(f"Ref audio trimmed: {len(y)/sr:.2f}s -> {trim_dur:.2f}s")
                                
                                # Save FINAL ref to the path expected by TTS
                                if len(y_trim) > 0:
                                    sf.write(ref_clip_path, y_trim, sr)
                                else:
                                     # Fallback to copy if trim failed completely (shouldn't happen if duration checks out)
                                    import shutil
                                    shutil.copy(raw_ref_path, ref_clip_path)

                            except Exception as trim_err:
                                print(f"Warning: Failed to trim silence from ref: {trim_err}")
                                # Fallback
                                import shutil
                                shutil.copy(raw_ref_path, ref_clip_path)

                            should_delete_ref = True
                        except Exception as e:
                            result_data = {"success": False, "error": f"Failed to extract ref audio: {str(e)}"}
                            if args.json:
                                print(json.dumps(result_data))
                            return
                    
                    # 2. Use provided text directly (Do NOT re-translate, to respect user edits)
                    translated_text = text
                    
                    if not translated_text:
                        result_data = {"success": False, "error": "No text provided"}
                    else:
                        # 3. Generate TTS
                        success = run_tts_func(translated_text, ref_clip_path, output_audio, language=target_lang, **tts_kwargs)
                        
                        # 4. Cleanup ref
                        try:
                            if should_delete_ref and os.path.exists(ref_clip_path):
                                os.remove(ref_clip_path)
                        except:
                            pass
                        
                        if success:
                            if duration > 0: 
                                try:
                                    current_dur = get_audio_duration(output_audio)
                                    if current_dur and current_dur > duration + 0.1:
                                        # Check strategy
                                        strategy = getattr(args, 'strategy', 'auto_speedup')
                                        if strategy in ['frame_blend', 'freeze_frame', 'rife']:
                                             print(f"[SingleTTS] Duration {current_dur:.2f}s > {duration:.2f}s. Strategy {strategy}, skipping alignment.")
                                        else:
                                            print(f"[SingleTTS] Duration {current_dur:.2f}s > {duration:.2f}s. Aligning...")
                                            temp_aligned = output_audio.replace('.wav', '_aligned_temp.wav')
                                            if align_audio(output_audio, temp_aligned, duration):
                                                import shutil
                                                shutil.move(temp_aligned, output_audio)
                                                print(f"[SingleTTS] Aligned and overwritten: {output_audio}")
                                            else:
                                                print("[SingleTTS] Alignment failed.")
                                except Exception as e:
                                    print(f"[SingleTTS] Warning: Auto-alignment failed: {e}")

                            final_duration = 0.0
                            try:
                                final_duration = get_audio_duration(output_audio)
                            except:
                                pass
                            result_data = {"success": True, "audio_path": output_audio, "text": translated_text, "duration": final_duration}
                        else:
                            result_data = {"success": False, "error": "TTS generation failed"}
            except Exception as e:
                result_data = {"success": False, "error": str(e)}
        else:
            print("Usage: --action generate_single_tts --input video.mp4 --output segment.wav --text 'Hello' --start 0.5 --duration 2.5 --lang English")

    elif args.action == "translate_text":
        if args.input:
            target = args.lang if args.lang else "English"
            result_raw = translate_text(args.input, target)
            
            if isinstance(result_raw, dict):
                 result_data = result_raw
            else:
                 result_data = {"success": True, "text": result_raw}

            if not args.json:
                print(result_raw)
        else:
            print("Usage: --action translate_text --input 'Text or JSON' --lang 'Chinese'")

    elif args.action == "generate_batch_tts":
        # Determine TTS Service
        tts_service_name = getattr(args, 'tts_service', 'indextts')
        _, run_batch_tts_func = get_tts_runner(tts_service_name)
        if not run_batch_tts_func:
             result_data = {"success": False, "error": f"Failed to init Batch TTS: {tts_service_name}"}
        
        elif args.input and args.ref:
            try:
                video_path = args.input
                json_path = args.ref # Path to temporary json file containing segments
                
                with open(json_path, 'r', encoding='utf-8') as f:
                    segments = json.load(f)
                
                work_dir = os.path.dirname(json_path)
                print(f"正在使用 {tts_service_name} 批量生成 {len(segments)} 个片段的语音...")
                print(f"\n[阶段1] 正在提取参考音频到 {os.path.join(work_dir, '.cache', 'raw')} ...")

                tasks = []
                skipped_tasks = [] # Track indices of skipped tasks

                for i, seg in enumerate(segments):
                    # Use explicit original_index if provided (for retrying partial lists), else fallback to enumerate
                    final_idx = seg.get('original_index', i)
                    
                    text = seg.get('text', '')
                    start = float(seg.get('start', 0))
                    end = float(seg.get('end', 0))
                    duration = end - start
                    
                    # Pad short reference audio to prevent IndexTTS crashes
                    extract_start = start
                    extract_duration = duration
                    if duration < 2.0:
                        padding = (2.0 - duration) / 2
                        extract_start = max(0, start - padding)
                        extract_duration = duration + (padding * 2)
                        # print(f"  [RefPad] {i}: {duration:.2f}s -> {extract_duration:.2f}s")

 
                    
                    out_path = seg.get('audioPath') 
                    if not out_path:
                        out_path = os.path.join(work_dir, f"segment_{i}.wav")

                    if args.ref_audio and os.path.exists(args.ref_audio):
                        ref_path = args.ref_audio
                        should_clean_ref = False
                    else:

                        # Batch Mode Extraction
                        raw_dir = os.path.join(work_dir, ".cache", "raw")
                        os.makedirs(raw_dir, exist_ok=True)
                        
                        raw_ref_path = os.path.join(raw_dir, f"ref_raw_{i}_{start}.wav")
                        # The final path expected by TTS runner
                        ref_path = os.path.join(work_dir, f"ref_{i}_{start}.wav")

                        should_clean_ref = True
                        should_clean_ref = True
                        try:
                            ffmpeg.input(video_path, ss=extract_start, t=extract_duration).output(
                                raw_ref_path, acodec='pcm_s16le', ac=1, ar=24000, loglevel="error"
                            ).run(overwrite_output=True)
                            
                            # Debug: Verify raw duration
                            try:
                                raw_dur = get_audio_duration(raw_ref_path)
                                print(f"  [参考检查] 片段 {i} ({start}-{end}): 提取原始长度 {raw_dur}s", flush=True)
                            except: pass

                            # TRIM SILENCE 
                            try:
                                y, sr = librosa.load(raw_ref_path, sr=None)
                                y_trim, _ = librosa.effects.trim(y, top_db=20)
                                trim_dur = len(y_trim) / sr
                                
                                if trim_dur < 0.1:
                                    print(f"  [参考检查] 片段 {i} 警告: 去除静音后时长 {trim_dur:.2f}s 极短。")
                                    # User requested NO SKIP. Proceed.
                                else:
                                    print(f"  [参考检查] 片段 {i} 去静音: {len(y)/sr:.2f}s -> {trim_dur:.2f}s")
                                
                                if len(y_trim) > 0:
                                    sf.write(ref_path, y_trim, sr)
                                else:
                                    # This branch essentially dead code if trim_dur < 0.5 block works, but safe fallback
                                    shutil.copy(raw_ref_path, ref_path)

                            except Exception as trim_err:
                                print(f"  [参考检查] 片段 {i} 去静音失败: {trim_err}")
                                shutil.copy(raw_ref_path, ref_path)

                        except Exception as e:
                            print(f"片段 {i} 提取参考音频失败: {e}")
                            continue
                    
                    tasks.append({
                        "text": text,
                        "ref_audio_path": ref_path,
                        "output_path": out_path,
                        "index": final_idx,
                        "clean_ref": should_clean_ref
                    })
                
                # 2. Run Batch TTS
                print(f"\n[阶段2] 正在对 {len(tasks)} 个项目运行 TTS 推理 (因参考音频问题跳过 {len(segments)-len(tasks)} 个)...")
                
                if not tasks:
                     print("没有有效的任务可运行。")
                     result_data = {"success": True, "results": []} # Or error?
                else:
                    target_lang = args.lang if args.lang else "English"
                    batch_size = args.batch_size if args.batch_size else 1
                    batch_results = run_batch_tts_func(tasks, language=target_lang, batch_size=batch_size, **tts_kwargs) 
                
                    # 3. Cleanup & Process
                    final_output_list = []
                
                    task_result_map = { t['index']: r for t, r in zip(tasks, batch_results) }
                    
                    for i, seg in enumerate(segments):
                         final_idx = seg.get('original_index', i)
                         
                         if final_idx in task_result_map:
                             res = task_result_map[final_idx]
                             res['index'] = final_idx # Ensure index is present for frontend mapping
                             
                             if res['success']:
                                 start = float(seg.get('start', 0))
                                 end = float(seg.get('end', 0))
                                 target_dur = end - start
                                 
                                 output_audio = res.get('audio_path')
                                 if not output_audio:
                                     print(f"[批量TTS] 片段 {final_idx} 警告: 返回成功但缺少 audio_path。")
                                     res['success'] = False
                                     res['error'] = "Missing audio_path in result"
                                     final_output_list.append(res)
                                     continue

                                 if output_audio:
                                     current_dur = get_audio_duration(output_audio)
                                     res['duration'] = current_dur or target_dur
                                     
                             final_output_list.append(res)
                         else:
                             final_output_list.append({
                                 "index": final_idx,
                                 "success": False,
                                 "error": "TTS Task Failed (No result returned). Check logs for details."
                             })

                result_data = {"success": True, "results": final_output_list}
                
                # Cleanup .cache (redundant raw files)
                try:
                    cache_dir_to_remove = os.path.join(work_dir, ".cache")
                    if os.path.exists(cache_dir_to_remove):
                        import shutil
                        shutil.rmtree(cache_dir_to_remove)
                        # print(f"Cleaned up redundant cache: {cache_dir_to_remove}")
                except:
                    pass



            except Exception as e:
                print(f"Batch TTS Error: {e}")
                import traceback
                traceback.print_exc()
                result_data = {"success": False, "error": str(e)}
        else:
            print("Usage: --action generate_batch_tts --input video.mp4 --ref segments.json")

    elif args.action == "check_audio_files":
        # Bulk check duration of files
        if args.input:
            try:
                file_list = []
                # Support passing JSON list string
                try:
                    file_list = json.loads(args.input)
                except:
                    file_list = [args.input]

                results = {}
                for path in file_list:
                    if os.path.exists(path):
                        results[path] = get_audio_duration(path) or 0.0
                    else:
                        results[path] = -1.0 # Not found

                result_data = {"success": True, "durations": results}
            except Exception as e:
                result_data = {"success": False, "error": str(e)}
    else:
        print(f"Unknown action: {args.action}")

    if result_data is not None and args.json:
        print("\n__JSON_START__\n")
        print(json.dumps(result_data, indent=None)) # Compact JSON
        print("\n__JSON_END__\n", flush=True) # Ensure flush so UI receives it immediately

    try:
        if args.action == 'asr':
            debug_log(f"Running ASR on: {args.input}")
            # Setup GPU environment lazily
            setup_gpu_paths()
            # Pass output_dir if provided
            result_data = run_asr(args.input, args.model, service=args.asr, output_dir=args.output_dir)
        elif args.action == 'translate_text':
             pass 
             
    except Exception as e:
        debug_log(f"CRITICAL ERROR: {e}")
        import traceback
        debug_log(traceback.format_exc())
        raise e



if __name__ == "__main__":
    debug_log("Entering main block")
    try:
        main()
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        debug_log(f"Unhandled Exception in main:\n{err_msg}")
        print(f"ERROR: {e}", file=sys.stderr)
        print(err_msg, file=sys.stderr)
        sys.exit(1)
        
    debug_log("Main finished normally")
    print("Force exiting...")
    try:
        sys.stdout.close()
        sys.stderr.close()
    except:
        pass
    os._exit(0)
