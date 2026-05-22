from typing import List, Optional

from pydantic import BaseModel


class WSConfig(BaseModel):
    prompt: str
    max_new_tokens: int = 64
    topk: int = 5
    select_layers: Optional[List[int]] = None
    model_id: str = "gpt2"
    driver: str = "tl_gpt"
    pixels: bool = True
    pixel_layers: Optional[List[int]] = None


class TopK(BaseModel):
    tok: str
    p: float


class Spike(BaseModel):
    unit: int
    act: float


class LayerSnap(BaseModel):
    i: int
    resid_norm: float
    mlp_mean: float
    attn: List[List[float]]
    spikes: List[Spike] = []


class TokenStep(BaseModel):
    step: int
    generated_token: str
    topk: List[TopK]
    tokens: List[str]
    layers: List[LayerSnap]
    pixel_map: Optional[List[float]] = None
    pixel_side: Optional[int] = None
    pixel_min: Optional[float] = None
    pixel_max: Optional[float] = None
