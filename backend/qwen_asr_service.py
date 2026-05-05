
import os
import sys
import torch
import traceback

# Force strict offline mode
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

# Setup FFmpeg path for portable environment
current_dir = os.path.dirname(os.path.abspath(__file__))
ffmpeg_bin = os.path.join(current_dir, "ffmpeg", "bin")
if os.path.exists(os.path.join(ffmpeg_bin, "ffmpeg.exe")):
    if ffmpeg_bin not in os.environ.get("PATH", ""):
        os.environ["PATH"] = ffmpeg_bin + os.pathsep + os.environ.get("PATH", "")
        print(f"[QwenASR] Added FFmpeg to PATH: {ffmpeg_bin}")


# Ensure environment requirements
try:
    from dependency_manager import ensure_transformers_version
    ensure_transformers_version("4.57.3")
except ImportError:
    print("[QwenASR] Dependency manager not found, skipping version check.")

# Add Qwen3-ASR submodule to path
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
qwen_repo_path = os.path.join(current_dir, "Qwen3-ASR")

if os.path.exists(qwen_repo_path) and qwen_repo_path not in sys.path:
    print(f"[QwenASR] Adding {qwen_repo_path} to sys.path")
    sys.path.insert(0, qwen_repo_path)

try:
    from qwen_asr import Qwen3ASRModel
except ImportError as e:
    print(f"[QwenASR] Warning: Could not import qwen_asr: {e}")
    Qwen3ASRModel = None

def run_qwen_asr_inference(audio_path, model_name="Qwen3-ASR-1.7B", language=None):
    if not Qwen3ASRModel:
        raise ImportError("Qwen3ASRModel not available. Please ensure Qwen3-ASR submodule is present.")

    # Resolve Model Path
    # Check local models/ folder
    models_dir = os.path.join(project_root, "models")
    model_path = os.path.join(models_dir, model_name)
    
    # Try alternate location if not found (e.g. inside models/Qwen)
    if not os.path.exists(model_path):
        alt_path = os.path.join(models_dir, "Qwen", model_name)
        if os.path.exists(alt_path):
             model_path = alt_path
    
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"[QwenASR] Local model not found at {model_path}. Please download it to 'models/{model_name}'")

    print(f"[QwenASR] Loading model from: {model_path}")

    # Resolve Forced Aligner Path
    aligner_name = "Qwen3-ForcedAligner-0.6B"
    aligner_path = os.path.join(models_dir, aligner_name)
    if not os.path.exists(aligner_path):
         aligner_path = os.path.join(models_dir, "Qwen", aligner_name)
    
    if not os.path.exists(aligner_path):
        # Optional: Try same dir as main model?
        # For now, strict fail or warning? Let's strict fail to be safe as user requested local only.
        print(f"[QwenASR] Warning: Local aligner not found at {aligner_path}. Timestamps might aid alignment.")
        # We can try to proceed without aligner if the model allows, but Qwen3 ASR usually needs it for timestamps?
        # Actually example shows it's passed. If missing, code might fail.
        # But let's error out to be consistent with "Always load from local"
        raise FileNotFoundError(f"[QwenASR] Local aligner not found at {aligner_path}. Please download it.")

    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[QwenASR] Device: {device}")

        # Initialize Model
        # Using simple transformers loading as per example
        asr = Qwen3ASRModel.from_pretrained(
            model_path,
            dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
            device_map=device,
            forced_aligner=aligner_path,
            forced_aligner_kwargs=dict(
                dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
                device_map=device,
            ),
        )

        print(f"[QwenASR] Transcribing: {audio_path}")
        results = asr.transcribe(
            audio=audio_path,
            language=language, # Auto-detect if None
            return_time_stamps=True,
        )

        # DEBUG: Save raw model output for inspection
        try:
            import json
            raw_data = []
            for r in results:
                items = []
                if r.time_stamps:
                    for ts in r.time_stamps:
                        items.append({
                            "text": ts.text,
                            "start": ts.start_time,
                            "end": ts.end_time
                        })
                raw_data.append({
                    "language": r.language,
                    "text": r.text,
                    "time_stamps": items
                })
            debug_path = audio_path + ".raw_asr.json"
            with open(debug_path, "w", encoding="utf-8") as f:
                json.dump(raw_data, f, ensure_ascii=False, indent=2)
            print(f"[QwenASR] Raw output saved to: {debug_path}")
        except Exception as e:
            print(f"[QwenASR] Failed to save debug output: {e}")

        # Convert results to standard format: [{'start': s, 'end': e, 'text': t}]
        segments = []
        if results and len(results) > 0:
            res = results[0]  # Single file inference
            if res.time_stamps and res.text:
                full_text = res.text
                tokens = res.time_stamps
                
                # 1. Identify sentence boundaries in full_text based on punctuation
                import re
                # Split by common ending punctuation, keeping the punctuation
                # Added English period '.' with negative lookahead to avoid splitting on decimal points (e.g., 9.7)
                sentence_list = re.split(r'([。！？!?;；？?\n]+|\.(?!\d))', full_text)
                
                # Re-group punctuation with the sentence
                refined_sentences = []
                for i in range(0, len(sentence_list) - 1, 2):
                    text = sentence_list[i].strip()
                    punc = sentence_list[i+1]
                    if text:
                        refined_sentences.append(text + punc)
                    elif punc.strip(): # Punc only segment (rare)
                        if refined_sentences:
                            refined_sentences[-1] += punc
                        else:
                            refined_sentences.append(punc)
                if len(sentence_list) % 2 == 1 and sentence_list[-1].strip():
                    refined_sentences.append(sentence_list[-1].strip())

                # 2. Map tokens to these sentences
                token_idx = 0
                max_tokens = len(tokens)
                
                for sent in refined_sentences:
                    sent_start = None
                    sent_end = 0
                    
                    # We use a fuzzy search because tokens might be slightly different 
                    # from the original text (casing, etc.)
                    # But since they come from the same tokenizer usually, sequential matching works
                    
                    # Find how many tokens fit in this sentence
                    sent_token_count = 0
                    
                    # Normalize sentence for better matching (ignore spaces and punctuation)
                    norm_sent = re.sub(r'[^\w\u4e00-\u9fff]', '', sent).lower()
                    current_norm_ptr = 0
                    
                    for i in range(token_idx, max_tokens):
                        token = tokens[i]
                        norm_token = re.sub(r'[^\w\u4e00-\u9fff]', '', token.text).lower()
                        
                        if not norm_token: # Skip empty/punct tokens if any
                            sent_token_count += 1
                            sent_end = token.end_time
                            continue
                            
                        if norm_token in norm_sent[current_norm_ptr:]:
                            if sent_start is None:
                                sent_start = token.start_time
                            sent_end = token.end_time
                            sent_token_count += 1
                            current_norm_ptr = norm_sent.find(norm_token, current_norm_ptr) + len(norm_token)
                        else:
                            break
                    
                    if sent_token_count > 0:
                        segments.append({
                            "start": round(sent_start, 3),
                            "end": round(sent_end, 3),
                            "text": sent
                        })
                        token_idx += sent_token_count
                    else:
                        # Fallback: if a sentence has no tokens (e.g. all empty or missed by aligner)
                        print(f"[QwenASR] Warning: Sentence '{sent[:30]}...' matched 0 tokens.")
                        pass

                # 3. Handle leftover tokens (if any)
                if token_idx < max_tokens:
                    remaining_text = []
                    rem_start = tokens[token_idx].start_time
                    rem_end = tokens[-1].end_time
                    for i in range(token_idx, max_tokens):
                        txt = tokens[i].text
                        remaining_text.append(txt)
                    
                    # Join tokens. For non-CJK languages, add spaces.
                    is_cjk = any('\u4e00' <= char <= '\u9fff' for char in full_text)
                    final_rem_text = "".join(remaining_text) if is_cjk else " ".join(remaining_text)
                    
                    segments.append({
                        "start": round(rem_start, 3),
                        "end": round(rem_end, 3),
                        "text": final_rem_text
                    })

            elif res.text:
                # Fallback if no timestamps returned
                print("[QwenASR] Warning: No timestamps returned or aligned. Using full text as one segment.")
                segments.append({
                    "start": 0.0,
                    "end": 0.0,
                    "text": res.text
                })
        
        print(f"[QwenASR] Inference complete. Found {len(segments)} segments.")
        return segments

    except Exception as e:
        print(f"[QwenASR] Inference failed: {e}")
        traceback.print_exc()
        return []

if __name__ == "__main__":
    # Test
    if len(sys.argv) > 1:
        run_qwen_asr_inference(sys.argv[1])
