from typing import Tuple, Dict, Any, List
import torch
from transformers import AutoTokenizer
from transformer_lens import HookedTransformer
from .base import ModelDriver

class TLGptDriver(ModelDriver):
    def __init__(self):
        self.model: HookedTransformer | None = None
        self.tok: AutoTokenizer | None = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        self.n_layers = 0

    def load(self, model_id: str, device: str, dtype: torch.dtype) -> None:
        self.device, self.dtype = device, dtype
        self.tok = AutoTokenizer.from_pretrained(model_id)
        # ensure pad/eos handling
        if self.tok.pad_token is None:
            self.tok.pad_token = self.tok.eos_token

        self.model = HookedTransformer.from_pretrained(
            model_id, device=self.device, dtype=self.dtype
        )
        self.model.eval()
        self.n_layers = self.model.cfg.n_layers

    def tokenize(self, text: str) -> torch.Tensor:
        return self.tok(text, return_tensors="pt").input_ids.to(self.device)

    def detok(self, ids: torch.Tensor) -> List[str]:
        # Return raw token pieces if you want, but for the UI we’ll just return
        # the text so far as a single string in server.py. Keeping this as-is is fine.
        return self.tok.convert_ids_to_tokens(ids[0].tolist())

    @torch.inference_mode()
    def run_with_cache(self, ids: torch.Tensor) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        logits, cache = self.model.run_with_cache(ids)
        return logits, cache

    def pick_next_token_topk(self, logits: torch.Tensor, topk: int) -> Tuple[int, List[Dict[str, float]]]:
        probs = torch.softmax(logits[:, -1, :], dim=-1)[0]
        topv, topi = probs.topk(topk)
        next_id = int(topi[0].item())
        top_pairs = []
        for v, i in zip(topv.tolist(), topi.tolist()):
            # Human-readable token (no Ġ/Ċ in display)
            disp = self.tok.decode([i])
            # Keep raw piece too if you like:
            # raw = self.tok.convert_ids_to_tokens([i])[0]
            top_pairs.append({"tok": disp, "p": float(v)})
        return next_id, top_pairs


    def _lastpos_attn(self, cache: Dict[str, torch.Tensor], layer: int) -> List[List[float]]:
        # [batch, heads, q, k] -> take [0, :, -1, :]
        pat = cache[f"blocks.{layer}.attn.hook_pattern"][0, :, -1, :]
        return pat.detach().float().cpu().tolist()

    def _resid_norm(self, cache: Dict[str, torch.Tensor], layer: int) -> float:
        resid = cache[f"blocks.{layer}.hook_resid_post"][0, -1, :]
        return float(resid.norm().float().cpu().item())

    def _mlp_stats(self, cache: Dict[str, torch.Tensor], layer: int, top_neur: int = 3):
        mlp_post = cache[f"blocks.{layer}.mlp.hook_post"][0, -1, :]  # after act
        mean_val = float(mlp_post.abs().mean().float().cpu().item())
        spikes = []
        if top_neur > 0 and mlp_post.numel() >= top_neur:
            mvals, mids = torch.topk(mlp_post, k=top_neur)
            for v, i in zip(mvals.float().cpu().tolist(), mids.int().cpu().tolist()):
                spikes.append({"unit": int(i), "act": float(v)})
        return mean_val, spikes

    def lastpos_layer_snapshot(self, cache: Dict[str, torch.Tensor], layer: int, top_neur: int = 3) -> Dict[str, Any]:
        return {
            "i": layer,
            "attn": self._lastpos_attn(cache, layer),
            "resid_norm": self._resid_norm(cache, layer),
            "mlp_mean": self._mlp_stats(cache, layer, top_neur)[0],
            "spikes": self._mlp_stats(cache, layer, top_neur)[1],
        }
    def _lastpos_mlp(self, cache: Dict[str, torch.Tensor], layer: int) -> torch.Tensor:
        # [batch, seq, d_mlp] -> take [0, -1, :]
        return cache[f"blocks.{layer}.mlp.hook_post"][0, -1, :]

    def pixel_map_lastpos(self, cache: Dict[str, torch.Tensor], layers: List[int] | None = None) -> List[float]:
        """
        Concatenate all selected layers' MLP activations at the last position
        into a single flat list. One value per neuron = one pixel.
        """
        if layers is None:
            layers = list(range(self.n_layers))
        parts: List[torch.Tensor] = []
        for L in layers:
            parts.append(self._lastpos_mlp(cache, L).detach().float().cpu())
        if not parts:
            return []
        flat = torch.cat(parts, dim=0)  # shape = sum(d_mlp per selected layer)
        return flat.tolist()