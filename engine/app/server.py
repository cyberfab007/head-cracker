# app/server.py
import os
import json
import math
from typing import List
from fastapi import Query

import torch
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketDisconnect
from starlette.responses import RedirectResponse

# Absolute imports so running as script works too
from app.schemas import WSConfig, TokenStep, LayerSnap, TopK, Spike
from app.drivers.tl_gpt import TLGptDriver

app = FastAPI(title="HeadCracker Engine", version="0.2.0")

# CORS (handy for local HTML testing)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve /app/web at /ui (do NOT mount at "/" or it will catch websockets)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
if os.path.isdir(WEB_DIR):
    app.mount("/ui", StaticFiles(directory=WEB_DIR, html=True), name="web")

    @app.get("/")
    def root():
        return RedirectResponse(url="/ui/")
else:
    print(f"Static web dir not found at {WEB_DIR}; skipping static mount.")

# Driver registry – add more later (llama, deepseek, etc.)
DRIVERS = {
    "tl_gpt": TLGptDriver,
}
driver = None  # global singleton


def ensure_driver(model_id: str, driver_key: str):
    """Lazy-load or swap the active driver when model_id/driver_key changes."""
    global driver
    DriverCls = DRIVERS[driver_key]
    if driver is None or driver.__class__ is not DriverCls:
        drv = DriverCls()
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        drv.load(model_id=model_id, device=device, dtype=dtype)
        driver = drv

@app.get("/meta")
def meta(model_id: str = "gpt2", driver_key: str = "tl_gpt"):
    """Return basic model metadata so the UI can size controls/layouts."""
    ensure_driver(model_id, driver_key)
    return {
        "model_id": getattr(driver, "model_id", model_id),
        "n_layers": int(driver.n_layers),
        "d_mlp": int(getattr(driver, "d_mlp", 0)),   # GPT-2 small: 3072
        "d_model": int(getattr(driver, "d_model", 0)),
        "n_heads": int(getattr(driver, "n_heads", 0)),
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "headcracker-engine",
        "default_model": "gpt2",
        "drivers": sorted(DRIVERS.keys()),
    }


@app.websocket("/ws/generate")
async def ws_generate(ws: WebSocket):
    await ws.accept()
    try:
        raw = await ws.receive_text()
        cfg = WSConfig(**json.loads(raw))

        ensure_driver(cfg.model_id, cfg.driver)

        # Which layers to summarize live (bars/attn)
        select_layers: List[int] = cfg.select_layers or list(range(min(driver.n_layers, 12)))

        # Tokenize prompt
        ids = driver.tokenize(cfg.prompt)

        # Stream token-by-token
        for step in range(cfg.max_new_tokens):
            # Forward pass with cache (CUDA autocast only if available)
            with torch.inference_mode():
                if torch.cuda.is_available():
                    with torch.autocast(device_type="cuda", dtype=torch.float16):
                        logits, cache = driver.run_with_cache(ids)
                else:
                    logits, cache = driver.run_with_cache(ids)

            # Choose next token + top-k alternatives
            next_id, top_pairs = driver.pick_next_token_topk(logits, cfg.topk)

            # Per-layer summaries at last position
            layers_payload = []
            for L in select_layers:
                snap = driver.lastpos_layer_snapshot(cache, L, top_neur=3)
                layers_payload.append(
                    LayerSnap(
                        i=snap["i"],
                        resid_norm=snap["resid_norm"],
                        mlp_mean=snap["mlp_mean"],
                        attn=snap["attn"],
                        spikes=[Spike(**s) for s in snap["spikes"]],
                    ).dict()
                )

            # Human-readable token + full text so far
            gen_tok_str = driver.tok.decode([next_id])
            text_so_far = driver.tok.decode(ids[0].tolist())
            tokens_str = driver.detok(ids)  # raw BPE pieces for diagnostic axes

            # Full "brain" pixel map (flat MLP activations across selected/all layers)
            pixel_map = None
            pixel_side = None
            pixel_min = None
            pixel_max = None
            if getattr(cfg, "pixels", False):
                pl = getattr(cfg, "pixel_layers", None)
                if not pl:
                    pl = list(range(driver.n_layers))
                pix = driver.pixel_map_lastpos(cache, layers=pl)
                if pix:
                    pixel_map = pix
                    pixel_side = int(math.ceil(math.sqrt(len(pix))))
                    pixel_min = float(min(pix))
                    pixel_max = float(max(pix))

            payload = TokenStep(
                step=step,
                generated_token=gen_tok_str,
                topk=[TopK(**p) for p in top_pairs],
                tokens=tokens_str,
                layers=[LayerSnap(**lp) for lp in layers_payload],
                pixel_map=pixel_map,
                pixel_side=pixel_side,
                pixel_min=pixel_min,
                pixel_max=pixel_max,
            ).model_dump()

            # Also include pretty full text
            payload["text"] = text_so_far

            await ws.send_text(json.dumps(payload))

            # Append chosen token and continue generation
            next_tensor = torch.tensor([[next_id]], device=ids.device)
            ids = torch.cat([ids, next_tensor], dim=1)

        await ws.close()

    except WebSocketDisconnect:
        try:
            await ws.close()
        except Exception:
            pass
    except Exception:
        try:
            await ws.close()
        except Exception:
            pass
        raise


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.server:app", host="127.0.0.1", port=8000, reload=True)
