import '../css/app.css';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Animator,
  Dots,
  GridLines,
  MovingLines,
  Text,
} from '@arwes/react';
import {
  Activity,
  Binary,
  BrainCircuit,
  Cpu,
  GitBranch,
  Home,
  KeyRound,
  Microscope,
  Network,
  Pause,
  Play,
  RadioTower,
  ShieldCheck,
  Square,
  Terminal,
  Zap,
} from 'lucide-react';

const defaultPrompt = 'Explain why transformer attention changes across layers.';

function parseLayers(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source || source === 'all') return null;

  const layers = new Set();
  for (const chunk of source.split(',')) {
    const part = chunk.trim();
    if (!part) continue;

    if (part.includes('-')) {
      const [a, b] = part.split('-').map((item) => Number.parseInt(item.trim(), 10));
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const lo = Math.max(0, Math.min(a, b));
        const hi = Math.min(95, Math.max(a, b));
        for (let i = lo; i <= hi; i += 1) layers.add(i);
      }
    } else {
      const layer = Number.parseInt(part, 10);
      if (Number.isFinite(layer) && layer >= 0 && layer <= 95) layers.add(layer);
    }
  }

  return [...layers].sort((a, b) => a - b);
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="stat-frame">
      <div className="stat">
        <Icon size={18} />
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function PixelMap({ frame }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame?.pixel_map?.length || !frame?.pixel_side) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.clientWidth || 720;
    const height = canvas.clientHeight || 720;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const pixels = frame.pixel_map;
    const side = frame.pixel_side;
    const sorted = [...pixels].sort((a, b) => a - b);
    const quantile = (p) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))))];
    const lo = quantile(0.02);
    const hi = quantile(0.98);
    const denom = Math.max(1e-9, hi - lo);
    const image = new ImageData(side, side);

    for (let i = 0; i < pixels.length; i += 1) {
      let t = (pixels[i] - lo) / denom;
      t = Math.max(0, Math.min(1, t));
      const hot = Math.floor(255 * t);
      const offset = i * 4;
      image.data[offset] = Math.floor(20 + hot * 0.25);
      image.data[offset + 1] = Math.floor(90 + hot * 0.65);
      image.data[offset + 2] = Math.floor(120 + hot);
      image.data[offset + 3] = 255;
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = side;
    offscreen.height = side;
    offscreen.getContext('2d').putImageData(image, 0, 0);

    const scale = Math.min(canvas.width / side, canvas.height / side);
    const drawWidth = Math.floor(side * scale);
    const drawHeight = Math.floor(side * scale);
    const x = Math.floor((canvas.width - drawWidth) / 2);
    const y = Math.floor((canvas.height - drawHeight) / 2);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, 0, 0, side, side, x, y, drawWidth, drawHeight);
  }, [frame]);

  return <canvas className="pixel-map" ref={canvasRef} />;
}

function TopKPanel({ frame }) {
  const entries = frame?.topk || [];

  return (
    <div className="panel">
      <div className="panel-heading">
        <Binary size={17} />
        <span>Token Probability Field</span>
      </div>
      <div className="topk">
        {entries.length === 0 && <span className="muted">Awaiting stream.</span>}
        {entries.map((entry, index) => (
          <div className="topk-row" key={`${entry.tok}-${index}`}>
            <code>{JSON.stringify(entry.tok)}</code>
            <div className="prob-track">
              <span style={{ width: `${Math.max(2, entry.p * 100)}%` }} />
            </div>
            <strong>{(entry.p * 100).toFixed(2)}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function LayerPanel({ frame }) {
  const layers = frame?.layers || [];

  return (
    <div className="panel">
      <div className="panel-heading">
        <Activity size={17} />
        <span>Layer Telemetry</span>
      </div>
      <div className="layer-list">
        {layers.length === 0 && <span className="muted">No layer packets captured.</span>}
        {layers.map((layer) => (
          <div className="layer-row" key={layer.i}>
            <span>L{layer.i}</span>
            <strong>{layer.resid_norm.toFixed(2)}</strong>
            <em>MLP {layer.mlp_mean.toFixed(4)}</em>
            <code>{layer.spikes?.map((spike) => `#${spike.unit}:${spike.act.toFixed(2)}`).join('  ')}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [page, setPage] = useState('home');
  const [guestId, setGuestId] = useState(localStorage.getItem('headcracker.guestId') || '');
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [modelId, setModelId] = useState('gpt2');
  const [layers, setLayers] = useState('0,3,6,9');
  const [maxTokens, setMaxTokens] = useState(32);
  const [status, setStatus] = useState('locked');
  const [engineHealth, setEngineHealth] = useState('checking');
  const [frames, setFrames] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [runId, setRunId] = useState(null);
  const wsRef = useRef(null);
  const framesRef = useRef([]);
  const textRef = useRef('');

  const currentFrame = frames[currentIndex] || frames[frames.length - 1] || null;
  const generatedText = currentFrame?.text || '';
  const activeLayers = useMemo(() => parseLayers(layers) || [0, 3, 6, 9], [layers]);

  useEffect(() => {
    fetch('/api/engine/health')
      .then((response) => response.json())
      .then((payload) => setEngineHealth(payload?.ok ? 'online' : 'offline'))
      .catch(() => setEngineHealth('offline'));
  }, []);

  useEffect(() => {
    if (guestId) localStorage.setItem('headcracker.guestId', guestId);
  }, [guestId]);

  async function startRun() {
    if (!guestId.trim()) {
      setStatus('guest id required');
      return;
    }

    setFrames([]);
    framesRef.current = [];
    textRef.current = '';
    setCurrentIndex(0);
    setStatus('authorizing');

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          guest_id: guestId.trim(),
          prompt,
          model_id: modelId,
          driver: 'tl_gpt',
          max_new_tokens: Number(maxTokens),
          layers: activeLayers,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Run was rejected.');

      setRunId(payload.run.id);
      setStatus('streaming');

      const ws = new WebSocket(payload.engine.ws_url);
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify(payload.config));
      ws.onmessage = (event) => {
        const frame = JSON.parse(event.data);
        setFrames((previous) => {
          const next = [...previous, frame];
          framesRef.current = next;
          textRef.current = frame.text || textRef.current;
          setCurrentIndex(next.length - 1);
          return next;
        });
      };
      ws.onclose = () => {
        setStatus('complete');
        fetch(`/api/runs/${payload.run.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            guest_id: guestId.trim(),
            status: 'complete',
            frames_captured: framesRef.current.length,
            summary: { final_text: textRef.current.slice(-1200) },
          }),
        }).catch(() => {});
      };
      ws.onerror = () => setStatus('engine error');
    } catch (error) {
      setStatus(error.message);
    }
  }

  function stopRun() {
    wsRef.current?.close();
    setStatus('stopped');
  }

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'method', label: 'Scientific Method', icon: Microscope },
    { id: 'github', label: 'GitHub', icon: GitBranch },
  ];

  return (
    <Animator active duration={{ enter: 0.7 }}>
      <main className="app-shell">
        <GridLines className="arwes-grid" lineColor="rgba(0, 229, 255, 0.11)" distance={36} />
        <Dots className="arwes-dots" color="rgba(120, 255, 214, 0.12)" distance={26} />
        <MovingLines className="arwes-lines" lineColor="rgba(255, 44, 122, 0.14)" distance={52} sets={24} />

        <header className="topbar">
          <div className="brand">
            <img src="/images/head-cracker-logo.png" alt="HeadCracker" />
            <div>
              <Text as="h1">HeadCracker</Text>
              <span>GPT-2 interpretability console for defensive guardrail research</span>
            </div>
          </div>
          <nav className="site-nav" aria-label="Primary navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={page === item.id ? 'active' : ''}
                  key={item.id}
                  onClick={() => setPage(item.id)}
                  type="button"
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="status-cluster">
            <span><RadioTower size={15} /> Engine {engineHealth}</span>
            <span><ShieldCheck size={15} /> Guest gated</span>
            <span><Cpu size={15} /> {modelId}</span>
          </div>
        </header>

        {page === 'home' && (
          <>
            <section className="hero-grid">
              <div className="mission hero-mission">
                <div className="eyebrow"><Zap size={15} /> Open-source local-first research stack</div>
                <Text as="h2">HeadCracker maps model behavior while GPT-2 chooses its next token.</Text>
                <p>
                  The Laravel site gates prompt runs, the Python engine streams TransformerLens telemetry,
                  and the Arwes interface turns token probabilities, residual norms, MLP spikes, and layer
                  activity into a live research display.
                </p>
                <div className="hero-actions">
                  <button onClick={() => setPage('method')} type="button"><Microscope size={16} /> Research method</button>
                  <button onClick={() => setPage('github')} type="button"><GitBranch size={16} /> Open source</button>
                </div>
              </div>

              <div className="access-panel">
                <div className="panel-heading">
                  <KeyRound size={17} />
                  <span>Guest Access</span>
                </div>
                <label>
                  Guest ID
                  <input value={guestId} onChange={(event) => setGuestId(event.target.value)} placeholder="Issued guest ID" />
                </label>
                <p className="muted">Local Docker seed: HC-DEMO-LOCAL</p>
              </div>
            </section>

            <section className="console-grid">
              <div className="control-panel">
                <div className="panel-heading">
                  <Terminal size={17} />
                  <span>Backend Prompt Run</span>
                </div>
                <label>
                  Prompt
                  <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                </label>
                <div className="control-row">
                  <label>
                    Model
                    <input value={modelId} onChange={(event) => setModelId(event.target.value)} />
                  </label>
                  <label>
                    Layers
                    <input value={layers} onChange={(event) => setLayers(event.target.value)} />
                  </label>
                  <label>
                    Tokens
                    <input type="number" min="1" max="96" value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} />
                  </label>
                </div>
                <div className="button-row">
                  <button onClick={startRun} type="button"><Play size={16} /> Run prompt</button>
                  <button onClick={stopRun} type="button"><Square size={16} /> Stop</button>
                  <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} type="button"><Pause size={16} /> Step back</button>
                </div>
                <div className="run-status">{status}</div>
              </div>

              <div className="viz-panel">
                <div className="panel-heading">
                  <BrainCircuit size={17} />
                  <span>Activation Pixel Field</span>
                </div>
                <PixelMap frame={currentFrame} />
                <input
                  className="scrubber"
                  type="range"
                  min="0"
                  max={Math.max(0, frames.length - 1)}
                  value={currentIndex}
                  onChange={(event) => setCurrentIndex(Number(event.target.value))}
                />
              </div>

              <div className="side-stack">
                <div className="stats">
                  <Stat icon={Activity} label="Frames" value={frames.length} />
                  <Stat icon={Cpu} label="Run" value={runId || '-'} />
                  <Stat icon={Binary} label="Layers" value={activeLayers.join(',')} />
                </div>
                <TopKPanel frame={currentFrame} />
                <LayerPanel frame={currentFrame} />
              </div>
            </section>

            <div className="output-panel">
              <div className="panel-heading">
                <Terminal size={17} />
                <span>Generated Text Stream</span>
              </div>
              <pre>{generatedText || 'No generation captured yet.'}</pre>
            </div>
          </>
        )}

        {page === 'method' && (
          <section className="page-grid">
            <div className="mission page-hero">
              <div className="eyebrow"><Microscope size={15} /> Scientific Method</div>
              <Text as="h2">Measure behavior, compare traces, then test interventions.</Text>
              <p>
                HeadCracker is framed as defensive interpretability research. It does not assume a single
                hidden switch controls guardrails; it records correlated signals across tokens, layers, and
                circuits so hypotheses can be tested against repeated runs.
              </p>
            </div>
            <div className="method-steps">
              {[
                ['Observe', 'Run controlled GPT-2 prompts and capture token-by-token telemetry from the same local model.'],
                ['Instrument', 'Record residual norms, attention summaries, MLP activation spikes, top-k probabilities, and activation pixel maps.'],
                ['Compare', 'Place ordinary, adversarial, and safety-relevant prompt families side by side to search for stable correlations.'],
                ['Hypothesize', 'Identify layer ranges, units, or token transitions that appear connected to refusal or compliance behavior.'],
                ['Test', 'Repeat the run under prompt, layer, and intervention changes before treating a pattern as meaningful.'],
              ].map(([title, copy], index) => (
                <div className="method-card" key={title}>
                  <strong>{String(index + 1).padStart(2, '0')}</strong>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              ))}
            </div>
            <div className="panel research-panel">
              <div className="panel-heading"><Network size={17} /><span>Research Boundaries</span></div>
              <p>
                The open demo uses GPT-2 because it installs quickly and runs locally. Larger protected
                models require different access, heavier compute, and stricter safety review. The trace format
                is designed so a Unity visualization can later replay the same run data as a neural map.
              </p>
            </div>
          </section>
        )}

        {page === 'github' && (
          <section className="page-grid">
            <div className="mission page-hero">
              <div className="eyebrow"><GitBranch size={15} /> Public Repository</div>
              <Text as="h2">Open-source HeadCracker as a local GPT-2 research stack.</Text>
              <p>
                The project ships as Docker services: Laravel for the site and guest-gated run records,
                FastAPI for the TransformerLens engine, and a React Arwes frontend for the cybernetic
                telemetry display.
              </p>
              <div className="hero-actions">
                <a className="button-link" href="https://github.com/cyberfab007/head-cracker" rel="noreferrer" target="_blank">
                  <GitBranch size={16} /> View repository
                </a>
              </div>
            </div>
            <div className="github-grid">
              <div className="panel">
                <div className="panel-heading"><Terminal size={17} /><span>Run Locally</span></div>
                <pre>git clone https://github.com/cyberfab007/head-cracker.git{'\n'}cd head-cracker{'\n'}docker compose up --build</pre>
              </div>
              <div className="panel">
                <div className="panel-heading"><ShieldCheck size={17} /><span>Access Model</span></div>
                <p>
                  Prompt execution remains gated by Laravel guest IDs. The seeded local demo ID is
                  <code> HC-DEMO-LOCAL </code>, with quota and hourly rate limits enforced before the browser
                  receives an engine WebSocket URL.
                </p>
              </div>
              <div className="panel">
                <div className="panel-heading"><Cpu size={17} /><span>Stack</span></div>
                <p>Laravel 13, React, Arwes, FastAPI, TransformerLens, GPT-2, Docker Compose, SQLite.</p>
              </div>
            </div>
          </section>
        )}
      </main>
    </Animator>
  );
}

createRoot(document.getElementById('root')).render(<App />);
