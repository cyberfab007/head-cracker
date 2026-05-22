import asyncio, websockets, json

async def main():
    uri = "ws://127.0.0.1:8000/ws/generate"
    async with websockets.connect(uri) as ws:
        cfg = {
            "prompt": "Explain AI simply.",
            "max_new_tokens": 10,
            "topk": 5,
            "model_id": "gpt2",
            "driver": "tl_gpt",
            "select_layers": [0,3,6,9],
            "pixels": True,          # <-- IMPORTANT
            "pixel_layers": None     # or e.g. [0,1,2,3] to limit
        }
        await ws.send(json.dumps(cfg))
        async for msg in ws:
            data = json.loads(msg)
            print(f"[{data['step']}] token: {data['generated_token']} | text: {data.get('text','')}")
            pm = data.get("pixel_map")
            if pm:
                side = data.get("pixel_side")
                pmn, pmx = data.get("pixel_min"), data.get("pixel_max")
                print(f"   pixels={len(pm)}  side≈{side}  min={pmn:.4f}  max={pmx:.4f}")

asyncio.run(main())
